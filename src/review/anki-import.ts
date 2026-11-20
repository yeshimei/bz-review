/* ============================================================
 * bz · Anki 文件导入（review/anki-import.ts，2026-11-20）
 *
 * 选文件 → 解析 → **补选媒体（可选）** → **预览确认** → 才写盘。
 *
 * 文件选择走 `<input type="file">`：桌面 Electron 下它是系统原生对话框，
 * 移动端是系统自带文件选择器，两端都能选 **vault 之外任意位置** 的导出文件；
 * 只用 File.text() / File.arrayBuffer() 读内容，不依赖磁盘路径 —— 导入的卡没有回链，
 * 本来就不需要位置，省掉 Electron dialog + fs 那套逐版本兜底。
 *
 * Anki「笔记纯文本」导出只带媒体**文件名**不带文件本身。这里在解析后询问用户
 * 要不要补选对应的图片/音频：按文件名配对、落进库内 anki-media 目录、撞名改名，
 * 再把卡片的 media / occlusion 指向真实文件。不补选就退回原来的占位文字，
 * 一条链路两种结果都摊在预览里给人看。
 *
 * 解析与配对是纯函数（anki-cards.ts / anki-media.ts，可单测）；这里只管选择、
 * 落盘、预览、提示。
 * ============================================================ */
import type { App } from 'obsidian';
import { notice } from '../core/notice';
import { uiModal } from '../core/ui/modal';
import { openFlowDialog } from '../core/flow-dialog';
import { markOwned } from '../core/scope';
import { storageDir } from '../core/storage';
import { esc } from './ui/html-bridge';
import { parseAnkiFile, type AnkiParseStats, type ParsedAnkiCard } from './anki-cards';
import { isAudioName, isImageName, mediaBaseName, planAnkiMedia } from './anki-media';
import type { ReviewDataManager } from './data';

/* 文本导出后缀；text/* 兜住浏览器/移动端把 .tsv 报成 text/tab-separated-values 的情况 */
const ANKI_ACCEPT = '.txt,.tsv,.csv,text/plain,text/tab-separated-values';
/* 补选的媒体文件后缀；image/* / audio/* 兜住移动端 MIME 上报 */
const MEDIA_ACCEPT =
  '.png,.jpg,.jpeg,.gif,.webp,.bmp,.svg,.mp3,.wav,.ogg,.m4a,.aac,.flac,.webm,image/*,audio/*';

/** 媒体落盘目录（vault 相对），跟数据目录一起走、跟着库走 */
export function ankiMediaDir(): string {
  return `${storageDir().replace(/\/+$/, '')}/anki-media`;
}

/** 选一份 Anki 导出文本（系统对话框）：返回文件名与内容；取消 / 读不到 → null */
function pickAnkiTextFile(): Promise<{ name: string; raw: string } | null> {
  return new Promise((resolve) => {
    const input = createEl('input');
    input.type = 'file';
    input.accept = ANKI_ACCEPT;
    input.hidden = true;
    markOwned(input);
    document.body.appendChild(input);

    let settled = false;
    const finish = (value: { name: string; raw: string } | null): void => {
      if (settled) return;
      settled = true;
      window.removeEventListener('focus', onFocus);
      input.remove();
      resolve(value);
    };
    /* 取消检测：对话框关闭后窗口回焦、而 change 未派发 → 迟一拍认定取消 */
    const onFocus = (): void => {
      window.setTimeout(() => {
        if (!input.files?.length) finish(null);
      }, 250);
    };

    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        finish(null);
        return;
      }
      void file.text().then(
        (raw) => finish({ name: file.name || 'Anki 导出', raw }),
        () => {
          notice('读不到这个文件，换一个试试', 'warning');
          finish(null);
        },
      );
    });
    window.addEventListener('focus', onFocus);
    /* 必须在点击的同步栈里触发，异步弹会被浏览器拦成「非用户手势」 */
    input.click();
  });
}

/** 多选补选的媒体文件（系统对话框）：取消 → 空数组 */
function pickAnkiMediaFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = createEl('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = MEDIA_ACCEPT;
    input.hidden = true;
    markOwned(input);
    document.body.appendChild(input);

    let settled = false;
    const finish = (files: File[]): void => {
      if (settled) return;
      settled = true;
      window.removeEventListener('focus', onFocus);
      input.remove();
      resolve(files);
    };
    const onFocus = (): void => {
      window.setTimeout(() => {
        if (!input.files?.length) finish([]);
      }, 250);
    };

    input.addEventListener('change', () => {
      finish(Array.from(input.files ?? []));
    });
    window.addEventListener('focus', onFocus);
    input.click();
  });
}

/** 跳过原因的一行摘要（预览列表与「没认出卡」提示共用） */
function skipParts(stats: AnkiParseStats): string[] {
  const s = stats.skipped;
  const out: string[] = [];
  if (s.empty) out.push(`空行 ${s.empty}`);
  if (s.short) out.push(`字段不足 ${s.short}`);
  if (s.emptyFront) out.push(`正面为空 ${s.emptyFront}`);
  if (s.emptyBack) out.push(`背面为空 ${s.emptyBack}`);
  if (s.noCloze) out.push(`挖空类型没找到 {{c1::…}} 标记 ${s.noCloze}`);
  return out;
}

/** 汇总解析出的卡片引用了哪些媒体文件名（去重） */
function collectRefs(cards: ParsedAnkiCard[]): string[] {
  const out: string[] = [];
  for (const c of cards) {
    for (const r of c.mediaRefs ?? []) {
      const name = mediaBaseName(r);
      if (name && !out.includes(name)) out.push(name);
    }
  }
  return out;
}

/** 库内已有文件路径（撞名避让用）；目录不存在返回空 */
async function occupiedPaths(app: App, dir: string): Promise<string[]> {
  try {
    const listed = (await app.vault.adapter.list(dir)) as { files?: string[] };
    return listed?.files ?? [];
  } catch {
    return [];
  }
}

/**
 * 补选媒体 → 配对 → 落盘 → 改写卡片，返回给人看的统计（直接并进 stats）。
 * 用户跳过 / 没选到文件：一律不改写，卡片保留占位文字。
 */
async function attachMedia(app: App, cards: ParsedAnkiCard[], stats: AnkiParseStats): Promise<void> {
  const refs = collectRefs(cards);
  if (!refs.length) return;

  const names = refs.slice(0, 4).join('、') + (refs.length > 4 ? ` 等 ${refs.length} 个` : '');
  const choice = await openFlowDialog({
    title: '补选 Anki 媒体文件',
    message:
      `这份导出引用了 ${refs.length} 个图片 / 音频文件（${names}）。` +
      'Anki 的纯文本导出不带文件本身，现在可以多选这些文件补进来：按文件名配对、存入库内 anki-media 目录，卡片上的图片 / 音频就能真实显示；跳过则只保留占位文字。',
    actions: [
      { label: '跳过，保留占位文字', value: 'skip' },
      { label: '选择媒体文件', value: 'pick', cta: true },
    ],
  });
  if (choice !== 'pick') {
    stats.mediaMissing = refs.length;
    return;
  }

  const files = await pickAnkiMediaFiles();
  if (!files.length) {
    stats.mediaMissing = refs.length;
    return;
  }

  const dir = ankiMediaDir();
  const plan = planAnkiMedia({
    refs,
    selectedNames: files.map((f) => f.name || 'media'),
    occupied: await occupiedPaths(app, dir),
    dir,
  });
  stats.renamed = plan.renamed;

  /* 落盘：先建目录，再按计划写；单个写失败不阻断其余，也不改卡片指向 */
  try {
    if (!(await app.vault.adapter.exists(dir))) await app.vault.adapter.mkdir(dir);
  } catch {
    /* 已存在 / 并发创建：后面的 writeBinary 会给出真实错误 */
  }
  const written = new Set<string>();
  for (const w of plan.writes) {
    const file = files[w.index];
    if (!file) continue;
    try {
      await app.vault.adapter.writeBinary(w.target, await file.arrayBuffer());
      written.add(w.target);
    } catch {
      /* 写不进的这张不参与配对，下面的 matched 里会剔除 */
    }
  }

  stats.mediaMatched = 0;
  stats.mediaMissing = 0;
  /* 按引用名把卡片的媒体字段指向真实库内路径；遮挡卡的图也在这里落位 */
  for (const c of cards) {
    if (!c.mediaRefs?.length) continue;
    const images: string[] = [];
    let audio: string | undefined;
    for (const ref of c.mediaRefs) {
      const target = plan.matched.get(mediaBaseName(ref));
      if (!target || !written.has(target)) {
        stats.mediaMissing += 1;
        continue;
      }
      stats.mediaMatched += 1;
      if (isAudioName(ref)) audio = target;
      else if (isImageName(ref)) images.push(target);
    }
    if (c.card.mode === 'occlusion' && c.card.occlusion) {
      const first = images[0] ?? '';
      c.card.occlusion = { image: first, regions: c.card.occlusion.regions };
    } else if (images.length || audio) {
      c.card.media = {
        images: images.length ? images : c.card.media?.images,
        audio: audio ?? c.card.media?.audio,
      };
      /* 配上媒体就转成媒体卡，复习时图能显示、音频能播；文字仍在 text 里 */
      if (c.card.mode === 'flashcard' || c.card.mode === 'cloze') c.card.mode = 'media';
    }
  }
}

/** 预览弹窗内容：进多少 / 跳过什么 / 媒体配对结果 / 格式边界，摊开给人看 */
function previewHtml(name: string, stats: AnkiParseStats): string {
  const skips = skipParts(stats);
  const lines: string[] = [];
  if (skips.length) lines.push(`<li>跳过：${skips.join('、')}</li>`);
  if (stats.mediaNames || stats.mediaMatched || stats.mediaMissing) {
    lines.push(
      `<li>媒体引用 ${stats.media} 处、${stats.mediaNames} 个文件：` +
        `已配上 ${stats.mediaMatched} 处，缺 ${stats.mediaMissing} 处（缺的保留占位文字）</li>`,
    );
  }
  if (stats.occlusion) {
    lines.push(`<li>图片遮挡卡 ${stats.occlusion} 张：按图片 + 文字导入，遮挡区域待你手动补</li>`);
  }
  if (stats.renamed) lines.push(`<li>${stats.renamed} 个媒体文件撞名，已自动改名保存</li>`);
  if (stats.tagged) lines.push(`<li>标签 ${stats.tagged} 条：写进卡片备注</li>`);

  return `
    <div class="bzrv-anki-preview">
      <p class="bzrv-anki-file">文件：${esc(name)}</p>
      <div class="bzrv-anki-nums">
        <span><b>${stats.cards}</b> 张待导入</span>
        <span>问答 <b>${stats.qa}</b></span>
        <span>挖空 <b>${stats.cloze}</b></span>
        ${stats.occlusion ? `<span>遮挡 <b>${stats.occlusion}</b></span>` : ''}
        ${stats.reversed ? `<span>反向 <b>${stats.reversed}</b></span>` : ''}
        ${stats.multiCloze ? `<span>拆空 <b>${stats.multiCloze}</b> 条笔记</span>` : ''}
      </div>
      ${lines.length ? `<ul class="bzrv-anki-list">${lines.join('')}</ul>` : ''}
      <p class="bzrv-anki-note">只认 Anki「笔记纯文本」导出（.txt / .tsv / .csv）；.apkg / .colpkg 请回 Anki 重新导出。挖空按编号拆成多张卡、含反向卡的笔记出正反两张，与 Anki 的卡数一致。</p>
      ${stats.mediaMissing ? '<p class="bzrv-anki-warn">缺文件的卡片保留 [图片：文件名] / [音频：文件名] 占位文字，图不会显示。需要的话，重新导入一次再补选文件。</p>' : ''}
      <div class="bzrv-btn-row bzrv-anki-acts">
        <button type="button" class="bzrv-btn bzrv-btn--ghost" data-act="anki-cancel">取消</button>
        <button type="button" class="bzrv-btn bzrv-btn--primary" data-act="anki-confirm">确认导入 ${stats.cards} 张</button>
      </div>
    </div>`;
}

/** 写盘 + 结果明细（用户确认后才走到这里） */
async function commitAnkiCards(cards: ParsedAnkiCard[], dm: ReviewDataManager): Promise<void> {
  /* 直接取 addCards 的 keys：它才知道哪些卡因去重/额度被跳过。分项只数真正
     新增的卡，开头 added 与括号里的问答/挖空才对得上；媒体/遮挡卡同样按 key 计入。 */
  const res = await dm.addCards(cards.map((c) => c.card));
  const addedKeys = new Set(res.keys);
  const addedCards = cards.filter((c) => addedKeys.has(c.card.key));
  const qa = addedCards.filter((c) => c.syntax === 'qa').length;
  const cloze = addedCards.filter((c) => c.syntax === 'cloze').length;
  notice(
    `Anki 导入 ${res.added} 张（问答 ${qa} / 挖空 ${cloze}）` +
      (res.skipped ? `，跳过 ${res.skipped} 张（已存在）` : '') +
      (res.rejected ? `，${res.rejected} 张超出基础版上限` : ''),
    res.added ? 'success' : 'warning',
  );
  const { reviewApp } = await import('./app');
  void reviewApp.refreshPanel();
}

/**
 * 打开系统文件选择框导入；设置页按钮、空态按钮、命令面板都走这里。
 * 选完先解析，有媒体引用就问要不要补选，最后弹预览，用户点「确认导入」才写盘。
 */
export async function importAnkiFromPicker(app: App, dm: ReviewDataManager): Promise<void> {
  const picked = await pickAnkiTextFile();
  if (!picked) return;

  const { cards, stats } = parseAnkiFile(picked.raw, picked.name);
  if (!cards.length) {
    const why = skipParts(stats).join('、');
    notice(`这份文件里没认出可导入的卡片${why ? `（${why}）` : ''}`, 'warning');
    return;
  }

  /* 有媒体引用就先问要不要补选文件，配对落盘后才进预览 */
  if (stats.mediaNames) await attachMedia(app, cards, stats);

  const modal = uiModal({
    content: previewHtml(picked.name, stats),
    title: '导入 Anki 卡片',
    head: true,
    className: 'bzrv-anki-modal',
  });
  modal.popup.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'anki-cancel') {
      modal.close();
    } else if (act === 'anki-confirm') {
      modal.close();
      void commitAnkiCards(cards, dm);
    }
  });
}

/**
 * 兼容旧调用（命令面板曾经从「当前激活文件」导）：现在一律走系统选择框，
 * 不再要求文件在库内、也不再依赖活动文件。
 */
export async function importAnkiFromActiveFile(app: App, dm: ReviewDataManager): Promise<void> {
  await importAnkiFromPicker(app, dm);
}
