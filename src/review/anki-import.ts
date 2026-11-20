/* ============================================================
 * bz · Anki 文件导入（review/anki-import.ts，2026-11-20）
 *
 * 选文件 → 解析 → **预览确认** → 才写盘。
 *
 * 文件选择走 `<input type="file">`：桌面 Electron 下它是系统原生对话框，
 * 移动端是系统自带文件选择器，两端都能选 **vault 之外任意位置** 的导出文件；
 * 只用 `File.text()` 读内容（UTF-8），不依赖磁盘路径 —— 导入的卡没有回链，
 * 本来就不需要位置，省掉 Electron dialog + fs 那套逐版本兜底。
 *
 * 解析是纯函数（anki-cards.ts，可单测）；这里只管选择、预览、提示。
 * ============================================================ */
import { notice } from '../core/notice';
import { uiModal } from '../core/ui/modal';
import { markOwned } from '../core/scope';
import { esc } from './ui/html-bridge';
import { parseAnkiFile, type AnkiParseStats, type ParsedAnkiCard } from './anki-cards';
import type { ReviewDataManager } from './data';

/* 文本导出后缀；text/* 兜住浏览器/移动端把 .tsv 报成 text/tab-separated-values 的情况 */
const ANKI_ACCEPT = '.txt,.tsv,.csv,text/plain,text/tab-separated-values';

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

/** 跳过原因的一行摘要（预览列表与「没认出卡」提示共用） */
function skipParts(stats: AnkiParseStats): string[] {
  const s = stats.skipped;
  const out: string[] = [];
  if (s.empty) out.push(`空行 ${s.empty}`);
  if (s.short) out.push(`字段不足 ${s.short}`);
  if (s.emptyFront) out.push(`正面为空 ${s.emptyFront}`);
  if (s.emptyBack) out.push(`背面为空 ${s.emptyBack}`);
  if (s.noCloze) out.push(`挖空类型没找到 {{c1::…}} 标记 ${s.noCloze}`);
  if (s.imageOcclusion) out.push(`图片遮挡卡 ${s.imageOcclusion}（文本导出没有可复习的文字）`);
  return out;
}

/** 预览弹窗内容：进多少 / 跳过什么 / 媒体带不过来 / 格式边界，摊开给人看 */
function previewHtml(name: string, stats: AnkiParseStats): string {
  const skips = skipParts(stats);
  const lines: string[] = [];
  if (skips.length) lines.push(`<li>跳过：${skips.join('、')}</li>`);
  if (stats.media) {
    lines.push(
      `<li>媒体引用 ${stats.media} 处：文本导出不带文件，卡片里留成 [图片：文件名] / [音频：文件名]</li>`,
    );
  }
  if (stats.tagged) lines.push(`<li>标签 ${stats.tagged} 条：写进卡片备注</li>`);

  return `
    <div class="bzrv-anki-preview">
      <p class="bzrv-anki-file">文件：${esc(name)}</p>
      <div class="bzrv-anki-nums">
        <span><b>${stats.cards}</b> 张待导入</span>
        <span>问答 <b>${stats.qa}</b></span>
        <span>挖空 <b>${stats.cloze}</b></span>
        ${stats.reversed ? `<span>反向 <b>${stats.reversed}</b></span>` : ''}
        ${stats.multiCloze ? `<span>拆空 <b>${stats.multiCloze}</b> 条笔记</span>` : ''}
      </div>
      ${lines.length ? `<ul class="bzrv-anki-list">${lines.join('')}</ul>` : ''}
      <p class="bzrv-anki-note">只认 Anki「笔记纯文本」导出（.txt / .tsv / .csv）；.apkg / .colpkg 请回 Anki 重新导出。挖空按编号拆成多张卡、含反向卡的笔记出正反两张，与 Anki 的卡数一致。</p>
      ${stats.media || stats.skipped.imageOcclusion ? '<p class="bzrv-anki-warn">图片 / 音频本身不在纯文本导出里：带图的卡进来会缺图，图片遮挡卡不支持。重要素材请改用手动制卡。</p>' : ''}
      <div class="bzrv-btn-row bzrv-anki-acts">
        <button type="button" class="bzrv-btn bzrv-btn--ghost" data-act="anki-cancel">取消</button>
        <button type="button" class="bzrv-btn bzrv-btn--primary" data-act="anki-confirm">确认导入 ${stats.cards} 张</button>
      </div>
    </div>`;
}

/** 写盘 + 结果明细（用户确认后才走到这里） */
async function commitAnkiCards(cards: ParsedAnkiCard[], dm: ReviewDataManager): Promise<void> {
  const { importCardsFromMarkdown } = await import('./backup-io');
  const res = await importCardsFromMarkdown(dm, cards);
  const qa = cards.filter((c) => c.syntax === 'qa').length;
  const cloze = cards.filter((c) => c.syntax === 'cloze').length;
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
 * 选完先弹预览，用户点「确认导入」才写盘。
 */
export async function importAnkiFromPicker(_app: unknown, dm: ReviewDataManager): Promise<void> {
  const picked = await pickAnkiTextFile();
  if (!picked) return;

  const { cards, stats } = parseAnkiFile(picked.raw, picked.name);
  if (!cards.length) {
    const why = skipParts(stats).join('、');
    notice(`这份文件里没认出可导入的卡片${why ? `（${why}）` : ''}`, 'warning');
    return;
  }

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
export async function importAnkiFromActiveFile(app: unknown, dm: ReviewDataManager): Promise<void> {
  await importAnkiFromPicker(app, dm);
}
