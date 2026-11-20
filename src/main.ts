/**
 * Review（复习）插件入口
 *
 * 与 bz 的关系：复习计划从 bz 独立成付费插件，**bz 里那份原样保留不动**。
 * 付费形态照 bz Reader / 归物本：一个完整插件包，激活码离线验签；
 * 基础版 20 篇笔记 + 50 条划线卡，高级版不限，功能两边完全一致。
 *
 * 数据：自己的 review.json（默认库根 bz-review/storage），与 bz 的 CONFIG/STORAGE
 * 分开存，两个插件同时装也不会互相覆盖。
 */
import { Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, applyAccent } from './settings';
import type BzSettings from './settings';
import { setApp } from './core/app';
import { getSettings, saveSettings, setSettingsProvider, setSettingsSaver, setSettingsPanelOpener } from './core/settings-provider';
import { setAISettingsProvider, resetAIProviderCache } from './core/ai';
import {
  ensureReview,
  unloadReview,
  openReviewPanel,
  openReviewReport,
  openReviewBooks,
  openReviewCardManager,
  openQuizPractice,
  reviewAddCurrent,
  reviewAddSelection,
  reviewRemoveCurrent,
  reviewJumpOverdue,
  reviewStart,
  reviewMarkDialog,
  reviewMarkRating,
  uiManager,
} from './review';
import { refreshLicense, licenseSummary as licenseSummaryOf } from './data/entitlement';
import { readLicenseMirror, writeLicenseMirror, type CodeStorage } from './data/license-mirror';
import { getReviewPlanApi } from './review/reader-api';
import type { ReviewAddSummary, ReviewCardInput, ReviewNoteStatus } from './review/reader-api';
import { ReviewPanelView } from './review/panel-view';
import { reviewApp } from './review/app';
import type { CardMode } from './review/card-ai';
import { defaultCardMethod } from './review/card-mode';
import { REVIEW_VIEW_TYPE } from './review/panel-mode';
import { importFromBzWithConfirm } from './data/migrate';
import { isBzPluginEnabled } from './core/plugin-path';
import { t } from './i18n';
import { installScopeGuard, markOwned } from './core/scope';
import { notice, setNoticeEmbedded } from './core/notice';

/** 取 localStorage；隐私模式 / 移动端 WebView 可能抛错，退回 null（镜像降级，主流程照旧） */
function localStorageOf(): CodeStorage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export default class ReviewPlugin extends Plugin {
  settings: BzSettings;

  /**
   * 给 bz Reader 用的门面（2026-11-16）。
   *
   * 分工是「Reader 决定哪些内容值得复习，Review 只负责复习」，所以 Reader 那边
   * 挑完章节、出完题，只需要往这里交卡片。放在插件实例上而不是全局变量：
   * Reader 用 `app.plugins.plugins['bz-review'].reviewApi` 探测，拿不到就按
   * 「这台库没装 Review」降级，不会抛错。
   *
   * 每个方法进来先 `ensureReview`：Reader 可能在用户从没打开过复习面板之前
   * 就点了「加入复习」，那时域还没初始化、门面是空的。
   */
  readonly reviewApi = {
    /** 契约版本：v2 quota()；v3 embedInto()；v4 setDefaultCardMethod() / focusCard() */
    version: 4,
    addCards: async (cards: ReviewCardInput[]): Promise<ReviewAddSummary> => {
      ensureReview(this.app);
      const api = getReviewPlanApi();
      if (!api) return { added: 0, exists: 0, notFound: Array.isArray(cards) ? cards.length : 0 };
      return api.addCards(cards);
    },
    hasNote: async (path: string): Promise<boolean> => {
      ensureReview(this.app);
      const api = getReviewPlanApi();
      return api ? api.hasNote(path) : false;
    },
    statusOf: async (paths: string[]): Promise<ReviewNoteStatus[]> => {
      ensureReview(this.app);
      const api = getReviewPlanApi();
      return api ? api.statusOf(paths) : [];
    },
    /** 划线卡额度：阅读器批量列表据此提前标「超出基础版上限」（契约 v2） */
    quota: async () => {
      ensureReview(this.app);
      const api = getReviewPlanApi();
      return api ? api.quota() : { used: 0, limit: 0, remaining: 0, full: false };
    },
    /**
     * 把 reader 老版本「以后都用这个方式」的勾选值迁到 Review 的「新卡默认方式」（契约 v4）。
     * 只由 reader 在启动时调一次；已设过具体方式的机器不覆盖。
     */
    setDefaultCardMethod: async (mode: string): Promise<void> => {
      ensureReview(this.app);
      const valid = ['flashcard', 'cloze', 'context', 'quiz', 'plain'];
      if (!valid.includes(mode)) return;
      const settings = getSettings();
      if (settings.reviewCardDefaultMethod && settings.reviewCardDefaultMethod !== 'manual') return;
      settings.reviewCardDefaultMethod = mode as CardMode;
      await saveSettings();
    },
    /** Reader 制卡时读这里，决定要不要弹选方式的那一屏（契约 v4） */
    defaultCardMethod: async (): Promise<CardMode | null> => {
      ensureReview(this.app);
      return defaultCardMethod(getSettings());
    },
    /** 打开独立原生页并高亮指定卡片（契约 v4）：reader 已加入的划线点「去复习」走这里。 */
    focusCard: async (key: string): Promise<void> => {
      ensureReview(this.app);
      await openReviewPanel(this.app);
      await uiManager?.focusCardKey(key);
    },
    /**
     * 把主界面嵌进 bz-reader 的「复习」页签（契约 v3，2026-11-19）。
     *
     * 与原生页（panel-view.ts）同形制：宿主给内容区容器与头栏动作栏，Review 只借 DOM，
     * 不碰 bz-reader 自己的页签栏。品牌/标题那行让位给宿主的页签文字，四颗图标外置到
     * 动作栏，点击仍走 bindPanelHead 原有的切页逻辑。返回的函数由宿主收场时调用。
     */
    embedInto: (host: HTMLElement, actionsHost: HTMLElement, onClose: () => void): (() => void) => {
      ensureReview(this.app);
      const ui = uiManager;
      if (!ui) return () => {};
      // 两个宿主都挂作用域锚点，scoped 样式（.bzrv-panel-host / .bzrv-icon-btn…）才命中；
      // host 还必须带 .bzrv-panel-host，popup 的 position:absolute 才相对它定位而不是更外层。
      markOwned(host);
      host.classList.add('bzrv-panel-host');
      markOwned(actionsHost);
      ui.mountInto(host);
      ui.popup?.classList.add('bzrv-embed');
      /* 登记嵌入宿主：轮询据此认为「面板在眼前」，不再弹常驻逾期通知压住宿主图标。
         必须在 showMain 之前登记，首次刷新就要生效。 */
      reviewApp.embeddedHost = host;
      /* 嵌入形态下通知让位到右下角（2026-11-19）：右上角是宿主头栏的页签
         与四颗图标，进度通知压上去会挡住点击。 */
      setNoticeEmbedded(true);
      /* 面板自己的右上角就有那四颗图标，常驻的逾期通知会正压在上面
         （z 更高、点击落在通知上）——与原生页 onOpen 同口径，进面板先收掉。 */
      reviewApp.hideOverdueNotice();
      // 面板里点关闭 / ESC 不再 detach 标签页，而是通知宿主切回书库页。
      ui.onRequestClose = onClose;
      ui.embeddedOnClose = onClose;
      ui.mountEmbedActions(actionsHost);
      void ui.showMain();
      let cleaned = false;
      const cleanup = () => {
        // 宿主离开页签与关开关可能都调一次：必须幂等，单例 UIManager 禁二次收场。
        if (cleaned) return;
        cleaned = true;
        if (ui.embeddedCleanup === cleanup) ui.embeddedCleanup = null;
        ui.embeddedOnClose = null;
        ui.clearEmbed();
        /* 先解除「嵌入在眼前」登记：否则离开复习页后轮询仍以为面板开着，逾期通知再也不弹。 */
        if (reviewApp.embeddedHost === host) reviewApp.embeddedHost = null;
        setNoticeEmbedded(false);
        // releaseView 先清 onRequestClose 再 detachToBody + 隐藏，避开 hostedInView 下
        // hideMain → onRequestClose → cleanup → hideMain 的递归（与原生页 onClose 同路）。
        ui.releaseView();
        host.classList.remove('bzrv-panel-host');
      };
      ui.embeddedCleanup = cleanup;
      return cleanup;
    },
  };

  async onload(): Promise<void> {
    await this.loadSettings();
    // 强调色：把落盘档位挂到 body，CSS 按 body[data-bzaccent] 选色；之后设置页切换会就地同步。
    applyAccent(this.settings.accent);

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
    /* anchorKey 2026-11-19 起生效：「去设置 AI」要直接落到 AI 那一组，
       而不是只把设置页打开让用户自己往下翻。 */
    setSettingsPanelOpener((_domainId, anchorKey) => {
      ensureReview(this.app);
      void uiManager?.openSettings(anchorKey);
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
    /* 选中一段文字就能做成一张卡（2026-11-15）。走 editorCallback：只有在笔记里
       有光标时才可用，菜单里不会出现一颗点了没反应的命令。 */
    this.addCommand({
      id: 'review-add-selection',
      name: t('把选中内容加入复习计划', 'Add selection to review plan'),
      editorCallback: () => {
        void reviewAddSelection(this.app);
      },
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
    this.addCommand({
      id: 'review-import-anki',
      name: t('从 Anki 文件导入卡片', 'Import cards from Anki file'),
      callback: withReview(async (app) => {
        const { importAnkiFromPicker } = await import('./review/anki-import');
        const { reviewApp } = await import('./review/app');
        reviewApp.ensure(app);
        await importAnkiFromPicker(app, reviewApp.dataManager!);
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
      id: 'review-achievements',
      name: t('成就', 'Achievements'),
      callback: () => {
        void (async () => {
          const { uiManager } = await import('./review/index');
          await uiManager?.openAchievements();
        })();
      },
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
      id: 'review-book-report',
      name: t('按书档案', 'Book report'),
      callback: withReview((app) => openReviewBooks(app)),
    });
    this.addCommand({
      id: 'review-card-manager',
      name: t('卡片管理器', 'Card manager'),
      callback: withReview((app) => openReviewCardManager(app)),
    });
    this.addCommand({
      id: 'review-export-book-report',
      name: t('导出按书报告（Markdown）', 'Export book report (Markdown)'),
      callback: withReview(async (app) => {
        const { canUseCapability, capabilityBlock } = await import('./data/entitlement');
        const { notice } = await import('./core/notice');
        if (!canUseCapability('bookReport')) {
          notice(capabilityBlock('bookReport').message, 'warning');
          return;
        }
        try {
          const { reviewApp } = await import('./review/app');
          const { exportBookReportMarkdown } = await import('./review/export-actions');
          reviewApp.ensure(app);
          const items = await reviewApp.dataManager!.loadItems();
          const path = await exportBookReportMarkdown(app, items);
          notice(path ? `按书报告已导出：${path}` : '还没有复习数据，先加入条目并完成一次复习。', path ? 'success' : 'warning');
        } catch (e) {
          const { notifyActionError } = await import('./core/notice');
          notifyActionError(e, '导出按书报告');
        }
      }),
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

    /* 没装 bz 就不注册命令：命令面板和设置页同一口径，不给人一条点了只会报错的入口 */
    if (isBzPluginEnabled(this.app)) {
      this.addCommand({
        id: 'review-migrate-bz',
        name: t('从 bz 导入复习计划', 'Import review plan from bz'),
        callback: () => importFromBzWithConfirm(this.app, this.settings),
      });
    }

    /* 设置不再走 addSettingTab：插件设置页从「选项 → 第三方插件 → 齿轮」里消失，
       改到主面板右上角的 ⚙️（openSettingsModal），与 bz Reader 一致。 */

    this.app.workspace.onLayoutReady(() => {
      if (this.settings.enableAutoNotify !== false) ensureReview(this.app);
    });
  }

  onunload(): void {
    unloadReview();
    // 原生页：插件卸了，挂在工作区里的标签页也要一起摘（否则留下一个空白 tab）
    
  }

  async loadSettings(): Promise<void> {
    const loaded: unknown = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded && typeof loaded === 'object' ? loaded : {});
    /* data.json 被清掉 / 删目录重装时从 localStorage 镜像把码拿回来。
       镜像里只有码原文，启动时仍走 refreshLicense 真验签——塞假码没用。 */
    if (!this.settings.licenseKey) {
      const mirrored = readLicenseMirror(localStorageOf());
      if (mirrored) {
        this.settings.licenseKey = mirrored;
        await this.saveData(this.settings); // 顺手写回 data.json，下次不必再借镜像
      }
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    writeLicenseMirror(localStorageOf(), this.settings.licenseKey);
    resetAIProviderCache();
  }

  /** 设置页「激活」按钮：失败不动当前授权，也不写盘——真码要留着 */
  async activateLicense(code: string): Promise<{ ok: boolean; message: string }> {
    const state = await refreshLicense(code, false);
    if (!state.paid) {
      return { ok: false, message: '激活码无效或已过期，原来的激活码已保留。' };
    }
    this.settings.licenseKey = code.trim();
    await this.saveSettings();
    return {
      ok: true,
      message: `已激活高级版${state.name ? `（${state.name}）` : ''}，数量不限。`,
    };
  }

  licenseSummary(): string {
    return licenseSummaryOf();
  }
}
