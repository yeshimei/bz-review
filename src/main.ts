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
} from './review';
import { refreshLicense, licenseSummary as licenseSummaryOf } from './data/entitlement';
import { ReviewSettingTab } from './settings-tab';
import { migrateFromBz } from './data/migrate';
import { t } from './i18n';

export default class ReviewPlugin extends Plugin {
  settings: BzSettings;

  async onload(): Promise<void> {
    await this.loadSettings();

    setApp(this.app);
    setSettingsProvider(() => this.settings);
    setSettingsSaver(() => this.saveSettings());
    setAISettingsProvider(() => this.settings);
    /* 域代码里「去设置」的出口（核心只认「有人能开面板」，开哪页由这里定） */
    setSettingsPanelOpener(() => {
      const setting = (this.app as unknown as { setting?: { openTabById?: (id: string) => void } }).setting;
      setting?.openTabById?.(this.manifest.id);
    });

    // 启动时静默验一次码（离线，不发网络请求）
    await refreshLicense(this.settings.licenseKey);

    this.addRibbonIcon('calendar-check', t('复习计划', 'Review'), () => {
      ensureReview(this.app);
      openReviewPanel(this.app);
    });

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

    this.addSettingTab(new ReviewSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      if (this.settings.enableAutoNotify !== false) ensureReview(this.app);
    });
  }

  onunload(): void {
    unloadReview();
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
