/* ============================================================
 * bz · 「加入复习」的唯一入口（review/add-flow.ts）
 *
 * 2026-11-21 用户拍板：**任何地方、任何内容都走这一条流程**。
 *   · 笔记命令 / 文件树右键 / 文件夹 / 面板空态 / 监听自动收编 → 笔记正文当来源；
 *   · 编辑区选段 → 选中的那段当来源；
 *   · 阅读器书右键 / 工具条 / 划选 → 交给 Review 的「挑内容」窗口。
 * 之后一律是：挑内容（能跳就跳）→ 选方式 → 出题面 → 确认才入库。
 *
 * 唯一允许少一步的情况：设置里的「新卡默认方式」不是「每次问我」——
 * 用户自己说过「除非我在设置里设了不用每次询问」。这时只跳过「选方式」，
 * 题面照样生成、照样停在确认页等用户审；AI 出的东西不许绕过人的眼睛直接入库。
 *
 * 以前这里有七套写法（直接写库、勾选直写、只发一条通知……），用户原话是
 * 「它们各自调用各自的面板，非常的奇怪」。现在只剩这一个文件做分流。
 * ========================================================== */
import type { App } from 'obsidian';
import { notice, notifyActionError } from '../core/notice';
import { QuotaExceededError } from '../data/entitlement';
import { uiModal } from '../core/ui/modal';
import { t } from '../i18n';
import { openCardWizard, type CardWizardSource } from './card-wizard';
import { getReviewPlanApi } from './reader-api';
import {
  folderNotePaths,
  noteSourceOf,
  noteWholeKey,
  plannedPathsFrom,
} from './add-flow-model';
import { noteCardKey } from './note-source';
import { MANUAL_BOOK_TITLE, MANUAL_TEXT_LIMIT, manualCardKey, normalizeManualText } from './manual-card';

/** 所有「加入复习」入口的入参形状 */
export type AddFlowInput =
  /** 单篇笔记（命令、文件树右键、面板空态） */
  | { kind: 'note'; path: string }
  /** 一个文件夹（文件树右键；递归收里面的笔记） */
  | { kind: 'folder'; path: string }
  /** 已经挑好的一批笔记（监听自动收编、监听文件夹批量、文件夹勾选之后） */
  | { kind: 'notes'; paths: readonly string[]; from?: 'watch' | 'folder' }
  /** 编辑区里选中的一段 */
  | {
    kind: 'selection';
    path: string;
    title: string;
    text: string;
    key?: string;
    sourceNote?: { path: string; from: number; to: number };
  }
  /** 从阅读器挑（整本书的划线 / 章节），挑的窗口住在 source-pick-ui */
  | { kind: 'reader'; bookId?: string }
  /** 手动输入的一段文字（更多菜单「创建卡牌」），先弹输入面板再进统一制卡 */
  | { kind: 'text' };

/** 鸭子类型：测试与宿主都不必真的拿到 TFile */
interface FileLike {
  path: string;
  extension?: string;
  basename?: string;
}

interface VaultLike {
  getAbstractFileByPath(path: string): unknown;
  cachedRead(file: never): Promise<string>;
  getFiles(): FileLike[];
}

function vaultOf(app: App): VaultLike {
  return app.vault;
}

/** 单个来源收集的结果：收进来的 + 三种没进来的原因 */
interface CollectResult {
  sources: CardWizardSource[];
  exists: number;
  missing: number;
  empty: number;
}

/**
 * 这批笔记里哪些已经在复习计划里。
 *
 * 必须同时问两种钥匙（2026-11-22 真机踩到的）：
 *   · 真实路径 `notes/a.md`：旧版「整篇笔记条目」在排期表里就是这么存的；
 *   · 整篇钥匙 `note:notes/a.md`：统一流程之后笔记变成一张卡，存的是这个。
 * Reader 的 statusOf 只按 filePath 查，两种都会命中，但调用方要的是「路径 →
 * 在不在」。只查真实路径的话，新流程加过的笔记会被当成没加过，重复点命令
 * 还会再弹一次制卡窗。
 */
async function plannedNotePaths(paths: readonly string[]): Promise<Set<string>> {
  const api = getReviewPlanApi();
  const list = Array.from(new Set(paths.filter(Boolean)));
  if (!api || !list.length) return new Set<string>();
  const byWhole = new Map(list.map((p) => [noteWholeKey(p), p]));
  try {
    const rows = await api.statusOf([...list, ...byWhole.keys()]);
    return plannedPathsFrom(rows, list);
  } catch {
    /* 查重读盘失败不该挡路：照当没加过，入库时 addCards 还会再拦一次 */
    return new Set<string>();
  }
}

/**
 * 把一批笔记读成来源。
 *
 * 三种进不来的情况分开数：已经在计划里（老版整篇条目 / 新流程的整篇卡）、
 * 文件找不到、笔记是空的。用户看到的原因才说得清，而不是一律「加入失败」。
 */
async function collectSources(app: App, paths: readonly string[]): Promise<CollectResult> {
  const out: CollectResult = { sources: [], exists: 0, missing: 0, empty: 0 };
  const list = Array.from(new Set((Array.isArray(paths) ? paths : []).map((p) => String(p ?? '').trim()).filter(Boolean)));
  if (!list.length) return out;

  const planned = await plannedNotePaths(list);
  const vault = vaultOf(app);
  for (const path of list) {
    if (planned.has(path)) {
      out.exists += 1;
      continue;
    }
    const file = vault.getAbstractFileByPath(path) as FileLike | null;
    if (!file || String(file.extension ?? '').toLowerCase() !== 'md') {
      out.missing += 1;
      continue;
    }
    let text = '';
    try {
      text = await vault.cachedRead(file as never);
    } catch {
      out.missing += 1;
      continue;
    }
    const src = noteSourceOf(path, String(file.basename ?? ''), text);
    if (!src) {
      out.empty += 1;
      continue;
    }
    out.sources.push(src);
  }
  return out;
}

/** 选段入口的一条来源（钥匙优先用调用方给的，其次按范围算） */
function selectionSource(input: Extract<AddFlowInput, { kind: 'selection' }>): CardWizardSource | null {
  const text = String(input.text ?? '');
  if (!text.trim()) return null;
  const sourceNote = input.sourceNote;
  const key = String(input.key ?? '').trim()
    || (sourceNote ? noteCardKey(sourceNote) : `sel:${input.path}:${Date.now()}`);
  return {
    key,
    bookTitle: String(input.title ?? '').trim() || String(input.path ?? '').split('/').pop() || t('add.note'),
    text,
    ...(sourceNote ? { sourceNote } : {}),
  };
}

/**
 * 统一入口。
 *
 * 调用方只管说「从哪来、是谁」，选方式 / 出题 / 确认 / 入库 / 刷新都在这里。
 * 出错一律走 notifyActionError（带「重试」出口，不手拼失败文案）。
 */
export async function openAddToReviewFlow(app: App, input: AddFlowInput): Promise<void> {
  try {
    if (input.kind === 'reader') {
      const mod = await import('./source-pick-ui');
      mod.openSourcePicker(app, { bookId: input.bookId });
      return;
    }
    if (input.kind === 'text') {
      await openCreateCardFlow(app);
      return;
    }
    if (input.kind === 'selection') {
      const src = selectionSource(input);
      if (!src) {
        notice(t('add.pickHint'), 'info');
        return;
      }
      deliver(app, [src]);
      return;
    }
    if (input.kind === 'folder') {
      await addFolder(app, input.path);
      return;
    }
    const paths = input.kind === 'note' ? [input.path] : input.paths;
    await addPaths(app, paths);
  } catch (e) {
    /* 额度到顶不是失败：弹同一份对照窗引导升级，别让用户看到「失败，请重试」。 */
    if (e instanceof QuotaExceededError) {
      const { openQuotaUpgradeDialog } = await import('./ui/unlock-dialog');
      openQuotaUpgradeDialog();
      return;
    }
    notifyActionError(e, t('add.title'), {
      onRetry: () => void openAddToReviewFlow(app, input),
    });
  }
}

/** 一个文件夹：先勾选要哪几篇（文件树右键与监听批量共用这块面板） */
async function addFolder(app: App, folder: string): Promise<void> {
  const all = vaultOf(app).getFiles().map((f) => f.path);
  const paths = folderNotePaths(all, folder);
  if (!paths.length) {
    notice(t('add.folderEmpty'), 'info');
    return;
  }
  const planned = await plannedNotePaths(paths);
  const fresh = paths.filter((p) => !planned.has(p));
  if (!fresh.length) {
    notice(t('add.folderAllIn'), 'info');
    return;
  }
  const picked = await pickFolderNotes(folder, fresh);
  if (picked === null) return; // 取消：什么都不加
  if (!picked.length) {
    notice(t('add.pickNone'), 'info');
    return;
  }
  await addPaths(app, picked);
}

/** 已经确定路径的一批笔记：读正文 → 统一交付 */
async function addPaths(app: App, paths: readonly string[]): Promise<void> {
  const got = await collectSources(app, paths);
  const skipped: string[] = [];
  if (got.exists) skipped.push(t('add.existsN', { n: got.exists }));
  if (got.missing) skipped.push(t('add.missingN', { n: got.missing }));
  if (got.empty) skipped.push(t('add.emptyN', { n: got.empty }));
  if (!got.sources.length) {
    notice(skipped.length ? t('add.nothingWithReasons', { reasons: skipped.join('，') }) : t('add.nothing'), 'info');
    return;
  }
  if (skipped.length) notice(t('add.skippedWithReasons', { reasons: skipped.join('，') }), 'info');
  deliver(app, got.sources);
}

/** 交付给统一制卡流程。focusKey：入库后回主列表并高亮这张卡（创建卡牌用）。 */
function deliver(app: App, sources: CardWizardSource[], opts?: { focusKey?: string }): void {
  const api = getReviewPlanApi();
  if (!api) {
    notice(t('add.moduleNotReady'), 'warning');
    return;
  }
  openCardWizard(app, {
    addCards: (cards) => api.addCards(cards),
    statusOf: (keys) => api.statusOf(keys),
    quota: () => api.quota(),
  }, {
    sources,
    /* 入库之后才刷新列表与文件树；取消一个字节都没写，不该触发任何刷新 */
    onAdded: () => {
      void afterAdd(app);
      if (opts?.focusKey) void focusAfterAdd(opts.focusKey);
    },
  });
}

/** 创建卡牌入库后：回三列卡牌主列表并高亮刚加的那张卡。面板没开就算了，不影响入库。 */
async function focusAfterAdd(key: string): Promise<void> {
  try {
    const { uiManager } = await import('./index');
    await uiManager?.focusCardKey(key);
  } catch {
    /* 面板没开不影响入库 */
  }
}

/**
 * 「创建卡牌」输入面板：写一段文字 → 选方式 / 出题面 / 确认入库（统一流程，无旁路）。
 *
 * 面板上给字数提示、空白禁提交（归一逻辑在 manual-card.ts，这里只管交互）；
 * 提交前先按稳定钥匙查重，已在水里的同一段文字不重复加入。
 */
export async function openCreateCardFlow(app: App): Promise<void> {
  const body = createDiv({ cls: 'bzrv-create-card' });
  body.createDiv({ cls: 'bzrv-create-card-desc', text: t('add.manualHint') });
  const area = body.createEl('textarea', { cls: 'bzrv-create-card-input' });
  area.rows = 8;
  area.placeholder = t('add.manualPlaceholder');
  const counter = body.createDiv({ cls: 'bzrv-create-card-count' });

  const modal = uiModal({
    title: t('add.createCard'),
    head: true,
    content: body,
    size: 'md',
    className: 'bzrv-create-card-modal',
  });
  const actions = modal.popup.createDiv({ cls: 'bzrv-edit-actions bzrv-create-card-actions' });
  const cancel = actions.createEl('button', { cls: 'bzrv-btn', text: t('common.cancel') });
  cancel.onclick = () => modal.close();
  const ok = actions.createEl('button', { cls: 'bzrv-btn bzrv-btn--primary', text: t('wiz.next') });

  const paint = (): void => {
    const r = normalizeManualText(area.value);
    /* 计数按归一后的正文算，与截断口径一致：首尾空白不该让提示说「超限」而内容没被截 */
    const n = Array.from(r.text).length;
    counter.textContent = t('add.chars', {
      n,
      limit: MANUAL_TEXT_LIMIT,
      clipped: r.clipped ? t('add.clippedNote') : '',
    });
    counter.classList.toggle('is-over', r.clipped);
    ok.disabled = !!r.error;
  };
  area.oninput = paint;

  ok.onclick = () => {
    const r = normalizeManualText(area.value);
    if (r.error) {
      notice(r.error, 'info');
      return;
    }
    const key = manualCardKey(r.text);
    modal.close();
    void (async () => {
      const api = getReviewPlanApi();
      if (api) {
        try {
          const rows = await api.statusOf([key]);
          if (rows.some((row) => row.planned)) {
            notice(t('add.alreadyIn'), 'info');
            return;
          }
        } catch {
          /* 查重读盘失败不挡路：入库时 addCards 还会再拦一次 */
        }
      }
      deliver(app, [{ key, bookTitle: MANUAL_BOOK_TITLE, text: r.text }], { focusKey: key });
    })();
  };
  paint();
  window.setTimeout(() => area.focus(), 0);
}

/** 入库后的统一收尾：面板列表 + 文件树染色（两处都失败也不影响卡已经进了计划） */
async function afterAdd(app: App): Promise<void> {
  try {
    const { uiManager } = await import('./index');
    await uiManager?.refreshPanel();
  } catch {
    /* 面板没开不影响入库 */
  }
  try {
    const { reviewApp } = await import('./app');
    await reviewApp.applyReviewStyles(app);
  } catch {
    /* 文件树刷新失败不影响入库 */
  }
}

/**
 * 文件夹加入复习的选择面板（2026-11-21；从 watch.ts 搬来共用）。
 *
 * 用户确认「批量加入复习」后，不再闷头全量写入，先把候选笔记列出来让用户勾选。
 * 返回 null = 取消；返回数组 = 选中集合（可为空）。
 */
export function pickFolderNotes(folder: string, candidates: readonly string[]): Promise<string[] | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: string[] | null): void => {
      if (done) return;
      done = true;
      resolve(value);
    };
    const list = Array.from(candidates ?? []);
    const body = createDiv({ cls: 'bzrv-folder-add' });
    body.createDiv({
      cls: 'bzrv-folder-add-desc',
      text: t('add.folderPick', { folder, n: list.length }),
    });
    const tools = body.createDiv({ cls: 'bzrv-folder-add-tools' });
    const all = tools.createEl('input', { type: 'checkbox' });
    all.checked = true;
    const allLabel = tools.createEl('label', { cls: 'bzrv-folder-add-all' });
    allLabel.append(all, createSpan({ text: t('add.selectAll') }));
    const countEl = tools.createSpan({ cls: 'bzrv-folder-add-count' });

    const host = body.createDiv({ cls: 'bzrv-folder-add-list' });
    const boxes: Array<{ path: string; box: HTMLInputElement }> = [];
    for (const path of list) {
      const row = host.createEl('label', { cls: 'bzrv-folder-add-row' });
      const box = row.createEl('input', { type: 'checkbox' });
      box.checked = true;
      box.value = path;
      const name = path.split('/').pop() || path;
      row.createSpan({ cls: 'bzrv-folder-add-name', text: name.replace(/\.md$/i, '') });
      const parent = path.slice(0, path.lastIndexOf('/'));
      if (parent) row.createSpan({ cls: 'bzrv-folder-add-dir', text: parent });
      boxes.push({ path, box });
    }

    const selected = (): string[] => boxes.filter((b) => b.box.checked).map((b) => b.path);
    const paint = (): void => {
      const n = selected().length;
      countEl.textContent = t('add.selectedN', { n, total: boxes.length });
      all.checked = n === boxes.length;
      all.indeterminate = n > 0 && n < boxes.length;
      ok.setText(n ? t('add.addNNotes', { n }) : t('add.add'));
      ok.disabled = n === 0;
    };
    all.onchange = () => {
      for (const b of boxes) b.box.checked = all.checked;
      paint();
    };
    for (const b of boxes) b.box.onchange = paint;

    const modal = uiModal({
      title: t('add.title'),
      head: true,
      content: body,
      maxWidth: 560,
      className: 'bzrv-folder-add-modal',
      onClose: () => finish(null),
    });
    const actions = modal.popup.createDiv({ cls: 'bzrv-edit-actions bzrv-folder-add-actions' });
    const cancel = actions.createEl('button', { cls: 'bzrv-btn', text: t('common.cancel') });
    cancel.onclick = () => {
      finish(null);
      modal.close();
    };
    const ok = actions.createEl('button', { cls: 'bzrv-btn bzrv-btn--primary', text: t('add.add') });
    ok.onclick = () => {
      const picked = selected();
      finish(picked);
      modal.close();
    };
    paint();
    window.setTimeout(() => all.focus(), 0);
  });
}
