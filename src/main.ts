/**
 * Review（复习）插件入口
 *
 * 与 bz 的关系：复习计划从 bz 独立成付费插件，**bz 里那份原样保留不动**。
 * 付费形态照 bz Reader / 归物本：一个完整插件包，激活码离线验签；
 * 基础版 20 篇笔记 + 50 条划线卡，高级版不限，功能两边完全一致。
 *
 * 数据：自己的 review.json（默认 CONFIG/REVIEW），与 bz 的 CONFIG/STORAGE
 * 分开存，两个插件同时装也不会互相覆盖。
 */
import { Plugin } from 'obsidian';
import { DEFAULT_SETTINGS } from './settings';
import type BzSettings from './settings';
import { setApp } from './core/app';
import { setSettingsProvider, setSettingsSaver, setSettingsPanelOpener } from './core/settings-provider';
import { setAISettingsProvider, resetAIProviderCache } from './core/ai';
import {
  ensureReview,
  unloadReview,
  openReviewPanel,
  openReviewReport,
  openReviewAnalysis,
  openQuizPractice,
  reviewAddCurrent,
  reviewRemoveCurrent,
  reviewJumpOverdue,
  reviewStart,
  reviewMarkDialog,
  reviewMarkRating,
  uiManager,
} from './review';
import { refreshLicense, licenseSummary as licenseSummaryOf } from './data/entitlement';
import { ReviewPanelView } from './review/panel-view';
import { REVIEW_VIEW_TYPE } from './review/panel-mode';
import { migrateFromBz } from './data/migrate';
import { t } from './i18n';
import { installScopeGuard } from './core/scope';

export default class ReviewPlugin extends Plugin {
  settings: BzSettings;

  async onload(): Promise<void> {
    await this.loadSettings();

    // 样式作用域兜底：捕捉没走 markOwned 的自有节点（内联 HTML、第三方插入），
    // 给它们补上 data-bzrv，否则这些节点拿不到本插件的样式。
    this.register(installScopeGuard());

    setApp(this.app);
    setSettingsProvider(() => this.settings);
    setSettingsSaver(() => this.saveSettings());
    setAISettingsProvider(() => this.settings);
    /* 域代码里「去设置」的出口（核心只认「有人能开面板」，开哪页由这里定）。
       设置不再注册成原生设置页，而是主面板里的设置弹层——与 bz Reader 同形制：
       用户在哪儿用这个插件，就在哪儿改它的设置。 */
    setSettingsPanelOpener(() => {
      ensureReview(this.app);
      void uiManager?.openSettings();
    });

    // 启动时静默验一次码（离线，不发网络请求）
    await refreshLicense(this.settings.licenseKey);

    this.addRibbonIcon('calendar-check', t('复习计划', 'Review'), () => {
      ensureReview(this.app);
      openReviewPanel(this.app);
    });

    // 原生页形态（reviewPanelMode = native，默认）：面板住在一个普通标签页里
    this.registerView(REVIEW_VIEW_TYPE, (leaf) => new ReviewPanelView(leaf));

    const withReview =
      (fn: (app: typeof this.app) => void | Promise<void>) =>
      () => {
        ensureReview(this.app);
        void fn(this.app);
      };

    this.addCommand({
      id: 'review-open',
      name: t('打开复习计划', 'Open review plan'),
      callback: withReview((app) => openReviewPanel(app)),
    });
    this.addCommand({
      id: 'review-start',
      name: t('开始复习', 'Start review'),
      callback: withReview((app) => reviewStart(app)),
    });
    this.addCommand({
      id: 'review-add',
      name: t('把当前笔记加入复习计划', 'Add current note to review plan'),
      callback: withReview((app) => reviewAddCurrent(app)),
    });
    this.addCommand({
      id: 'review-remove',
      name: t('把当前笔记移出复习计划', 'Remove current note from review plan'),
      callback: withReview((app) => reviewRemoveCurrent(app)),
    });
    this.addCommand({
      id: 'review-overdue',
      name: t('跳到逾期复习', 'Jump to overdue review'),
      callback: withReview((app) => reviewJumpOverdue(app)),
    });
    this.addCommand({
      id: 'review-rate',
      name: t('选择复习难度', 'Pick review difficulty'),
      callback: withReview((app) => reviewMarkDialog(app)),
    });
    this.addCommand({
      id: 'review-undo',
      name: t('撤销上一次评级', 'Undo last rating'),
      callback: withReview(async () => {
        const { reviewApp } = await import('./review/app');
        await reviewApp.undoLastRating();
      }),
    });
    this.addCommand({
      id: 'review-force',
      name: t('不限到期，全部过一遍', 'Review everything now'),
      callback: withReview(async () => {
        const { reviewApp } = await import('./review/app');
        await reviewApp.startRoundSprint({ force: true });
      }),
    });
    this.addCommand({
      id: 'review-set-date',
      name: t('设置当前笔记的下次复习日期', 'Set next review date'),
      callback: withReview(async (app) => {
        const { openNextDateDialog } = await import('./review/next-date');
        await openNextDateDialog(app, app.workspace.getActiveFile());
      }),
    });
    this.addCommand({
      id: 'review-import-md',
      name: t('从当前笔记导入卡片', 'Import cards from current note'),
      callback: withReview(async (app) => {
        const file = app.workspace.getActiveFile();
        if (!file) {
          return;
        }
        const { parseMarkdownCards } = await import('./review/md-cards');
        const { importCardsFromMarkdown } = await import('./review/backup-io');
        const { reviewApp } = await import('./review/app');
        const { notice } = await import('./core/notice');
        reviewApp.ensure(app);
        const cards = parseMarkdownCards(await app.vault.cachedRead(file), file.path, file.basename);
        if (!cards.length) {
          notice('这篇里没有认出卡片（写法：`问题 :: 答案` 或 `{{挖空}}`）', 'warning');
          return;
        }
        const res = await importCardsFromMarkdown(reviewApp.dataManager!, cards);
        notice(
          `导入 ${res.added} 张${res.skipped ? `，跳过 ${res.skipped} 张（已存在）` : ''}${
            res.rejected ? `，${res.rejected} 张超出基础版上限` : ''
          }`,
          res.added ? 'success' : 'warning'
        );
        void reviewApp.refreshPanel();
      }),
    });
    for (const [id, label, kind] of [
      ['review-export', t('导出备份（JSON）', 'Export backup (JSON)'), 'json'],
      ['review-export-csv', t('导出表格（CSV）', 'Export spreadsheet (CSV)'), 'csv'],
    ] as const) {
      this.addCommand({
        id,
        name: label,
        callback: withReview(async (app) => {
          const { exportBackupFile } = await import('./review/backup-io');
          const { reviewApp } = await import('./review/app');
          const { notice } = await import('./core/notice');
          reviewApp.ensure(app);
          const items = await reviewApp.dataManager!.loadItems();
          const path = await exportBackupFile(app, items, kind);
          notice(`已导出 ${items.length} 条：${path}`, 'success');
        }),
      });
    }
    this.addCommand({
      id: 'review-restore',
      name: t('从备份恢复', 'Restore from backup'),
      callback: withReview(async (app) => {
        const { openRestoreDialog } = await import('./review/backup-dialog');
        await openRestoreDialog(app);
      }),
    });
    this.addCommand({
      id: 'review-forecast',
      name: t('未来复习负荷', 'Upcoming workload'),
      callback: withReview(async (app) => {
        const { reviewApp } = await import('./review/app');
        const { forecastLoad } = await import('./review/queue');
        const { openForecastDialog } = await import('./review/forecast-dialog');
        reviewApp.ensure(app);
        const items = await reviewApp.dataManager!.loadItems();
        openForecastDialog(app, forecastLoad(items, 30));
      }),
    });
    this.addCommand({
      id: 'review-export-stats',
      name: t('导出统计（CSV）', 'Export stats (CSV)'),
      callback: withReview(async (app) => {
        const { reviewApp } = await import('./review/app');
        const { exportStatsCsv } = await import('./review/export-actions');
        const { notice } = await import('./core/notice');
        reviewApp.ensure(app);
        const items = await reviewApp.dataManager!.loadItems();
        notice(`统计已导出：${await exportStatsCsv(app, items)}`, 'success');
      }),
    });
    this.addCommand({
      id: 'review-export-cards',
      name: t('划线卡导出为笔记', 'Export highlights to note'),
      callback: withReview(async (app) => {
        const { reviewApp } = await import('./review/app');
        const { exportCardsMarkdown } = await import('./review/export-actions');
        const { notice } = await import('./core/notice');
        reviewApp.ensure(app);
        const items = await reviewApp.dataManager!.loadItems();
        const path = await exportCardsMarkdown(app, items);
        notice(`已导出划线卡：${path}`, 'success');
      }),
    });
    this.addCommand({
      id: 'review-report',
      name: t('复习分析报告', 'Review report'),
      callback: withReview((app) => openReviewReport(app)),
    });
    this.addCommand({
      id: 'review-analysis',
      name: t('记忆分析', 'Memory analysis'),
      callback: withReview((app) => openReviewAnalysis(app)),
    });
    this.addCommand({
      id: 'review-quiz',
      name: t('做题练习', 'Quiz practice'),
      callback: withReview((app) => openQuizPractice(app)),
    });

    for (const [id, name, rating] of [
      ['review-again', t('复习评级：忘了', 'Rate: again'), 'again'],
      ['review-hard', t('复习评级：困难', 'Rate: hard'), 'hard'],
      ['review-good', t('复习评级：一般', 'Rate: good'), 'good'],
      ['review-easy', t('复习评级：简单', 'Rate: easy'), 'easy'],
    ] as const) {
      this.addCommand({
        id,
        name,
        callback: withReview((app) => reviewMarkRating(app, rating)),
      });
    }

    this.addCommand({
      id: 'review-migrate-bz',
      name: t('从 bz 导入复习计划', 'Import review plan from bz'),
      callback: async () => {
        const res = await migrateFromBz(this.app, this.settings);
        const { notice } = await import('./core/notice');
        notice(res.message, res.ok ? 'success' : 'warning');
      },
    });

    /* 设置不再走 addSettingTab：插件设置页从「选项 → 第三方插件 → 齿轮」里消失，
       改到主面板右上角的 ⚙️（openSettingsModal），与 bz Reader 一致。 */

    this.app.workspace.onLayoutReady(() => {
      if (this.settings.enableAutoNotify !== false) ensureReview(this.app);
    });
  }

  onunload(): void {
    unloadReview();
    // 原生页：插件卸了，挂在工作区里的标签页也要一起摘（否则留下一个空白 tab）
    this.app.workspace.detachLeavesOfType(REVIEW_VIEW_TYPE);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    resetAIProviderCache();
  }

  /** 设置页「激活」按钮 */
  async activateLicense(code: string): Promise<{ ok: boolean; message: string }> {
    const state = await refreshLicense(code);
    this.settings.licenseKey = code.trim();
    await this.saveSettings();
    return {
      ok: state.paid,
      message: state.paid
        ? `已激活高级版${state.name ? `（${state.name}）` : ''}，数量不限。`
        : '激活码无效或已过期。',
    };
  }

  licenseSummary(): string {
    return licenseSummaryOf();
  }
}
