/**
 * Review（复习）插件入口
 *
 * 与 bz 的关系：复习从 bz 独立成付费插件，**bz 里那份原样保留不动**。
 * 付费形态照 bz Reader / 归物本：一个完整插件包，激活码离线验签；
 * 基础版笔记与划线卡合计 50 条，高级版不限，功能两边完全一致。
 *
 * 数据：自己的 review.json（默认库根 bz-review/storage），与 bz 的 CONFIG/STORAGE
 * 分开存，两个插件同时装也不会互相覆盖。
 */
import { Plugin, TFile, TFolder } from 'obsidian';
import { DEFAULT_SETTINGS, applyAccent } from './settings';
import type BzSettings from './settings';
import { setApp } from './core/app';
import { setPluginRelDir } from './core/plugin-path';
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
  reviewAddPath,
  reviewRemoveCurrent,
  reviewJumpOverdue,
  reviewStart,
  reviewMarkDialog,
  reviewMarkRating,
  openCardWizardForAdd,
  uiManager,
} from './review';
import type { CardWizardOptions } from './review/card-wizard';
import { openAddToReviewFlow } from './review/add-flow';
import { bindStudyReviewTab } from './review/embedded-home';
import {
  activateLicense as activateLicenseOf,
  refreshLicense,
  licenseFacts,
  setLicenseFailHistory,
  setLicenseFactsHook,
  licenseSummary as licenseSummaryOf,
  setLatestVersion,
  setPluginVersion,
} from './data/entitlement';
import { refreshRevoked } from './data/revoked';
import { ensureLatestVersion, hasUpdate, readUpdateState, shouldNotify, writeUpdateState } from './data/plugin-update';
import { openUpdateNote } from './core/update-note';
import { readLicenseMirror, writeLicenseMirror, type CodeStorage } from './data/license-mirror';
import { clockSeenAt, noteSeen, seedClock } from './data/trusted-clock';
import { getReviewPlanApi } from './review/reader-api';
import type { ReviewAddSummary, ReviewCardInput, ReviewNoteStatus } from './review/reader-api';
import { ReviewPanelView } from './review/panel-view';
import { reviewApp } from './review/app';
import type { CardMode } from './review/card-ai';
import { defaultCardMethod } from './review/card-mode';
import { REVIEW_VIEW_TYPE } from './review/panel-mode';
import { importFromBzWithConfirm } from './data/migrate';
import { isBzPluginEnabled } from './core/plugin-path';
import { hostLanguageCode, initLocale, isLocale, t } from './i18n';
import { BzReviewSettingTab } from './settings-tab';
import { installScopeGuard, markOwned } from './core/scope';
import { setNoticeEmbedded } from './core/notice';
import { devAutoOpen } from './core/dev-auto-open';

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
    /** 契约版本：v2 quota()；v3 embedInto()；v4 setDefaultCardMethod() / focusCard()；
     *  v5 openCardFlow()——统一制卡流程搬进 Review，Reader 只交来源；
     *  v6 openReaderFlow()——从阅读器整条流程（选书 / 挑范围 / AI 挑）也归 Review，
     *  Reader 只留内容接口。 */
    version: 6,
    addCards: async (cards: ReviewCardInput[]): Promise<ReviewAddSummary> => {
      ensureReview(this.app);
      const api = getReviewPlanApi();
      if (!api) return { added: 0, exists: 0, notFound: Array.isArray(cards) ? cards.length : 0 };
      return api.addCards(cards);
    },
    /**
     * 统一制卡流程（契约 v5，2026-11-21）。
     *
     * 阅读器不再自己做界面：挑完内容把来源交过来，选方式 / 出题面（含挖空
     * 手工拖选）/ 确认 / 入库全在 Review 里做。老版本 Reader 仍可继续用
     * addCards 直接交卡。
     */
    openCardFlow: (opts: CardWizardOptions): void => {
      ensureReview(this.app);
      openCardWizardForAdd(this.app, opts);
    },
    /**
     * 从阅读器加入复习（契约 v6，2026-11-21）。
     *
     * Reader 的书内入口只把 bookId 交过来；选书、挑范围（按划线 / 按章节）、
     * 字数与每章上限、AI 挑重点，全在这个窗口里做。不给 bookId 就先列书。
     */
    openReaderFlow: (opts?: { bookId?: string }): void => {
      ensureReview(this.app);
      /* 走统一入口，而不是直接开挑内容窗：所有「加入复习」只有一个分流点
         （review/add-flow.ts），以后加来源不会又冒出一个旁路。 */
      void openAddToReviewFlow(this.app, { kind: 'reader', bookId: opts?.bookId });
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
      /* 嵌入态宿主画的「复习」页签也承担回主列表：与独立页顶部页签同一语义。
         收场时一并解绑，离开复习页后点别处的同名元素不会再触发。 */
      const unbindStudyTab = bindStudyReviewTab(actionsHost, () => ui.goHome());
      let cleaned = false;
      const cleanup = () => {
        // 宿主离开页签与关开关可能都调一次：必须幂等，单例 UIManager 禁二次收场。
        if (cleaned) return;
        cleaned = true;
        unbindStudyTab();
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
    /* 把本插件的真实目录注入 core：pluginRelDirOf 旧实现写死 bz 主插件目录，
       一旦有代码走它（如 bootstrapStorageDir）就会把路径算到 bz 那边去。 */
    setPluginRelDir(this.manifest.dir);
    await this.loadSettings();
    /* 界面语言：设置里的偏好优先（auto = 跟随 Obsidian），读不到宿主语言退回中文。
       必须在注册命令 / ribbon / 菜单之前定下来——这三类只在插件加载时求值一次。 */
    initLocale(isLocale(this.settings.language) ? this.settings.language : 'auto', hostLanguageCode());
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

    /* 授权事实（封没封 / 为什么掉级 / 上次激活栽在哪）由 entitlement 算，
       这里负责写进 data.json——bz 的探针从那份文件读，它读不到内存。
       失败历史先灌回去：重启一次就看不出「他上次激活栽在哪」了。 */
    setLicenseFailHistory(this.settings.licenseActivateFail, this.settings.licenseActivateFailAt ?? 0);
    setLicenseFactsHook(() => {
      void this.syncLicenseFacts();
    });

    // 启动时静默验一次码（离线验签；试用码会再联网确认一次最新版）
    setPluginVersion(String(this.manifest?.version || ''));
    await refreshLicense(this.settings.licenseKey);
    /* 停用名单的后台核对（2026-11-22）：24 小时内不重复，不 await、不阻塞
       启动。拉不到就放行——离线用户不该被这道门卡住。 */
    this.watchRevoked();
    /* 检查更新（2026-11-22）：默认自动查，24 小时最多一次，有新版弹一次。
       与试用码共用同一份「最新版」缓存，不重复联网。 */
    void this.checkUpdateInBackground();

    this.addRibbonIcon('calendar-check', t('ribbon.review'), () => {
      ensureReview(this.app);
      void openReviewPanel(this.app);
    });

    // 原生页形态（reviewPanelMode = native，默认）：面板住在一个普通标签页里
    this.registerView(REVIEW_VIEW_TYPE, (leaf) => new ReviewPanelView(leaf));

    /* 笔记里选中一段文字 → 右键「加入复习」：独立使用这个插件时的主入口。
       Obsidian 把当前 editor 作为第二个参数交过来，直接用它取选区范围，
       不依赖 activeEditor 的时序（右键时它可能还没切换过来）。 */
    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor) => {
        menu.addItem((item) => {
          item
            .setTitle(t('menu.addToReview'))
            .setIcon('plus-with-circle')
            .onClick(() => {
              void reviewAddSelection(this.app, editor);
            });
        });
      }),
    );

    /* 文件树右键「加入复习」（2026-11-21 用户口径）：只给文件夹与 .md 笔记
       加这一项，其它文件类型一概不出现。点下去不是直接写库——单篇进统一制卡
       流程，文件夹先弹「勾选哪几篇」再进同一个流程。 */
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        const isNote = file instanceof TFile && file.extension.toLowerCase() === 'md';
        const isFolder = file instanceof TFolder;
        if (!isNote && !isFolder) return;
        menu.addItem((item) => {
          item
            .setTitle(isFolder
              ? t('menu.addFolderToReview')
              : t('menu.addToReview'))
            .setIcon('plus-with-circle')
            .onClick(() => {
              void reviewAddPath(this.app, file.path, isFolder);
            });
        });
      }),
    );

    const withReview =
      (fn: (app: typeof this.app) => void | Promise<void>) =>
      () => {
        ensureReview(this.app);
        void fn(this.app);
      };

    this.addCommand({
      id: 'review-open',
      name: t('cmd.open'),
      callback: withReview((app) => openReviewPanel(app)),
    });
    this.addCommand({
      id: 'review-start',
      name: t('cmd.start'),
      callback: withReview((app) => reviewStart(app)),
    });
    this.addCommand({
      id: 'review-add',
      name: t('cmd.addCurrent'),
      callback: withReview((app) => reviewAddCurrent(app)),
    });
    this.addCommand({
      id: 'review-add-reader',
      name: t('cmd.addFromReader'),
      callback: withReview((app) => openAddToReviewFlow(app, { kind: 'reader' })),
    });
    /* 选中一段文字就能做成一张卡（2026-11-15）。走 editorCallback：只有在笔记里
       有光标时才可用，菜单里不会出现一颗点了没反应的命令。 */
    this.addCommand({
      id: 'review-add-selection',
      name: t('cmd.addSelection'),
      editorCallback: () => {
        void reviewAddSelection(this.app);
      },
    });
    this.addCommand({
      id: 'review-remove',
      name: t('cmd.removeCurrent'),
      callback: withReview((app) => reviewRemoveCurrent(app)),
    });
    this.addCommand({
      id: 'review-overdue',
      name: t('cmd.jumpOverdue'),
      callback: withReview((app) => reviewJumpOverdue(app)),
    });
    this.addCommand({
      id: 'review-rate',
      name: t('cmd.rate'),
      callback: withReview((app) => reviewMarkDialog(app)),
    });
    this.addCommand({
      id: 'review-undo',
      name: t('cmd.undo'),
      callback: withReview(async () => {
        const { reviewApp } = await import('./review/app');
        await reviewApp.undoLastRating();
      }),
    });
    this.addCommand({
      id: 'review-force',
      name: t('cmd.reviewAll'),
      callback: withReview(async () => {
        const { reviewApp } = await import('./review/app');
        await reviewApp.startRoundSprint({ force: true });
      }),
    });
    this.addCommand({
      id: 'review-set-date',
      name: t('cmd.setNextDate'),
      callback: withReview(async (app) => {
        const { openNextDateDialog } = await import('./review/next-date');
        await openNextDateDialog(app, app.workspace.getActiveFile());
      }),
    });
    this.addCommand({
      id: 'review-import-md',
      name: t('cmd.importMd'),
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
          notice(t('notice.importMd.empty'), 'warning');
          return;
        }
        const res = await importCardsFromMarkdown(reviewApp.dataManager!, cards);
        /* 配额提示来自数据层（中文），英文界面下暂时仍会显示中文——错误码化在后续批次。 */
        const detail = res.overLimitMessage
          ? `。${res.overLimitMessage}`
          : res.rejected
            ? t('notice.importMd.atLimit')
            : '';
        const summary =
          t('notice.importMd.done', { added: res.added }) +
          (res.skipped ? t('notice.importMd.skipped', { skipped: res.skipped }) : '') +
          detail;
        notice(summary, res.overLimitMessage || res.rejected ? 'warning' : res.added ? 'success' : 'warning');
        void reviewApp.refreshPanel();
      }),
    });
    this.addCommand({
      id: 'review-import-anki',
      name: t('cmd.importAnki'),
      callback: withReview(async (app) => {
        const { importAnkiFromPicker } = await import('./review/anki-import');
        const { reviewApp } = await import('./review/app');
        reviewApp.ensure(app);
        await importAnkiFromPicker(app, reviewApp.dataManager!);
      }),
    });
    for (const [id, label, kind] of [
      ['review-export', t('cmd.exportBackup'), 'json'],
      ['review-export-csv', t('cmd.exportCsv'), 'csv'],
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
          notice(t('notice.exportBackup.done', { n: items.length, path }), 'success');
        }),
      });
    }
    this.addCommand({
      id: 'review-restore',
      name: t('cmd.restoreBackup'),
      callback: withReview(async (app) => {
        const { openRestoreDialog } = await import('./review/backup-dialog');
        await openRestoreDialog(app);
      }),
    });
    this.addCommand({
      id: 'review-backup',
      name: t('cmd.backupHistory'),
      callback: withReview(async (app) => {
        const { openBackupHistoryDialog } = await import('./review/backup-history-dialog');
        await openBackupHistoryDialog(app);
      }),
    });
    this.addCommand({
      id: 'review-forecast',
      name: t('cmd.forecast'),
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
      name: t('cmd.achievements'),
      callback: () => {
        void (async () => {
          /* 这条命令是唯一没走 withReview 的：enableAutoNotify=false 且面板从未打开时
             uiManager 还是 null，openAchievements 会被可选链吞掉、点了没反应。先初始化。 */
          ensureReview(this.app);
          const { uiManager } = await import('./review/index');
          await uiManager?.openAchievements();
        })();
      },
    });
    this.addCommand({
      id: 'review-export-stats',
      name: t('cmd.exportStats'),
      callback: withReview(async (app) => {
        const { reviewApp } = await import('./review/app');
        const { exportStatsCsv } = await import('./review/export-actions');
        const { notice } = await import('./core/notice');
        reviewApp.ensure(app);
        const items = await reviewApp.dataManager!.loadItems();
        notice(t('notice.exportStats.done', { path: await exportStatsCsv(app, items) }), 'success');
      }),
    });
    this.addCommand({
      id: 'review-export-cards',
      name: t('cmd.exportCards'),
      callback: withReview(async (app) => {
        const { reviewApp } = await import('./review/app');
        const { exportCardsMarkdown } = await import('./review/export-actions');
        const { notice } = await import('./core/notice');
        reviewApp.ensure(app);
        const items = await reviewApp.dataManager!.loadItems();
        const path = await exportCardsMarkdown(app, items);
        notice(t('notice.exportCards.done', { path }), 'success');
      }),
    });
    this.addCommand({
      id: 'review-report',
      name: t('cmd.report'),
      callback: withReview((app) => openReviewReport(app)),
    });
    this.addCommand({
      id: 'review-book-report',
      name: t('cmd.bookReport'),
      callback: withReview((app) => openReviewBooks(app)),
    });
    this.addCommand({
      id: 'review-card-manager',
      name: t('cmd.cardManager'),
      callback: withReview((app) => openReviewCardManager(app)),
    });
    this.addCommand({
      id: 'review-export-book-report',
      name: t('cmd.exportBookReport'),
      callback: withReview(async (app) => {
        const { notice } = await import('./core/notice');
        try {
          const { reviewApp } = await import('./review/app');
          const { exportBookReportMarkdown } = await import('./review/export-actions');
          reviewApp.ensure(app);
          const items = await reviewApp.dataManager!.loadItems();
          const path = await exportBookReportMarkdown(app, items);
          notice(
            path ? t('notice.exportBookReport.done', { path }) : t('notice.exportBookReport.empty'),
            path ? 'success' : 'warning'
          );
        } catch (e) {
          const { notifyActionError } = await import('./core/notice');
          notifyActionError(e, t('notice.exportBookReport.action'));
        }
      }),
    });
    this.addCommand({
      id: 'review-quiz',
      name: t('cmd.quiz'),
      callback: withReview((app) => openQuizPractice(app)),
    });

    for (const [id, name, rating] of [
      ['review-again', t('cmd.rateAgain'), 'again'],
      ['review-hard', t('cmd.rateHard'), 'hard'],
      ['review-good', t('cmd.rateGood'), 'good'],
      ['review-easy', t('cmd.rateEasy'), 'easy'],
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
        name: t('cmd.migrateBz'),
        callback: () => importFromBzWithConfirm(this.app, this.settings),
      });
    }

    /* 原生设置页门牌（2026-11-26 加回）：只放一行「打开设置面板」按钮，点了
       先收宿主设置 Modal，再按 Reader 有没有开内嵌复习页分流（见 settings-tab.ts）。
       真正的设置仍在主面板内置的「设置」页，这层不重复一份。 */
    this.addSettingTab(new BzReviewSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      if (this.settings.enableAutoNotify !== false) ensureReview(this.app);
      // 开发辅助：测试库数据目录里放了 debug-open.json 就自动直达对应命令（没有则静默）
      devAutoOpen(this.app, this.settings.storagePath);
    });
  }

  onunload(): void {
    unloadReview();
    /* 卸载后 entitlement 还活着（模块级单例），它再触发落盘就是对着已卸载的实例
       写文件：把钩子摘掉。重载时 onload 会重新注册。 */
    setLicenseFactsHook(null);
    /* 原生页：插件卸了，挂在工作区里的标签页也要一起摘（否则留下一个空白 tab）。
       unloadReview 里 uiManager.destroy() 已先把 onRequestClose 置空，此时 detach
       触发的视图 onClose 不会再反向操作已销毁的面板。 */
    for (const leaf of this.app.workspace.getLeavesOfType(REVIEW_VIEW_TYPE)) {
      leaf.detach();
    }
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
    /* 可信时间：先把 data.json 里的高水位灌回来，再把「现在」顶上去。
       两处存储互为备份——只清 localStorage 或只清 data.json，都不会让
       系统时钟往回拨变成「时间倒流」。 */
    seedClock(this.settings.licenseSeenAt ?? 0);
    noteSeen(Date.now());
  }

  async saveSettings(): Promise<void> {
    /* 高水位跟着设置一起落盘：localStorage 是另一份，两边同时写。 */
    this.settings.licenseSeenAt = clockSeenAt();
    await this.saveData(this.settings);
    writeLicenseMirror(localStorageOf(), this.settings.licenseKey);
    resetAIProviderCache();
  }

  /**
   * 设置页「激活」按钮：失败不动当前授权，也不写盘——真码要留着。
   *
   * 2026-11-22 起走 entitlement 的 activateLicense：验签之后还要联网核对一次
   * 停用名单。首次激活必须能拉到名单，拉不到明确要求联网（不悄悄放行）。
   */
  async activateLicense(code: string): Promise<{ ok: boolean; message: string }> {
    const res = await activateLicenseOf(code);
    if (!res.ok) return { ok: false, message: res.message };
    this.settings.licenseKey = code.trim();
    await this.saveSettings();
    await this.syncLicenseFacts();
    return { ok: true, message: res.message };
  }

  /**
   * 停用名单的后台看守（2026-11-22，与 bz Reader 同口径）。
   *
   * **只在启动时查一次**，24 小时内不重复（节流在 data/revoked 里，靠本地
   * 记下的 `checkedAt`）。反复启停、切库、插件重载都不会把两个 CDN 当接口刷。
   *
   * 命中只做两件事：说一句「这枚码已停用」（不弹窗、不打断复习），并把结论
   * 同步进 data.json——bz 的探针靠那个字段读真实授权状态，否则被封的设备在
   * 看板上还是「高级版」，封码到底有没有生效就只能靠猜。
   *
   * 码本身不删：解封后下次启动自动恢复，用户不必回头翻邮件找码。
   */
  /**
   * 检查线上有没有新版本（2026-11-22，与 bz Reader 同款）。
   *
   * 三条口径：默认自动查（没有开关）、24 小时最多一次、每个新版本只弹一次。
   * 失败静默：离线 / 被墙 / 清单坏了，一个字都不说，下次启动再试。
   *
   * 延迟 4 秒再查：不跟首帧、停用名单抢网络和注意力。弹窗只提醒「去
   * Obsidian 设置里检查更新」，不下载、不替换任何文件。
   */
  private async checkUpdateInBackground(): Promise<void> {
    try {
      const state = readUpdateState();
      /* 不再看 24 小时节流：`ensureLatestVersion` 自己会决定要不要请求，
         拿到版本后由 `notified` 保证「每个新版本只弹一次」。这里若再加一道
         `shouldCheck`，试用码用户启动时那次 refresh 刚写热缓存，更新提醒会
         被误判成「刚查过」而永远不弹。 */
      await new Promise<void>((done) => window.setTimeout(done, 4_000));
      const latest = await ensureLatestVersion();
      if (!latest) return;
      /* 启动早期网络未必就绪，refreshLicense 那次可能没拿到；这里拿到后
         同步给授权判定，设置页下一次重绘就是正确状态。 */
      setLatestVersion(latest);
      const current = String(this.manifest?.version || '');
      const checkedAt = Date.now();
      if (!hasUpdate(current, latest)) {
        writeUpdateState({ checkedAt, notified: state.notified, latest });
        return;
      }
      if (!shouldNotify(state, latest)) return;
      /* 先记账再弹：弹窗期间崩溃也不会下次启动再骚扰一遍 */
      writeUpdateState({ checkedAt, notified: latest, latest });
      openUpdateNote(current, latest);
    } catch (e) {
      /* 更新检查是附加功能：出错只记一条 warn，绝不能影响插件启动 */
      console.warn('[bz-review] update check failed:', e);
    }
  }

  private watchRevoked(): void {
    /* 上次启动的结论先落盘：命中过的设备这次可能 24 小时内不再拉名单 */
    void this.syncLicenseFacts();
    const code = this.settings.licenseKey;
    if (!code) return;
    void refreshRevoked(code)
      .then((verdict) => {
        if (verdict === 'hit') {
          void import('./core/notice').then(({ notice }) => {
            notice(t('notice.license.revoked'), 'error');
          });
        }
        if (verdict === 'hit' || verdict === 'clear') void this.syncLicenseFacts();
      })
      .catch(() => {
        /* 拉名单失败什么都不说：离线用户不该被打扰 */
      });
  }

  /**
   * 把授权事实同步进 data.json（bz 探针读它）。
   *
   * 四样：封没封、什么时候封的、为什么是这个档位、上次激活栽在哪。
   * 逐字段比对后再写盘——这几样一天变不了几次，没必要每次启动都动文件。
   */
  private async syncLicenseFacts(): Promise<void> {
    const f = licenseFacts();
    const s = this.settings;
    if (
      s.licenseRevoked === f.revoked &&
      s.licenseRevokedAt === f.revokedAt &&
      s.licenseTierReason === f.tierReason &&
      s.licenseActivateFail === f.activateFail &&
      s.licenseActivateFailAt === f.activateFailAt
    ) {
      return;
    }
    s.licenseRevoked = f.revoked;
    s.licenseRevokedAt = f.revokedAt;
    s.licenseTierReason = f.tierReason;
    s.licenseActivateFail = f.activateFail;
    s.licenseActivateFailAt = f.activateFailAt;
    await this.saveSettings();
  }

  licenseSummary(): string {
    return licenseSummaryOf();
  }
}
