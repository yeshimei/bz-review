/**
 * 复习监听器（ticket 098；ticket 099 修订）：
 *  - 监听文件夹：新建笔记走统一制卡流程（不再直接写库，2026-11-21）
 *  - 删除计划内文件 → 确认「是否同步移除复习记录？」
 *  - 重命名/移动计划内文件 → 自动更新路径（不再确认，ticket 099）
 *  - 监听文件夹添加：选择弹窗后立即确认存量收编（取消=什么都不做，不再写排除名单，ticket 099）
 * 依赖方向：store 层（confirm 为 core，无其它域 DOM）；经 index.ts 事件接线；refresh 函数体延迟解析。
 */
import { isUnderFolder as isUnderFolderCore, stripMdExt } from '../core/utils';
import type { App, TFile } from 'obsidian';
import { notice, notifySaveError, notifyUndo } from '../core/notice';
import { openFlowDialog } from '../core/flow-dialog';
import { tryGetSettings, saveSettings } from '../core/settings-provider';
import { ReviewDataManager } from './data';
import { openAddToReviewFlow, pickFolderNotes } from './add-flow';
import { t } from '../i18n/strings';

/** 设置里的数组字段运行期可能被旧数据写脏：只认数组，再按 string[] 读 */
function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? (v as string[]) : [];
}

/** 目录边界判定：path 恰为 folder 或位于其下（递归语义；core isUnderFolder 转发壳） */
export function isUnderFolder(folder: string, path: string): boolean {
  return isUnderFolderCore(folder, path);
}

/** ticket 100：自动加入提醒合并窗口（3 秒；测试可注入短值） */
export let REVIEW_AUTO_ADD_MERGE_MS = 3000;
export function __setAutoAddMergeMsForTests(ms: number): void {
  REVIEW_AUTO_ADD_MERGE_MS = ms;
}

/** ticket n2：改名通知合并窗口（3 秒；批量重命名只弹一条；测试可注入短值） */
export let RENAME_MERGE_MS = 3000;
export function __setRenameMergeMsForTests(ms: number): void {
  RENAME_MERGE_MS = ms;
}

/**
 * 文件夹加入复习的选择面板已搬到 add-flow.ts（2026-11-21）：
 * 文件树右键的「文件夹加入复习」和监听文件夹的存量收编现在共用同一块面板。
 */

export class ReviewWatcher {
  app: App;
  dataManager: ReviewDataManager;

  /** 删除确认防抖缓冲（多文件删除合并为一次确认） */
  private deleteQueue: string[] = [];
  private deleteTimer: number | null = null;
  /** ticket 100：新笔记自动加入提醒合并缓冲（3 秒窗口收集，多条合并一条通知） */
  private autoAddQueue: string[] = [];
  private autoAddTimer: number | null = null;
  /** ticket n2：改名通知合并缓冲（3 秒窗口收集；列表/文件树更新仍即时） */
  private renameQueue: string[] = [];
  private renameTimer: number | null = null;

  constructor(app: App, dataManager: ReviewDataManager) {
    this.app = app;
    this.dataManager = dataManager;
  }

  get watchedFolders(): string[] {
    return stringArray(tryGetSettings().reviewWatchedFolders)
      .filter((x) => typeof x === 'string' && x.trim().length > 0);
  }

  get excludedNotes(): string[] {
    return stringArray(tryGetSettings().reviewExcludedNotes);
  }

  isWatched(path: string): boolean {
    return this.watchedFolders.some((f) => isUnderFolder(f, path));
  }

  isExcluded(path: string): boolean {
    return this.excludedNotes.includes(path);
  }

  /** 追加排除名单（去重 + 落盘；手动/确认四类表态共用） */
  async excludePaths(paths: string[]): Promise<void> {
    const s = tryGetSettings();
    const cur = stringArray(s?.reviewExcludedNotes);
    let changed = false;
    for (const p of paths) {
      if (p && !cur.includes(p)) {
        cur.push(p);
        changed = true;
      }
    }
    if (!changed) return;
    if (s) s.reviewExcludedNotes = cur;
    await saveSettings();
  }

  /** ticket 57：单条解除排除记录（数据 reviewExcludedNotes 既有；仅补 UI 管理入口） */
  async removeExcludedNote(path: string): Promise<void> {
    const s = tryGetSettings();
    if (!s) return;
    const cur = stringArray(s.reviewExcludedNotes);
    const kept = cur.filter((p) => p !== path);
    if (kept.length === cur.length) return;
    s.reviewExcludedNotes = kept;
    await saveSettings();
  }

  /** vault create：监听目录内新建 md → 走统一流程（未排除、未在计划）；
   *   一次新建多篇时用 3 秒窗口合并，只开一个窗口。 */
  async onVaultCreate(file: TFile): Promise<void> {
    if (file.extension !== 'md') return;
    if (!this.isWatched(file.path)) return;
    if (this.isExcluded(file.path)) return;
    const items = await this.dataManager.loadItems();
    if (items.some((i) => i.filePath === file.path)) return;
    /* 2026-11-21 用户口径：自动监听也要走流程，不能直接写库。
       合并窗口保留：一次建 10 篇只弹一个制卡窗，不连开 10 个。 */
    this.autoAddQueue.push(file.path);
    if (this.autoAddTimer) return;
    this.autoAddTimer = window.setTimeout(() => {
      this.autoAddTimer = null;
      const batch = this.autoAddQueue;
      this.autoAddQueue = [];
      if (!batch.length) return;
      void openAddToReviewFlow(this.app, { kind: 'notes', paths: batch, from: 'watch' });
    }, REVIEW_AUTO_ADD_MERGE_MS);
  }

  /** vault delete：计划内文件删除 → 防抖合并确认「同步移除复习记录？」 */
  onVaultDelete(file: TFile): void {
    void (async () => {
      const items = await this.dataManager.loadItems();
      if (!items.some((i) => i.filePath === file.path)) return;
      this.deleteQueue.push(file.path);
      if (this.deleteTimer) return;
      const runDeleteBatch = async (): Promise<void> => {
        this.deleteTimer = null;
        const batch = this.deleteQueue;
        this.deleteQueue = [];
        if (!batch.length) return;
        const n = batch.length;
        // C10：口径与 confirmBatchAddForFolder 对齐——展示名剥 .md 扩展名
        const firstName = stripMdExt((batch[0] || '').split('/').pop() || '');
        void openFlowDialog({
          title: n > 1 ? t('watch.deleteTitleN', { n }) : t('watch.deleteTitle'),
          message:
            n > 1
              ? t('watch.deleteBodyN', { n })
              : t('watch.deleteBodyOne', { name: firstName }),
          actions: [
            { label: t('watch.keep'), value: 'cancel' },
            // danger（issue 291 评审补）：移除 = 同步删掉复习里的记录并写入排除名单
            //（删除类主动作，故主按钮不高亮；「保留」才是无损选项，手册 §9/§10）
            { label: t('watch.remove'), value: 'ok', cta: true, danger: true },
          ],
        }).then(async (v) => {
          if (v === 'ok') {
            // C-UX2：先快照待移除条目（撤销原样插回），移除后挂撤销通知——
            // 连带清理类删除同样有反悔窗口（与全域删除形制对齐）
            const cur = await this.dataManager.loadItems();
            const removed = cur.filter((i) => batch.includes(i.filePath));
            // A13：单趟 RMW 批量移除（原逐篇 removeItem = N 次全文件读写）
            await this.dataManager.removeItems(batch);
            // 仅监听目录内的删除写排除名单（防自动加回；目录外的删除无监听风险）
            await this.excludePaths(batch.filter((p) => this.isWatched(p)));
            notifyUndo(t('watch.removed', { n }), () => {
              void (async () => {
                try {
                  for (const item of removed) await this.dataManager.restoreItem(item);
                  // 撤销移除 = 这些路径不该继续排除，否则恢复回来的笔记会被自动加入挡住
                  for (const path of batch.filter((p) => this.isWatched(p))) {
                    await this.removeExcludedNote(path);
                  }
                  await this.refresh();
                } catch (e) {
                  notifySaveError(e, t('watch.restored'));
                }
              })();
            });
            await this.refresh();
          } else {
            void this.refresh();
          }
        });
      };
      this.deleteTimer = window.setTimeout(() => { void runDeleteBatch(); }, 300);
    })();
  }

  /** vault rename：计划内文件改名/移动 → 自动更新路径（ticket 099：不再弹确认）；
   *   ticket n2：通知改合并窗口（窗口内多条合并一条；列表/文件树刷新仍即时） */
  onVaultRename(file: TFile, oldPath: string): void {
    void (async () => {
      if (file.extension !== 'md') return;
      if (oldPath === file.path) return;
      const items = await this.dataManager.loadItems();
      if (!items.some((i) => i.filePath === oldPath)) return;
      const updated = await this.dataManager.updateFilePath(oldPath, file.path, file.basename);
      if (!updated) {
        // F11：新路径已被另一条目占用 → 条目悬挂旧路径成删除线，给人话提示而非静默
        notice(t('watch.pathExists'));
        return;
      }
      await this.refresh(); // 列表自动更新（即时）
      this.renameQueue.push(file.basename);
      if (this.renameTimer) return;
      this.renameTimer = window.setTimeout(() => {
        this.renameTimer = null;
        const batch = this.renameQueue;
        this.renameQueue = [];
        if (!batch.length) return;
        const shown = batch.slice(0, 3).join('、');
        const tail = batch.length > 3 ? t('watch.andMore', { n: batch.length - 3 }) : '';
        notice(
          batch.length > 1
            ? t('watch.pathsUpdated', { n: batch.length, shown, tail })
            : t('watch.pathsUpdatedShort'),
          'success'
        );
      }, RENAME_MERGE_MS);
    })();
  }

  /** 未加入候选：目录内全部 md − 已加入 − 已排除（递归；挂起记录占位路径天然排除） */
  collectAutoaddCandidates(folder: string, items: Array<{ filePath: string }>): string[] {
    return this.app.vault
      .getMarkdownFiles()
      .map((f) => f.path)
      .filter((p) => isUnderFolder(folder, p))
      .filter((p) => !items.some((i) => i.filePath === p))
      .filter((p) => !this.isExcluded(p));
  }

  /** 选择监听文件夹后的存量收编确认（ticket 099）：确认 → 批量全部加入并返回 true；取消 → 什么都不做返回 false（不写排除名单） */
  async confirmBatchAddForFolder(folder: string): Promise<boolean> {
    const items = await this.dataManager.loadItems();
    const candidates = this.collectAutoaddCandidates(folder, items);
    if (!candidates.length) return true; // 无存量候选：直接接受
    const v = await openFlowDialog({
      title: t('watch.batchAddTitle'),
      message: t('watch.batchAddBody', { folder, n: candidates.length }),
      actions: [
        { label: t('common.cancel'), value: 'cancel' },
        { label: t('common.add'), value: 'ok', cta: true },
      ],
    });
    if (v !== 'ok') return false;
    /* 二次确认之后走「文件夹加入复习」的选择面板：用户勾完再进统一制卡流程
       （2026-11-21 起不再勾完直接写库）。面板取消 = 整个文件夹不加入监听。 */
    const picked = await pickFolderNotes(folder, candidates);
    if (picked === null) return false;
    if (picked.length === 0) {
      notice(t('watch.noneChosen'), 'info');
      return true;
    }
    await openAddToReviewFlow(this.app, { kind: 'notes', paths: picked, from: 'folder' });
    return true;
  }

  /** 移除监听文件夹（ticket 099 追加）：同时清空该目录下全部排除记录——否则二次添加时存量被旧黑名单挡住。
   *  返回清理的排除条数（仅用于提示文案）。 */
  async removeWatchedFolder(folder: string): Promise<number> {
    const s = tryGetSettings();
    if (!s) return 0;
    const folders = stringArray(s.reviewWatchedFolders);
    const idx = folders.indexOf(folder);
    if (idx !== -1) folders.splice(idx, 1);
    s.reviewWatchedFolders = folders;
    const before = stringArray(s.reviewExcludedNotes);
    const kept = before.filter((p) => !isUnderFolder(folder, p));
    s.reviewExcludedNotes = kept;
    await saveSettings();
    return before.length - kept.length;
  }

  private async refresh(): Promise<void> {
    const { uiManager } = await import('./index');
    await uiManager?.refreshPanel();
    const { reviewApp } = await import('./app');
    await reviewApp.applyReviewStyles(this.app);
  }

  /** 卸载清理（定时器/缓冲） */
  destroy(): void {
    if (this.deleteTimer) {
      window.clearTimeout(this.deleteTimer);
      this.deleteTimer = null;
    }
    this.deleteQueue = [];
    if (this.autoAddTimer) {
      window.clearTimeout(this.autoAddTimer);
      this.autoAddTimer = null;
    }
    this.autoAddQueue = [];
    if (this.renameTimer) {
      window.clearTimeout(this.renameTimer);
      this.renameTimer = null;
    }
    this.renameQueue = [];
  }
}
