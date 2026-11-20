/**
 * 复习入口（ticket 16 修正版：对齐源码 entry，含 4 快捷命令与完整事件监听）
 * 命令（review-*）由 main.ts 裸注册（含 review-mark-again/hard/good/easy）。
 */
import { stripMdExt } from '../core/utils';
import type { App, EventRef, Events, TFile } from 'obsidian';
import { notice, notifyUndo, notifySaveError, notifyActionError } from '../core/notice';
import { onDomainEvent, emitDomainEvent } from '../core/domain-bus';
import { ReviewDataManager, isCardItem } from './data';
import type { ReviewCard } from './data';
import { ReviewWatcher } from './watch';
import { UIManager } from './ui';
import { reviewApp } from './app';
import { openQuizPanel, unloadQuizPanel } from './quiz-panel';
import { confirmRemovePlan } from './confirm-flows';
import { resetQuiz } from './quiz-core';
import { closeStatsModal } from './stats-ui';
import { unloadReviewAnalysis } from './analysis/index';
import { cancelActiveFlowDialog } from '../core/flow-dialog';
import type { Rating } from './fsrs';
import { setReviewPlanApi } from './reader-api';
import { noteCardKey, selectionRange } from './note-source';
import { panelModeOf, REVIEW_VIEW_TYPE } from './panel-mode';
import { embeddedReviewRoute } from './reader-embed';
import { tryGetSettings } from '../core/settings-provider';
import { canUseCapability, capabilityBlock } from '../data/entitlement';
import {
  applyCardContent,
  cardModeOf,
  defaultCardMethod,
  ensureCardContent,
  generateCardContent,
  modeOfCard,
  queueCardPreparation,
  safeMakeAI,
  type CardContentDraft,
  type CardMode,
  type CardPrepareContext,
} from './card-ai';
import { pickCardMethod } from './card-flow';
import { getCardQuiz, saveCardQuiz } from './card-quiz-store';
import { cardQuota, quizOf, withoutPrepared } from './reader-input';
import { planCounts } from './data';
import {
  addNote as planAddNote,
  addNotes as planAddNotes,
  hasNote as planHasNote,
  removeNote as planRemoveNote,
  addCards as planAddCards,
  removeCard as planRemoveCard,
  statusOf as planStatusOf,
} from './plan-ops';

let initialized = false;
export let dataManager: ReviewDataManager | null = null;
export let uiManager: UIManager | null = null;
export let reviewWatcher: ReviewWatcher | null = null;
let checkInterval: number | null = null;
/** P3：2s 首查句柄（卸载时取消，防卸载后仍触发逾期检查） */
let firstCheckTimer: number | null = null;
/** P2：ensureReview 注册的全部退订函数（unload 统一调用，防卸载后监听残留双触发） */
let unsubscribers: (() => void)[] = [];

/**
 * 卡片 AI 内容的生成上下文。
 *
 * 闭包读模块级 dataManager：unloadReview 把它置空后，排队里的任务自然读到
 * null 各自退出，不会拿着已销毁的数据层继续写盘。
 */
function cardPrepareCtx(mode: CardMode): CardPrepareContext {
  return {
    mode,
    loadCard: async (key) => {
      if (!dataManager) return null;
      const items = await dataManager.loadItems();
      return items.find((i) => i.filePath === key && isCardItem(i))?.card ?? null;
    },
    updateCard: (key, patch) => (dataManager ? dataManager.updateCard(key, patch) : Promise.resolve(false)),
    loadQuiz: (key) => getCardQuiz(key),
    saveQuiz: (key, questions) => saveCardQuiz(key, questions),
    makeAI: safeMakeAI,
  };
}

/**
 * 重新生成一张卡的 AI 内容（复习面板右键菜单 / 复习会话里的「重新生成」）。
 *
 * 当前方式是「展开全文」时按抽认卡生成——这档本来不用模型，但用户既然点了
 * 「重新生成」，多半是在为以后切回抽认卡做准备。
 *
 * 返回是否真的换了内容；生成失败返回 false（不清旧内容，卡片照常能复习）。
 */
export async function regenerateCardContent(key: string): Promise<boolean> {
  if (!dataManager) return false;
  const items = await dataManager.loadItems();
  const card = items.find((i) => i.filePath === key && isCardItem(i))?.card;
  if (!card) return false;
  /* 方式跟着卡走（2026-11-15）：卡上存了就用卡上的，老卡才回落到全局旧值。 */
  const mode = modeOfCard(card);
  try {
    return await ensureCardContent(card, cardPrepareCtx(mode === 'plain' ? 'flashcard' : mode), true);
  } catch {
    return false;
  }
}

/** 重新生成的第一步产物：草稿 + 这张卡按哪种方式生成 */
export interface CardRegenerateDraft {
  card: ReviewCard;
  mode: CardMode;
  draft: CardContentDraft;
}

/**
 * 只生成「重新生成」的草稿，**不写盘**（2026-11-19）。
 *
 * 右键「重新生成 AI 内容」现在要先把新题面摆给用户看、确认后才替换；写盘动作
 * 交给 `applyCardRegenerateDraft`。生成失败返回 null，卡上的旧内容一个字节不动。
 */
export async function generateCardRegenerateDraft(key: string, modeOverride?: CardMode): Promise<CardRegenerateDraft | null> {
  if (!dataManager) return null;
  const items = await dataManager.loadItems();
  const card = items.find((i) => i.filePath === key && isCardItem(i))?.card;
  if (!card) return null;
  const mode = modeOverride ?? modeOfCard(card);
  const prepareMode: CardMode = mode === 'plain' || mode === 'context' ? 'flashcard' : mode;
  try {
    const draft = await generateCardContent(card, cardPrepareCtx(prepareMode));
    return draft ? { card, mode, draft } : null;
  } catch {
    return null;
  }
}

/** 用户确认之后才真正替换（写盘） */
export async function applyCardRegenerateDraft(entry: CardRegenerateDraft): Promise<boolean> {
  if (!dataManager) return false;
  const mode: CardMode = entry.mode === 'plain' || entry.mode === 'context' ? 'flashcard' : entry.mode;
  try {
    const ctx = cardPrepareCtx(mode);
    /* 重新生成时用户可能换了方式，卡上的方式要跟着换，否则下次复习仍按老方式考 */
    if (mode !== modeOfCard(entry.card)) await ctx.updateCard(entry.card.key, { mode });
    return await applyCardContent(entry.card, ctx, entry.draft);
  } catch {
    return false;
  }
}

/**
 * 原生事件注册即记账（把 offref 语义包装成退订函数：真实 Obsidian 与测试 mock 均按 ref 注销）。
 *
 * Obsidian 1.13 的 Events.on 回调签名是 `(...data: unknown[]) => unknown`，直接传带具体
 * 参数的回调类型不合；这里用 never[] 参数接收任意回调，注册处再对齐成库声明的签名。
 */
function listen(source: Events, event: string, cb: (...args: never[]) => unknown): void {
  const ref: EventRef = source.on(event, cb);
  if (!ref) return;
  unsubscribers.push(() => source.offref?.(ref));
}

/** 总线订阅即记账（onDomainEvent 返回幂等退订函数，直接入账） */
function listenBus<E>(channel: string, cb: (evt: E) => void): void {
  unsubscribers.push(onDomainEvent(channel, cb));
}

/** 总线载荷 → watcher 方法签名所需的伪 TFile（仅路径派生字段，满足签名即可）。
 *  watcher 只读这些字段，用别名表达「路径派生文件」语义；此处是按纯数据构造，
 *  不存在对真实 TAbstractFile 做断言的问题。 */
type PathOnlyFile = TFile & { oldPath?: string };

function pseudoMdFile(path: string): PathOnlyFile {
  const base = path.split('/').pop() || '';
  return { path, basename: stripMdExt(base), extension: 'md' } as PathOnlyFile;
}

/**
 * 外部（bz-reader）把卡片加进计划之后的收尾：行为流记账 + 面板即时补卡。
 *
 * 与 reviewRemoveCurrent 的 removed 事件同一套（issue 261 的小橘行为流）。
 * 面板刷新失败不影响「已经加进去了」这个事实，所以只吞掉、不往回抛——
 * 阅读器那边拿到异常只会弹一句看不懂的红字。
 */
function notePlanAdded(path: string): void {
  const title = stripMdExt(String(path ?? '').split('/').pop() || '');
  emitDomainEvent('review', { kind: 'added', title });
  if (uiManager) void uiManager.refreshPanel().catch(() => undefined);
}

/** 幂等初始化（对齐源码 entry：UI 构建 + 事件监听 + 2s 后首查 + 60s 周期） */
export function ensureReview(app: App): void {
  if (initialized) return;
  initialized = true;
  dataManager = new ReviewDataManager(app);
  // A11：注入共享单例（消除 reviewApp 自持/入口面板双实例并存；reviewApp.ensure 保留缺省兜底防独立调用时序）
  reviewApp.dataManager = dataManager;
  /* 对外门面（bz-reader 的「划线 → 复习卡」，ADR-0294 同范式）：注册一次，卸载置空。
     闭包读模块级 dataManager / uiManager，而不是捕获此刻的实例——unloadReview 会把
     门面和这两个字段一起清掉，不存在「门面还活着、数据层已经没了」的窗口。 */
  setReviewPlanApi({
    isReady: () => !!dataManager,
    hasNote: async (path) => (dataManager ? planHasNote(dataManager, path) : false),
    addNote: async (path) => {
      if (!dataManager) return { added: false, reason: 'notFound' };
      const res = await planAddNote(dataManager, app, path);
      if (res.added) notePlanAdded(path);
      return res;
    },
    addNotes: async (paths) => {
      if (!dataManager) return { added: 0, exists: 0, notFound: 0 };
      const res = await planAddNotes(dataManager, app, paths);
      /* 与 addCards 同口径：「超一次」提醒由 Review 自己弹，reader 不认这个增量字段。 */
      if (res.overLimitMessage) {
        void import('../core/notice').then(({ notice }) => notice(res.overLimitMessage!, 'warning'));
      }
      if (res.added) notePlanAdded(paths[0] ?? '');
      return res;
    },
    removeNote: async (path) => (dataManager ? planRemoveNote(dataManager, path) : false),
    /* 划线卡：内容进排期表，不落文件。加完刷新面板，队列里立刻能看到。
       AI 内容按当前复习方式在后台补（加入那一刻生成一次，之后固定）——
       不在这里 await，阅读器该立刻拿到「已加入」。 */
    addCards: async (cards) => {
      if (!dataManager) return { added: 0, exists: 0, notFound: 0 };
      const res = await planAddCards(dataManager, cards);
      /* 「超一次」提醒由 Review 自己弹：reader 侧不认 overLimitMessage 这个增量字段，
         不弹就等于用户什么都没看到。只在这一句上弹，加卡结果仍由 reader 通知，不重复。 */
      if (res.overLimitMessage) {
        void import('../core/notice').then(({ notice }) => notice(res.overLimitMessage!, 'warning'));
      }
      if (res.added) {
        notePlanAdded(cards[0]?.key ?? '');
        /* 做题：阅读器出好的题先落进题库。必须在排队之前写完——
           ensureCardContent 靠 loadQuiz 判断「已有题就跳过」，写晚了就会
           二次生成，把用户在阅读器里删改过的题顶掉。 */
        const quizzes = quizOf(cards, res.addedKeys ?? []);
        for (const [key, list] of Object.entries(quizzes)) {
          try {
            await saveCardQuiz(key, list);
          } catch {
            /* 题库写失败不该让「已加入」翻车：卡片还在，复习时能退回普通提示 */
          }
        }
        /* 只给没自带题面/题目的卡排队补内容。qa 那些由 plan-ops 的
           addedKeys 已排除，这里再挡一层 questions，双保险。 */
        const needPrepare = withoutPrepared(res.addedKeys ?? [], cards);
        if (needPrepare.length) void queueCardPreparation(needPrepare, cardPrepareCtx(cardModeOf()));
      }
      return res;
    },
    removeCard: async (key) => (dataManager ? planRemoveCard(dataManager, key) : false),
    /* 只读查询：不触发 notePlanAdded（没加东西），也不刷新面板 */
    statusOf: async (paths) => (dataManager ? planStatusOf(dataManager, paths) : []),
    quota: async () => {
      if (!dataManager) return { used: 0, limit: 0, remaining: 0, full: false };
      return cardQuota(planCounts(await dataManager.loadItems()));
    },
  });
  uiManager = new UIManager(app, dataManager);
  // item 12：R 展示与调度排期同口径——UI 层权重源接拟合权重 currentW()（拟合重算后自动生效）
  uiManager.wSource = () => reviewApp.currentW();
  reviewWatcher = new ReviewWatcher(app, dataManager);
  // ADR-0077：启动加载拟合参数（个人化记忆曲线优先，回退默认）
  void reviewApp.loadFitParams(app).catch(() => {});

  // P3：首查句柄入账，卸载时取消（2s 内禁用插件不再触发逾期检查/周期注册）
  firstCheckTimer = window.setTimeout(() => {
    firstCheckTimer = null;
    void reviewApp.checkOverdueAndNotify();
    checkInterval = window.setInterval(() => {
      void reviewApp.checkOverdueAndNotify();
    }, 60000);
  }, 2000);

  // 事件监听（metadataCache resolved / vault modify / workspace quit 保持原生订阅；
  // created/deleted/renamed 已迁域事件总线，见下方总线接线）
  listen(app.metadataCache, 'resolved', () => {
    void reviewApp.applyReviewStyles(app);
  });
  listen(app.vault, 'modify', (file: TFile) => {
    // F9：vault modify 高频路径改走单文件刷新（复用 60s 轮询快照/按需单读，不再每次保存任意 md 全量读）
    if (file.extension === 'md') void reviewApp.applyReviewStylesForFile(app, file);
  });
  /* created / renamed 直接订原生 vault 事件。
     这两个能力原来是走域事件总线（core/file-sync 发、本域订）的，但拆成独立插件后
     那条总线在本插件里根本没初始化——于是「新建笔记自动加入」和「重命名跟着改路径」
     全哑且静默：实测把计划里的一篇笔记改名，条目 filePath 还是旧路径，立刻变挂起、
     从队列消失、还被算进「已完成」。
     与下面保留下来的总线订阅并存：两个处理函数都有查重守卫，重复触发是空操作。
     deleted 仍走总线——它带确认弹窗，双触发会弹两次，不能这么兜。 */
  listen(app.vault, 'create', (file: TFile) => {
    void reviewWatcher?.onVaultCreate(file);
  });
  listen(app.vault, 'rename', (file: TFile, oldPath: string) => {
    reviewWatcher?.onVaultRename(file, oldPath);
  });
  /* delete 也直接订原生事件。onVaultDelete 里「同步移除复习记录？」的确认弹窗、
     移除、撤销全都写好了，但同一条总线没初始化，于是删掉计划内的笔记连弹窗都
     不出现、条目静默变挂起。它自带 300ms 防抖队列，即使总线将来恢复发射也只弹一次。 */
  listen(app.vault, 'delete', (file: TFile) => {
    if (file.extension !== 'md') return;
    reviewWatcher?.onVaultDelete(file);
  });
  // ticket 098：监听文件夹自动加入（created）+ 删除/改名/移动确认（deleted/renamed）——
  // 订域事件总线通用兜底通道（obsidian-adapter 恒发、仅 md，载荷见 src/core/obsidian-adapter.ts），
  // 目录过滤逻辑留在 ReviewWatcher 内部
  listenBus<{ path: string }>('vault:md-created', (evt) => {
    void reviewWatcher?.onVaultCreate(pseudoMdFile(evt.path));
  });
  listenBus<{ path: string }>('vault:md-deleted', (evt) => {
    reviewWatcher?.onVaultDelete(pseudoMdFile(evt.path));
  });
  listenBus<{ oldPath: string; newPath: string }>('vault:md-renamed', (evt) => {
    const file = pseudoMdFile(evt.newPath);
    file.oldPath = evt.oldPath;
    reviewWatcher?.onVaultRename(file, evt.oldPath);
  });
  listen(app.workspace, 'quit', () => {
    if (checkInterval) {
      window.clearInterval(checkInterval);
      checkInterval = null;
    }
  });
}

/**
 * 打开复习面板（review-open-panel）
 *
 * 两种形态（reviewPanelMode，默认 native）：
 *  - native：开一个 Obsidian 标签页，面板撑满内容区（panel-view.ts）；
 *  - popup：原来那层挂在 body 上的浮层。
 * 切换模式后再打开时，另一个形态的壳会被收掉，不会出现「标签页空着 + 浮层盖着」两套。
 */
export async function openReviewPanel(app: App): Promise<void> {
  ensureReview(app);
  /* Reader 开了「书架内显示复习」时，命令直接借道 Reader 的复习页签（2026-11-20）：
     那里嵌着同一份面板，没必要再开一张带左侧栏的原生页。必须在 releaseEmbedded
     之前判断——借道时那份嵌入正挂在 Reader 里，收掉就露空壳了。 */
  const embedRoute = embeddedReviewRoute(app);
  if (embedRoute) {
    /* 只借道、不碰已存在的原生独立页：detach 它会触发 ReviewPanelView.onClose，
      那套清理会把正要挂进 reader 的嵌入面板一起收掉，留下一张空标签（踩过）。
      独立页留着无妨——openStudy 会把 reader 书架 reveal 到前台，用户看到的就是
      内嵌页；旧标签还在后台，但不在眼前。 */
    embedRoute.openReviewTab();
    return;
  }
  /* 书架「复习」页签和命令共用同一份面板 DOM：命令进来先把嵌入收掉、让书架回书库，
     否则新开的原生页只会露出空壳，用户看到的还是书架里那一屏。 */
  uiManager?.releaseEmbedded();
  if (panelModeOf(tryGetSettings()) === 'popup') {
    const leaves = app.workspace.getLeavesOfType(REVIEW_VIEW_TYPE);
    if (leaves.length) {
      // 先把节点迁回 body，再关空壳标签页：反序会让 onClose 把刚要显示的面板藏起来
      uiManager?.detachToBody();
      for (const leaf of leaves) void leaf.detach();
    }
    reviewApp.hideOverdueNotice();
    await uiManager?.showMain();
    return;
  }
  await openPanelView(app);
}

/** 原生页模式：已有标签页就亮出来，没有就新开一个（工作区恢复时 onOpen 会自己接管） */
async function openPanelView(app: App): Promise<void> {
  const found = app.workspace.getLeavesOfType(REVIEW_VIEW_TYPE);
  if (found.length) {
    await app.workspace.revealLeaf(found[0]);
    /* 亮出已有标签页不会走 onOpen，通知得在这里也收一次：常驻逾期通知正压在
       面板右上角那三颗按钮上（点击会落在通知上）。 */
    reviewApp.hideOverdueNotice();
    return;
  }
  const leaf = app.workspace.getLeaf('tab');
  if (!leaf) {
    // 拿不到叶子（极端情况）也不能什么都不发生——退回浮层，至少能用
    uiManager?.detachToBody();
    void uiManager?.showMain();
    return;
  }
  await leaf.setViewState({ type: REVIEW_VIEW_TYPE, active: true });
}

/** 复习分析报告（review-report）：独立命令，直接打开统计弹窗（ticket 174） */
export async function openReviewReport(app: App): Promise<void> {
  ensureReview(app);
  const { showStatsModal } = await import('./stats-ui');
  await showStatsModal(app, dataManager!);
}

/** 按书档案（review-book-report）：高级档入口，未解锁弹能力位文案，不偷开页面。 */
export async function openReviewBooks(app: App): Promise<void> {
  ensureReview(app);
  if (!canUseCapability('bookReport')) {
    notice(capabilityBlock('bookReport').message, 'warning');
    return;
  }
  await uiManager!.openBooks();
}

/** 卡片管理器（review-card-manager）：高级档入口，未解锁弹能力位文案。 */
export async function openReviewCardManager(app: App): Promise<void> {
  ensureReview(app);
  if (!canUseCapability('cardManager')) {
    notice(capabilityBlock('cardManager').message, 'warning');
    return;
  }
  await uiManager!.openManager();
}

/** 记忆分析特刊（bz-review-analysis）：全屏逐幕分析层（analysis/）——
 *  空库/无动画宿主/装配失败在层内回落经典统计弹层（press 降级口径） */
export async function openReviewAnalysis(app: App): Promise<void> {
  ensureReview(app);
  /* 简化分析（批 5）：低配手机 / 远程桌面直接给文字报告，不跑 16 幕动效。
     走同一条命令、同一个入口，用户不用记两个功能名。 */
  const { getSettings } = await import('../core/settings-provider');
  if ((getSettings()).reviewAnalysisPlain) {
    await openReviewReport(app);
    return;
  }
  const mod = await import('./analysis/index');
  await mod.openReviewAnalysis(app);
}

/** 做题练习独立面板（bz-review-quiz-open，issue 362）：quiz-core 引擎 + 做题会话契约的
 *  直接消费壳——不进复习流程、不写排期（域内 feature 文件静态引入，unloadReview 统一收口）。 */
export function openQuizPractice(app: App): void {
  void openQuizPanel(app);
}

/** 加入复习（review-add-current） */
export async function reviewAddCurrent(app: App): Promise<void> {
  ensureReview(app);
  const file = app.workspace.getActiveFile();
  if (!file) {
    notice('请先打开一个笔记');
    return;
  }
  try {
    await reviewApp.addCurrentToReview(file);
    await uiManager!.refreshPanel();
    await reviewApp.applyReviewStyles(app);
  } catch (e: unknown) {
    // C9：动作失败提示走 notifyActionError 单源（白拿 onRetry 挂「重试」出口，效率整改 8）
    notifyActionError(e, '加入复习', { onRetry: () => void reviewAddCurrent(app) });
  }
}

/**
 * 定下这张卡用哪种方式制卡（2026-11-15）。
 *
 * 设置里选了具体方式就直接用它、不再打扰；默认「手动」时才弹选择框，
 * 框里勾了「以后别问」就把选择写回设置——用户不用再跑一趟设置页。
 */
async function resolveCardMethod(): Promise<CardMode | null> {
  const preset = defaultCardMethod();
  if (preset) return preset;
  const picked = await pickCardMethod();
  if (!picked) return null;
  if (picked.remember) {
    const { getSettings, saveSettings } = await import('../core/settings-provider');
    (getSettings()).reviewCardDefaultMethod = picked.mode;
    await saveSettings();
  }
  return picked.mode;
}

/**
 * 把**选中的内容**放进复习（review-add-selection，2026-11-15）。
 *
 * 以前只能整篇笔记加入，或者靠 `::` 语法手写卡片文件；用户想复习某一段话，
 * 得先造一篇笔记。现在选中任意文字就能直接做成一张卡，方式当场选。
 */
export async function reviewAddSelection(app: App, editorFromMenu?: unknown): Promise<void> {
  ensureReview(app);
  const file = app.workspace.getActiveFile();
  if (!file) {
    notice('请先打开一个笔记');
    return;
  }
  const editor =
    editorFromMenu ??
    app.workspace.activeEditor?.editor ??
    (app as unknown as { editor?: { getSelection(): string } }).editor;
  const text = String((editor as { getSelection?: () => string } | undefined)?.getSelection?.() ?? '').trim();
  if (!text) {
    notice('先选中要加入复习的内容');
    return;
  }
  /* 记下路径 + 字符范围：复习时据此跳回这篇笔记并把那段重新选中 */
  const range = selectionRange(editor);
  const sourceNote = range ? { path: file.path, ...range } : undefined;
  const method = await resolveCardMethod();
  if (!method) return;

  try {
    /* 钥匙必须是「不可能是真实路径」的字符串——排期表拿它当 filePath 用，
       真实路径会让它在列表里被当成一篇笔记去打开。选段有出处时用稳定钥匙，
       同一篇同一段重复加入不排两次；没出处（老编辑器）退回时间戳口径。 */
    const key = sourceNote ? noteCardKey(sourceNote) : `sel:${file.path}:${Date.now()}`;
    const card: ReviewCard = {
      key,
      bookTitle: file.basename,
      text,
      mode: method,
      ...(sourceNote ? { sourceNote } : {}),
    };
    const res = await dataManager!.addCards([card]);
    if (!res.added) {
      notice(res.rejected ? '复习条目合计已到基础版上限：升级高级版后可继续加' : '这段内容已经在复习里了');
      return;
    }
    /* 内容在后台补：模型慢的时候不该把「已加入」卡住（同划线卡口径） */
    if (method !== 'plain' && method !== 'context') {
      void queueCardPreparation([key], cardPrepareCtx(method));
    }
    notice(`已加入复习（${text.slice(0, 12)}${text.length > 12 ? '…' : ''}）`);
    await uiManager?.refreshPanel();
  } catch (e) {
    notifyActionError(e, '把选中内容加入复习', { onRetry: () => void reviewAddSelection(app) });
  }
}

/** 移出复习（review-remove-current）：先二次确认（2026-11-19 用户口径，命令面板里
 *  误触也会直接删条目），确认后照旧走 notifyUndo 撤销链 + restoreItem 原样插回；
 *  写盘/刷新链包 try/catch + notifySaveError（对齐抽屉同动作口径，写失败不再零反馈） */
export async function reviewRemoveCurrent(app: App): Promise<void> {
  ensureReview(app);
  const file = app.workspace.getActiveFile();
  if (!file) {
    notice('请先打开一个笔记');
    return;
  }
  const items = await dataManager!.loadItems();
  const target = items.find((i) => i.filePath === file.path);
  if (!target) {
    notice('该笔记不在复习中');
    return;
  }
  if (!(await confirmRemovePlan({ name: file.basename }))) return;
  try {
    await dataManager!.removeItem(file.path);
    // 行为流（issue 261）：移出复习入小橘行为流（review:removed）
    emitDomainEvent('review', { kind: 'removed', title: file.basename });
    notifyUndo(`已移出「${file.basename}」`, () => {
      void (async () => {
        try {
          await dataManager!.restoreItem(target);
          await uiManager!.refreshPanel();
        } catch (e) {
          notifySaveError(e, '恢复复习条目');
        }
      })();
    });
    await uiManager!.refreshPanel();
    await reviewApp.applyReviewStyles(app);
  } catch (e) {
    notifySaveError(e, '移出复习条目');
  }
}

/** 跳转逾期复习（bz-review-overdue；R12 动宾式更名前为「复习（跳转逾期）」） */
export async function reviewJumpOverdue(app: App): Promise<void> {
  ensureReview(app);
  await reviewApp.autoJumpOverdue();
}

/** 开始复习（进入复习流程）：跳过逾期 → 出题/复习循环（review-start） */
export async function reviewStart(app: App): Promise<void> {
  ensureReview(app);
  await reviewApp.autoJumpOverdue();
}

/** 选择复习难度（bz-review-rate；R12 动宾式更名前为「复习（选择难度）」） */
export async function reviewMarkDialog(app: App): Promise<void> {
  ensureReview(app);
  const file = app.workspace.getActiveFile();
  if (!file) {
    notice('请先打开一个笔记');
    return;
  }
  const items = await dataManager!.loadItems();
  const item = items.find((i) => i.filePath === file.path);
  if (!item) {
    notice('该笔记不在复习中');
    return;
  }
  if (item.completed) {
    notice('该笔记已完成全部复习');
    return;
  }
  uiManager?.showDifficultyDialog(item, (diff) => {
    void (async () => {
      await reviewApp.markReview(file.path, diff as Rating);
      await reviewApp.applyReviewStyles(app);
    })();
  });
}

/** 快捷标记（review-mark-again/hard/good/easy） */
export async function reviewMarkRating(app: App, rating: Rating): Promise<void> {
  ensureReview(app);
  const file = app.workspace.getActiveFile();
  if (!file) {
    notice('请先打开一个笔记');
    return;
  }
  const items = await dataManager!.loadItems();
  const item = items.find((i) => i.filePath === file.path);
  if (!item) {
    notice('该笔记不在复习中');
    return;
  }
  if (item.completed) {
    notice('该笔记已完成全部复习');
    return;
  }
  await reviewApp.markReview(file.path, rating);
  await reviewApp.applyReviewStyles(app);
}

/** 卸载清理 */
export function unloadReview(): void {
  initialized = false;
  /* 先摘对外门面：外部插件在本域卸载后再调，拿到的必须是 null 而不是
     一个还攥着旧 app 的闭包 */
  setReviewPlanApi(null);
  if (firstCheckTimer) {
    window.clearTimeout(firstCheckTimer);
    firstCheckTimer = null;
  }
  if (checkInterval) {
    window.clearInterval(checkInterval);
    checkInterval = null;
  }
  // P3：终止 reviewLoop 1s 轮询 + 释放单例 dataManager（插件禁用后不得继续读盘/持旧 app 引用）
  reviewApp.stopReviewLoops();
  reviewApp.dataManager = null;
  // A3/U3：浮层与会话态清场——统计/历史弹窗（closeStatsModal 内部连带 closeTimeline）、
  // 在途 flow-dialog（难度弹窗已迁 flow-dialog 形态，main onunload 亦调，幂等）、
  // 文件树染色回退、进度通知收起、diff 记忆清空（禁用→再启用后存量逾期重新提醒）
  closeStatsModal();
  cancelActiveFlowDialog();
  reviewApp.revertReviewStyles();
  if (reviewApp._reviewNotice?.el?.isConnected) reviewApp._reviewNotice.hide();
  reviewApp._reviewNotice = null;
  /* 逾期常驻通知也要收：它是 duration:0 的常驻提示，句柄不自清理时，禁用再启用会
     在屏幕上叠出第二条一模一样的「有 N 条待复习逾期」。 */
  if (reviewApp._overdueNotice?.el?.isConnected) reviewApp._overdueNotice.hide();
  reviewApp._overdueNotice = null;
  reviewApp._notifiedOverdue.clear();
  // 做题练习独立面板（issue 362）：会话在途契约强制收口 + 面板 DOM/ESC 层摘除
  unloadQuizPanel();
  // 记忆分析特刊层（analysis/）：引擎/监听/ESC 句柄随域卸载收口（幂等）
  unloadReviewAnalysis();
  // F6：quiz-core 单例 initialized/ai 复位——禁用→再启用后 ensureQuiz 重建 AI/设置引用（否则旧配置常驻）
  resetQuiz();
  // P2：全部退订函数统一调用（原生 offref + 总线退订），防卸载后旧监听残留（再 ensure 后事件双触发）
  for (const off of unsubscribers) {
    try {
      off();
    } catch {
      /* 单个注销失败不阻断其余清理 */
    }
  }
  unsubscribers = [];
  uiManager?.destroy();
  uiManager = null;
  dataManager = null;
  reviewWatcher?.destroy();
  reviewWatcher = null;
}
