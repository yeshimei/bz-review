/**
 * 复习核心应用（ticket 16 修正版：对齐源码 App，含 quizReviewLoop/reviewLoop）
 */
import { TFile, type App } from 'obsidian';
import { notice, notify, notifyUndo } from '../core/notice';
import type { NoticeHandle } from '../core/notice';
import { getApp } from '../core/app';
import { getSettings, saveSettings } from '../core/settings-provider';
import {
  clampIntervalDays,
  formatInterval,
  scheduleNext,
  parseLearningSteps,
  localDateKey,
  applyReviewFuzz,
  learningStepFuzzMinutes,
  fuzzFactor,
  MIN_INTERVAL_DAYS,
  currentR as fsrsCurrentR,
} from './fsrs';
import type { Rating } from './fsrs';
import type { ReviewItem, ReviewHistoryEntry } from './data';
import type { QuizMasterUI } from './quiz-core';
import type { QuizQuestion } from './quiz-core/manager';
import { ReviewDataManager, isCardItem } from './data';
import { loadFittedParams, saveFittedParams, FIT_PARAMS_VERSION, getReviewFilePath, type FittedParams } from './data';
import { fitFromItems, mergeFittedW } from './fit';
import {
  DEFAULT_R_THRESHOLD,
  applyRoundLimits,
  isDueToday,
  isEarlyDue,
  isOnVacation,
  roundQueue,
  shouldRemindNow,
} from './queue';
import { resolveWeights } from './weights';
import { computeStats, dateKey } from './stats';
import { emitDomainEvent } from '../core/domain-bus';
import { markOwned } from '../core/scope';
import { diskPathStat } from '../core/storage';
import { REVIEW_VIEW_TYPE } from './panel-mode';
import { stripRuntime } from './store-format';
import { t } from '../i18n';

/** item 5：普通复习离篇宽限期（ms）——持续离篇超过此时长才算中断；测试可注入 */
export let REVIEW_AWAY_GRACE_MS = 120000;
export function __setReviewAwayGraceMsForTests(ms: number): void {
  REVIEW_AWAY_GRACE_MS = ms;
}

/** 呈报#38（R3）：普通复习翻篇轮询间隔（ms）——拍板 B：从 1s 降频到 2.5s（2-3 秒档），
 *  配合「命中才读盘」把大库空耗降下来；120 次 × 2.5s = 300s，超时绝对时长与旧 300×1s 持平 */
export const REVIEW_POLL_INTERVAL_MS = 2500;

/** A2：AI 就绪权威判据——getAIProvider 试准（同 quiz-panel aiReadyOrGuide 口径，缺配置即抛人话错误）。
 *  ensureQuiz 无条件 createAI 不校验配置，quiz.ai 恒 truthy 使「!quiz.ai」降级分支死路；
 *  做题链路各入口以此为准分流普通复习（非破坏式：不改写 quiz-core 单例的 ai 字段）。 */
async function aiReady(): Promise<boolean> {
  try {
    const { getAIProvider } = await import('../core/ai');
    await getAIProvider();
    return true;
  } catch {
    return false;
  }
}

/**
 * 没配 AI 时「做题家」降级成普通复习的提示，整场只弹一次。
 *
 * 原来每次点「开始本轮」都弹一条警告——全新用户第一眼看到的就是「未初始化」，
 * 而他其实什么都没做错，插件本来就该在没配模型时安静地走普通复习。
 */
let quizAiWarned = false;
function warnQuizAiOnce(): void {
  if (quizAiWarned) return;
  quizAiWarned = true;
  notify(t('app.noAi'), {
    type: 'warning',
    dedupeKey: 'review-quiz-ai',
  });
}

/** F8：队列内时间门禁拒绝的特定错误（updateItem 的 fn 基于磁盘现值判定后抛出）——
 *  外层 catch 转人话 notice，防与真实写盘错误混淆 */
export class ReviewGateRejected extends Error {
  constructor(public readonly waitMins: number) {
    super(t('app.notDueYet', { n: waitMins }));
    this.name = 'ReviewGateRejected';
  }
}

export const reviewApp = {
  checkInterval: null as number | null,
  dataManager: null as ReviewDataManager | null,
  /** 测试注入：对齐源码 window.__quiz 语义 */
  _quizOverride: null as QuizMasterUI | null,
  /** 连续复习单框通知（同键合并，动态更新消息） */
  _reviewNotice: null as NoticeHandle | null,
  /** 已通知逾期的笔记路径（ticket 100：diff 记忆集合，避免重复刷屏） */
  _notifiedOverdue: new Set<string>(),
  /** 逾期常驻通知句柄：同键合并时 notify 返回空操作，留存真句柄供逾期清零时主动收起 */
  _overdueNotice: null as NoticeHandle | null,
  /**
   * 被 bz-reader 嵌进书架时的宿主容器（null = 没嵌入）。
   *
   * 有值且宿主可见时，面板同样算「正摆在眼前」：否则轮询会照弹常驻逾期通知，
   * 而那条通知 z 更高，正好压住宿主头栏右侧那四颗图标（与原生页当初被压
   * 「设置」是同一个毛病）。cleanup 时由门面清回 null。
   */
  embeddedHost: null as HTMLElement | null,
  /** ticket 48：已染色/挂徽章的文件路径（移出计划后据此回退；仅提交计划路径 + 曾染色路径，不再全库扫描） */
  _styledPaths: new Set<string>(),
  /** ADR-0077：最近一次复习的累计计数（每 N 次触发拟合重算） */
  _reviewCountSinceFit: 0,
  /** ADR-0077：当前生效的拟合权重（null=用默认 DEFAULT_W） */
  _fittedW: null as number[] | null,
  /** issue 361：最近载入的拟合元数据（null=无拟合文件/未加载；统计弹窗展示拟合档位用） */
  _fitMeta: null as FittedParams | null,
  /** ADR-0077：拟合运行防重入 */
  _fitRunning: false,
  /** P3：reviewLoop 活动轮询句柄（卸载统一清理；插件禁用后不得继续读盘翻篇弹通知） */
  _reviewLoops: new Set<number>(),
  /** item 4：普通复习悬浮迷你评级条句柄（reviewLoop 存续期间挂屏幕底部） */
  _reviewBar: null as { close: () => void } | null,
  /** item 5：本轮队列断点（中断/超时可恢复继续） */
  _pendingRound: null as { items: ReviewItem[]; index: number } | null,
  /** 用户主动暂停本轮（与「中断」区分：这是自己按的，不该弹警告） */
  _roundPaused: false,
  /** 评级撤销栈（最近 20 次；批 2）——每条记下评级前那一条的完整状态 */
  _undoStack: [] as Array<{ filePath: string; at: number; item: Record<string, unknown> }>,
  /** F9：最近一次全量读盘的条目快照（60s 轮询/染色全量刷时更新）——vault modify 高频路径复用，
   *  不再每次保存任意 md 都全量读 review.json */
  _lastItems: null as ReviewItem[] | null,

  /** P3：终止全部 reviewLoop 轮询（unloadReview 调用；幂等） */
  stopReviewLoops(): void {
    for (const t of this._reviewLoops) window.clearInterval(t);
    this._reviewLoops.clear();
    this.hideReviewBar();
    this._pendingRound = null;
  },

  /** item 4：收起悬浮评级条（幂等） */
  hideReviewBar(): void {
    this._reviewBar?.close();
    this._reviewBar = null;
  },

  async getQuiz(): Promise<QuizMasterUI> {
    if (this._quizOverride) return this._quizOverride;
    return (await import('./quiz-core')).quizUI;
  },

  /** 做题家就绪兜底：已初始化但缺 AI → 幂等 ensureQuiz 补建（ensureQuiz 就地写 quizUI.ai，同一单例引用生效） */
  async quizWithAI(): Promise<QuizMasterUI> {
    const quiz = await this.getQuiz();
    if (quiz && !quiz.ai) {
      try {
        const { ensureQuiz } = await import('./quiz-core');
        ensureQuiz(getApp());
      } catch {
        /* ignore */
      }
    }
    return quiz;
  },

  ensure(app: App): void {
    if (!this.dataManager) this.dataManager = new ReviewDataManager(app);
  },

  /** ADR-0077：加载拟合参数到 _fittedW（无则 null 回退默认）；ensureReview 启动时调用。
   *  issue 361：同时留存 _fitMeta（契约版本/样本数/档位），统计弹窗标注拟合档位用 */
  async loadFitParams(app: App): Promise<void> {
    try {
      const fit = await loadFittedParams(app);
      this._fitMeta = fit;
      this._fittedW = fit ? mergeFittedW(fit.w) : null;
    } catch {
      this._fitMeta = null;
      this._fittedW = null;
    }
  },

  /** issue 361：当前拟合档位元数据（无拟合 → null；stats-ui 人话标注「按你的记录定制/简化版」） */
  fitMeta(): FittedParams | null {
    return this._fitMeta;
  },

  /**
   * ADR-0077：每 N 次复习自动重拟合（全自动定期重算）。
   * markReview 每次评级后调用（count+1）；达阈值且开关开 → 异步后台跑，完成后轻提示；
   * 样本不足/失败静默回退默认；防重入。
   */
  async maybeRunFit(app: App): Promise<void> {
    const s = getSettings();
    if (s.reviewEnableFit === false) return;
    const n = Number(s.reviewFitEveryN) || 10;
    this._reviewCountSinceFit++;
    if (this._reviewCountSinceFit < n || this._fitRunning) return;
    this._fitRunning = true;
    this._reviewCountSinceFit = 0;
    try {
      const dm = this.dataManager!;
      const items = await dm.loadItems();
      // fitFSRSParams 按迭代分片让出主线程（审查修复），await 不再长冻结；本函数仍 fire-and-forget
      const result = await fitFromItems(items);
      if (result) {
        // issue 361：契约版本落盘（1=基础八参 / 2=全 19 参数）；
        // full 以拟合结果档位为准（旧口径 w.length>=19 恒真，分档失真——回归修正）
        const fitAt = new Date().toISOString();
        const version = result.fit.full ? FIT_PARAMS_VERSION.FULL : FIT_PARAMS_VERSION.BASIC;
        const meta: FittedParams = {
          w: result.fit.w,
          fitAt,
          fitCount: result.count,
          full: result.fit.full,
          version,
        };
        await saveFittedParams(app, meta);
        this._fitMeta = meta;
        this._fittedW = mergeFittedW(result.fit.w);
        notice(t('app.fitDone', { n: result.count }), 'success');
      }
      // 样本不足 → 静默保留默认（不提示）
    } catch (e) {
      console.warn(t('app.fitFailed'), e);
    } finally {
      this._fitRunning = false;
    }
  },

  /** ADR-0077：获取当前生效权重（拟合参数优先，回退默认） */
  /**
   * 当前调度权重：手填 > 拟合 > 默认（批 3）。
   *
   * 手填放最前是因为那是用户明确写下的意图；拟合是后台根据历史算的，
   * 让它盖掉手填，用户会认为设置没生效。
   */
  currentW(): number[] {
    return resolveWeights((getSettings()).reviewFsrsWeights, this._fittedW);
  },

  /** ADR-0077：某条目当前记忆保留度 R（FSRS 相位且已复习过才可算；否则 null）——A7 单源 fsrs.currentR */
  currentR(item: ReviewItem): number | null {
    return fsrsCurrentR(item, this.currentW());
  },

  /** ADR-0077：逾期队列排序 + 每日上限截断。
   *  R 升序（遗忘风险最高优先，仅可算 R 的条目）→ nextReviewDate 升序。
   *  ticket 174：移除置顶（用户拍板去掉置顶功能）。 */
  sortOverdue(items: ReviewItem[], dailyLimit = 0): ReviewItem[] {
    const sorted = [...items].sort((a, b) => {
      const rA = this.currentR(a);
      const rB = this.currentR(b);
      if (rA !== null && rB !== null && rA !== rB) return rA - rB;
      return new Date(a.nextReviewDate as string).getTime() - new Date(b.nextReviewDate as string).getTime();
    });
    return dailyLimit > 0 ? sorted.slice(0, dailyLimit) : sorted;
  },

  async markReview(filePath: string, selectedDifficulty: Rating, opts?: { autoPending?: boolean }): Promise<void> {
    const app = getApp();
    this.ensure(app);
    const dm = this.dataManager!;
    const items = await dm.loadItems();
    const item = items.find((i) => i.filePath === filePath);
    if (!item) {
      notice(t('app.itemGone'));
      return;
    }
    if (item.completed) {
      notice(t('app.allDone'));
      return;
    }

    const now = new Date();
    const rating = selectedDifficulty;
    // FSRS-7 全量调度：三元组 (S_long, S_short, D) + 目标留存率 → 纯函数 scheduleNext。
    // 留存率取设置 reviewRThreshold（默认 0.9，官方推荐值；越高间隔越短、复习越勤）。
    const s = getSettings();
    const desiredRetention = Number(s.reviewRThreshold) || DEFAULT_R_THRESHOLD;
    const stepsMins = parseLearningSteps(s.reviewLearningSteps);
    // 两端都按本地日历算：ISO 串是 UTC，东八区凌晨 0–8 点 UTC 日期还是昨天，
    // 旧写法（toISOString().slice(0,10) vs 本地 todayKey）会把刚建档的新卡误判跨天。
    const todayKey = localDateKey(now);
    const stepStartKey = item.reviewStart ? localDateKey(new Date(item.reviewStart)) : '';
    const decision = scheduleNext(
      {
        stage: item.stage,
        phase: item.phase,
        stability: item.stability,
        stabilityShort: item.stabilityShort,
        difficulty: item.difficulty,
        lastReviewed: item.lastReviewed,
        reviewStart: item.reviewStart,
      },
      rating,
      now,
      this.currentW(),
      desiredRetention,
      {
        stepsMins,
        graduatingDays: Number(s.reviewGraduatingInterval) || 1,
        relearnStepsMins: parseLearningSteps(s.reviewRelearnSteps),
        // 步骤只在当天有效；跨天强制毕业，避免变成长阶梯
        sameDay: stepStartKey === todayKey,
      }
    );
    // 学习/重学步骤的间隔是分钟级 Anki 短步，不缩放、不套最长上限；FSRS 间隔才走缩放/上限。
    const inSteps = decision.phase === 'ladder' || decision.phase === 'relearn';
    const scaleRaw = Number(s.reviewIntervalScale);
    const scale = inSteps ? 1 : (scaleRaw > 0 ? scaleRaw : 1);
    const capDays = inSteps ? 0 : (Number(s.reviewMaxIntervalDays) || 0);
    const scaledDays = clampIntervalDays(decision.intervalDays, scale, capDays);
    // Anki fuzz：长间隔 ±比例抖动、学习步骤 +0~25%（≤5 分钟）。
    // seed 用「卡片 id + 本次复习序号」，同一张卡同一轮结果稳定，跨设备一致。
    const fuzz = fuzzFactor(`${item.id}:${(item.totalReviews || 0) + 1}`);
    let fuzzedDays = scaledDays;
    if (s.reviewFuzz !== false) {
      fuzzedDays = inSteps
        ? learningStepFuzzMinutes(scaledDays * 1440, fuzz) / 1440
        : applyReviewFuzz(scaledDays, fuzz, MIN_INTERVAL_DAYS, capDays > 0 ? capDays : Infinity);
    }
    const nextDate = new Date(now.getTime() + fuzzedDays * 86400000);

    /* 撤销快照在写盘之前取：评级是就地改对象，写完之后拿不到「改之前」。
       只留持久字段（stripRuntime 剥掉 file/isCompleted 等派生态）。 */
    const before = JSON.parse(JSON.stringify(stripRuntime(item))) as Record<string, unknown>;

    // F8：时间门禁移入 RMW 队列内基于磁盘现值复判——并发双评级时后写者在队内读到已刷新的
    // 排期即拒（抛 ReviewGateRejected 由外层转人话 notice），不再双写历史。
    // G1 放行口径不变：R 阈值提前（isEarlyDue）/ 今日到期（isDueToday）均放行，仅未来日历日才拒。
    try {
      await dm.updateItem(filePath, (it) => {
        const nextReview = it.nextReviewDate ? new Date(it.nextReviewDate) : new Date(0);
        if (now < nextReview) {
          const rThreshold = Number((getSettings()).reviewRThreshold) || DEFAULT_R_THRESHOLD;
          if (!isEarlyDue(it, rThreshold, this.currentW()) && !isDueToday(it)) {
            throw new ReviewGateRejected(Math.ceil((nextReview.getTime() - now.getTime()) / 60000));
          }
        }
        it.stage = decision.stage;
        it.phase = decision.phase;
        if (decision.stability !== null) it.stability = decision.stability;
        if (decision.stabilityShort !== null) it.stabilityShort = decision.stabilityShort;
        if (decision.difficulty !== null) it.difficulty = decision.difficulty;
        it.lastReviewed = now.toISOString();
        it.lastDifficulty = rating;
        it.totalReviews = (it.totalReviews || 0) + 1;
        if (!it.reviewHistory) it.reviewHistory = [];
        const entry: ReviewHistoryEntry = { timestamp: now.toISOString(), stage: decision.historyStage, rating };
        // FSRS-7：S_long/S_short/D 记入历史（拟合回放依赖）
        if (decision.historyStability !== null && decision.historyDifficulty !== null) {
          entry.stability = decision.historyStability;
          entry.difficulty = decision.historyDifficulty;
        }
        if (decision.historyStabilityShort !== null) entry.stabilityShort = decision.historyStabilityShort;
        if (decision.R !== null) entry.R = Math.round(decision.R * 100);
        it.reviewHistory.push(entry);
        it.nextReviewDate = nextDate.toISOString();

        // ticket 098：做题会话自动评级未通过/通过联动待重做标记；其余路径 good/easy 清（ADR-0044）
        if (opts?.autoPending) it.pendingRedo = rating === 'again' || rating === 'hard';
        else if (rating === 'good' || rating === 'easy') it.pendingRedo = false;
      });
    } catch (e) {
      if (e instanceof ReviewGateRejected) {
        notice(e.message);
        return;
      }
      throw e;
    }

    /* 按错的档位是复习里最常犯的错（手快按成「简单」，间隔直接翻几倍）。
       撤销入口就放在评级成功的那条 toast 上——看到间隔不对，当场能退。 */
    this._undoStack.push({ filePath, at: Date.now(), item: before });
    if (this._undoStack.length > 20) this._undoStack.shift();
    const undo = (): void => void this.undoLastRating();

    // 学习步骤期报分钟级短间隔；毕业报"完成学习"；FSRS 报动态间隔。
    if (decision.graduated) {
      notifyUndo(t('app.learned', { interval: formatInterval(fuzzedDays) }), undo, { type: 'success' });
    } else {
      notifyUndo(t('app.nextReview', { interval: formatInterval(fuzzedDays) }), undo, { type: 'success' });
    }
    // ADR-0077：评级也累计拟合计数（含首次评级；样本过滤在 fit.ts 内做）。
    // fire-and-forget：计数在入口同步累加，拟合自防重入；不 await 避免大历史时卡评级路径
    void this.maybeRunFit(getApp());
    // 行为流（issue 261）：评分入小橘行为流（review:rated，域事件总线；未装小橘时订阅端静默）
    emitDomainEvent('review', { kind: 'rated', title: item.name || filePath, rating });
    /* 评级后顺手刷新面板：不然队列还停在评级前的样子——toast 说「30 分钟后」，
       卡片却仍挂在「已逾期」栏里，用户只能关掉面板重开才看得到变化。
       面板没开、或卡片会话正占着内容区时 refreshPanel 自己会提前返回。 */
    try {
      const { uiManager } = await import('./index');
      if (uiManager) void uiManager.refreshPanel().catch(() => undefined);
    } catch {
      /* 面板不在不影响写入 */
    }
  },

  /** 跳转逾期（bz-review-start/overdue 命令入口）：完整复习流程 = startRoundSprint */
  async autoJumpOverdue(): Promise<void> {
    await this.startRoundSprint();
  },

  /** 待重做条目（文件存在、未完成；按进入顺序 = lastReviewed 升序 FIFO） */
  pendingRedoItems(items: ReviewItem[]): ReviewItem[] {
    return items
      .filter((i) => i.pendingRedo && !i.isCompleted && i.file)
      .sort(
        (a, b) =>
          new Date(a.lastReviewed || a.reviewStart).getTime() - new Date(b.lastReviewed || b.reviewStart).getTime()
      );
  },
  /** 重做出题（ADR-0044/Q7-②）：清空旧题 → ensureQuestions 全新生成；失败或空题回退剩余错题。
   *  A1：异常与空题分支统一把存量错题写回题库——旧题只换不丢（旧实现清空后异常/空题不回写，
   *  「答错的题留在题库留给下次」的积累池会静默丢失） */
  async regenerateQuestions(filePath: string): Promise<QuizQuestion[]> {
    const quiz = await this.getQuiz();
    if (!quiz || !quiz.ai) return [];
    const leftover = (await quiz.manager.getQuestionsForNote(getApp(), filePath)) || [];
    await quiz.manager.saveQuestionsForNote(getApp(), filePath, []);
    try {
      await quiz.ensureQuestions([filePath]);
    } catch {
      // A1/新-5：AI 失败不再让旧题停在「已清空」态——存量错题原样写回，会话走「暂无题目，已跳过」
      if (leftover.length) await quiz.manager.saveQuestionsForNote(getApp(), filePath, leftover);
      return [];
    }
    const fresh = (await quiz.manager.getQuestionsForNote(getApp(), filePath)) || [];
    if (!fresh.length && leftover.length) {
      // 空题分支同口径：写回题库（磁盘与会话两侧都保有剩余错题）
      await quiz.manager.saveQuestionsForNote(getApp(), filePath, leftover);
    }
    const picked = fresh.length ? fresh : leftover;
    return picked.map((q, i) => ({ ...q, notePath: filePath, _index: i }));
  },

  /** 批量生成题目（返回 {filePath: questions[]} 映射）：先快照存量题再清库触发重出。
   *  A1：生成成功才覆盖写新题，失败/空篇把存量题原样写回（saveQuestionsForNote 内 mutateQuiz
   *  RMW 合并，参照 quiz-core session「生成后合并」形态）——AI 整体失败/逐篇失败均不再丢存量题 */
  async batchGenerateQuestions(items: ReviewItem[]): Promise<Record<string, QuizQuestion[]>> {
    const quiz = await this.getQuiz();
    if (!quiz || !quiz.ai || !(await aiReady())) {
      console.warn(t('app.quizNotReady'));
      warnQuizAiOnce();
      return {};
    }
    const app = getApp();
    const leftovers = new Map<string, QuizQuestion[]>();
    for (const item of items) {
      const cur = (await quiz.manager.getQuestionsForNote(app, item.filePath)) || [];
      leftovers.set(item.filePath, cur);
      await quiz.manager.saveQuestionsForNote(app, item.filePath, []); // 清库只为触发 ensureQuestions 重出
    }
    try {
      await quiz.ensureQuestions(items.map((i) => i.filePath));
    } catch (e) {
      // A1：整体异常也要回收——已清空的篇目把存量题写回后再上抛（ensureBatch 兜底为 {}）
      for (const item of items) {
        const leftover = leftovers.get(item.filePath) || [];
        if (leftover.length) await quiz.manager.saveQuestionsForNote(app, item.filePath, leftover);
      }
      throw e;
    }
    const out: Record<string, QuizQuestion[]> = {};
    for (const item of items) {
      const qs = await quiz.manager.getQuestionsForNote(app, item.filePath);
      if (qs && qs.length) {
        out[item.filePath] = qs.map((q, i) => ({
          ...q,
          notePath: item.filePath,
          _index: i,
        }));
      } else {
        // A1：该篇生成失败/空 → 存量题写回（RMW 基于磁盘现值合并，失败篇保留现值）
        const leftover = leftovers.get(item.filePath) || [];
        if (leftover.length) await quiz.manager.saveQuestionsForNote(app, item.filePath, leftover);
      }
    }
    return out;
  },

  /** 单条做题冲刺（点队列到期卡片）：该篇直接进入做题会话。
   *  呈报#4（R2）拍板「提示版」：整轮复习（普通轮/做题会话）进行中 → 拦截并给一句提示，
   *  不再无声忽略（forceQuiz 开的原路径会静默开第二个会话与普通轮并行），也不自动收旧轮。 */
  async startSingleSprint(item: ReviewItem): Promise<void> {
    if (this._reviewLoops.size > 0) {
      notice(t('app.roundInProgress'));
      return;
    }
    const { uiManager } = await import('./index');
    if (uiManager?.inSprint) {
      notice(t('app.roundInProgress'));
      return;
    }
    const app = getApp();
    this.ensure(app);
    // 行为流（issue 261）：开始复习入小橘行为流（review:started）
    emitDomainEvent('review', { kind: 'started' });
    const quiz = await this.quizWithAI();
    if (!quiz || !quiz.ai || !(await aiReady())) {
      // A2：做题家不可用（getAIProvider 试准——ensureQuiz 无条件 createAI 不校验配置）：
      // 降级为普通复习（打开笔记等自评），不再进做题链路空转一圈
      warnQuizAiOnce();
      await this.reviewLoop([item], 0);
      return;
    }
    // 单条：取现成题（无题则重生成）；无题 → 会话内跳过提示
    await this.runSprintSession([item], 'single');
  },

  /** 开始本轮（队列视图「开始本轮」）：待重做优先 → 逾期队列 → 做题/普通分流。
   *  呈报#4（R2）对称面：做题会话进行中 → 拦截并提示（否则 reviewLoop 与冲刺静默并行，
   *  悬浮评级条与题面同屏互扰）；单条做题防抖（sprintStarting in-flight）不受影响。 */
  /**
   * 开始本轮。
   *
   * `force` = 不限到期日，把在计划里的条目全部过一遍（批 3）。考试前一晚
   * 「明天就考了，别管什么间隔」是真需求，而按 R / 到期日筛出来的队列
   * 永远只给一部分，用户只能一条条手动点开。
   */
  async startRoundSprint(opts: { force?: boolean } = {}): Promise<void> {
    const { uiManager } = await import('./index');
    if (uiManager?.inSprint) {
      notice(t('app.sprintInProgress'));
      return;
    }
    /* 暂停着还点「开始本轮」= 接着上一轮走。重开一轮会把断点白扔掉，用户看到的是
       「我刚停的那几篇怎么又要从头来」；这也是暂停后唯一稳定的恢复入口。 */
    if (this._roundPaused && this._pendingRound) {
      this.resumeRound();
      return;
    }
    const app = getApp();
    this.ensure(app);
    await this.syncVacation();
    if (isOnVacation((getSettings()).reviewVacationUntil)) {
      notice(t('app.vacation'));
      return;
    }
    // 行为流（issue 261）：开始本轮复习入小橘行为流（review:started）
    emitDomainEvent('review', { kind: 'started' });
    let items = await this.dataManager!.loadItems();
    /* 2026-11-20 用户拍板：只有有逾期才能开始本轮。界面按钮也加了同样的门控，
       这里是第二道闸——命令入口 / 自动跳转同样得先有逾期。force（「不限到期，
       全部过一遍」）是刻意例外，不受这条约束。 */
    if (!opts.force) {
      const hasOverdue = items.some((i) => i.isOverdue && !i.isCompleted && !i.completed && !i.isMissing);
      if (!hasOverdue) {
        notice(t('app.noOverdue'));
        return;
      }
    }
    const pend = this.pendingRedoItems(items);
    if (pend.length && getSettings().forceQuizForReview) {
      const quiz = await this.quizWithAI();
      if (quiz && quiz.ai && (await aiReady())) {
        await this.runSprintSession(pend, 'redo');
        // 重做会话结束后重新读盘：pendingRedo 已清的 = 通过集（会话内 updateItem 落盘）
        const fresh = await this.dataManager!.loadItems();
        const passedSet = new Set(
          fresh.filter((i) => pend.some((p) => p.filePath === i.filePath) && !i.pendingRedo).map((i) => i.filePath)
        );
        if (passedSet.size) items = fresh.filter((i) => !passedSet.has(i.filePath));
        else items = fresh; // 无通过也刷新（会话内可能写过排期）
      } else {
        warnQuizAiOnce();
      }
    }

    // item 6/9：开始本轮与三区列同口径（roundQueue 纯函数）——
    // 逾期 ∪ R 阈值提前 ∪ 今日到期（今日到期时刻未到 = 允许提前开始今天全部）
    const rThreshold = Number((getSettings()).reviewRThreshold) || DEFAULT_R_THRESHOLD;
    const bury = (getSettings() as { reviewBurySiblings?: boolean }).reviewBurySiblings !== false;
    const round = opts.force
      ? items.filter((i) => !i.isCompleted && !i.completed && !i.isMissing)
      : roundQueue(items, rThreshold, this.currentW(), bury);
    if (!round.length) {
      notice(opts.force ? t('app.planEmpty') : t('app.noOverdueShort'), 'success');
      return;
    }
    if (opts.force) {
      notice(t('app.forceAll', { n: round.length }), 'info');
    }
    // item 9：纳入了「今日到期但时刻未到」的篇目 → 明确反馈
    const earlyToday = round.filter((i) => !i.isOverdue && !isEarlyDue(i, rThreshold, this.currentW()));
    if (earlyToday.length) {
      notice(t('app.earlyToday', { n: earlyToday.length }), 'info');
    }
    const s = getSettings();
    const dailyLimit = Number(s.reviewDailyLimit) || 0;
    /* 先按 R 排序，再按「新卡 / 到期」两个额度分别截断（批 3）——
       合成一个上限时，新卡多的一天会被新卡吃光，复习效率反而低。 */
    let limited = this.sortOverdue(round, 0);
    limited = applyRoundLimits(limited, {
      newLimit: Number(s.reviewNewLimit) || 0,
      reviewLimit: Number(s.reviewReviewLimit) || 0,
      order: s.reviewOrder === 'new-first' ? 'new-first' : 'due-first',
    });
    if (dailyLimit > 0) limited = limited.slice(0, dailyLimit);
    if (limited.length < round.length) {
      notice(t('app.limitedRound', { n: limited.length, left: round.length - limited.length }), 'info');
    }

    /* 划线卡和笔记不是一个界面：卡片在自己的会话里复习，笔记要么跳转要么做题。
       两类都有时先做卡片，做完自动接上笔记那轮——不用再点一次「开始本轮」。 */
    const cardItems = limited.filter((i) => isCardItem(i));
    const noteItems = limited.filter((i) => !isCardItem(i));
    if (cardItems.length) {
      if (!uiManager) return;
      await uiManager.startCardRound(
        cardItems,
        noteItems.length
          ? () => {
              void (async () => {
                /* 没配 AI 就别开冲刺：卷子一道都出不来，每篇都被「没题」跳过，
                   最后结算屏报「0 复习篇数 / 0 通过 / 0 未通过」——用户刚做完一
                   整轮卡片，看到 0 会以为白做了。走普通复习，开篇即翻。 */
                if (getSettings().forceQuizForReview && (await aiReady())) {
                  await this.runSprintSession(noteItems, 'round');
                } else {
                  await this.reviewLoop(noteItems, 0);
                }
              })();
            }
          : undefined,
      );
      return;
    }

    /* 只剩笔记：先把面板收起来，再去打开第一篇。
       不收的话笔记确实被打开了，但整个编辑器糊在遮罩后面——用户点「开始本轮」
       看到的还是队列，以为没反应，得自己猜到「点遮罩空白处」才看得到内容。 */
    {
      const { uiManager } = await import('./index');
      uiManager?.hideMain();
    }

    if (!getSettings().forceQuizForReview) {
      await this.reviewLoop(limited, 0);
      return;
    }
    let quiz: QuizMasterUI | null = null;
    try {
      quiz = await this.quizWithAI();
    } catch {
      /* ignore */
    }
    if (!quiz || !quiz.ai || !(await aiReady())) {
      // A2：AI 未配置（getAIProvider 抛）→ 走设计的普通复习降级，不做题链路空转
      warnQuizAiOnce();
      await this.reviewLoop(limited, 0);
      return;
    }
    // 直接进做题界面（题在 session 内懒批量生成：首篇 fetch 时触发整轮后台生成，
    // 界面立即出现 + 中心 loading「正在准备题目」——不在进 session 前同步干等 AI）
    await this.runSprintSession(limited, 'round');
  },

  /**
   * 统一冲刺会话驱动：把队列交给 UI 层 SprintSession 渲染，本层只提供
   * 取题/评级写盘回调。会话结束（done/quit/fail）后刷新列表与染色。
   *  - round/single：通过 → markReview autoPending；未通过 → markReview autoPending + 开笔记
   *  - redo：通过 → 仅清 pendingRedo（ADR-0044 不写 FSRS）；未通过 → 开笔记（保持待重做）
   */
  async runSprintSession(items: ReviewItem[], mode: 'round' | 'single' | 'redo'): Promise<void> {
    const app = getApp();
    const { uiManager } = await import('./index');
    if (!uiManager) return;

    // item 8：结算屏「连续 N 天」——进会话时算好 streak 传入
    let streakDays = 0;
    try {
      streakDays = computeStats(await this.dataManager!.loadItems()).streak;
    } catch {
      /* ignore */
    }

    const quiz = await this.getQuiz();
    // 懒批量：首篇 fetch 触发整轮后台生成；后续篇目直接读已生成结果
    // （进 session 即出界面 + loading，不在进 session 前同步干等 AI）
    let batchStarted = false;
    let batchMap: Record<string, QuizQuestion[]> | null = null;
    const ensureBatch = async (): Promise<void> => {
      if (batchStarted) return;
      batchStarted = true;
      try {
        batchMap = await this.batchGenerateQuestions(items);
      } catch {
        batchMap = {};
      }
    };
    await uiManager.startSprint({
      queue: items,
      mode,
      quiz,
      streakDays,
      fetchQuestions: async (item) => {
        // 现成题直接读（single：现成无则重新生成；redo：重新生成）
        const qs = await quiz?.manager?.getQuestionsForNote(app, item.filePath);
        if (qs && qs.length) {
          return qs.map((q, i) => ({ ...q, notePath: item.filePath, _index: i }));
        }
        if (!quiz?.ai) return null;
        if (mode === 'round') {
          // round：懒批量——首篇现场触发生成（本篇在批内），后台批完前先等本篇
          await ensureBatch();
          const mapped = batchMap?.[item.filePath];
          if (mapped && mapped.length) {
            return mapped;
          }
          return null; // 本篇生成失败/空 → 跳过（runNext 已有空题跳过语义）
        }
        const fresh = await this.regenerateQuestions(item.filePath);
        return fresh.length ? fresh : null;
      },
      onPassed: async (item, rating, entry) => {
        if (mode === 'redo') {
          await this.dataManager!.updateItem(item.filePath, (it) => {
            it.pendingRedo = false;
          });
          return undefined;
        }
        await this.markReview(item.filePath, rating as Rating, { autoPending: true });
        // E3：复用本次刚读的 fresh 透传给染色（applyReviewStyles 支持可选 items，省一次全量读盘）
        const fresh = await this.dataManager!.loadItems();
        await this.applyReviewStyles(app, undefined, fresh);
        // 返回写盘后的真实排期（markReview 内部 updateItem 改的是新 load 的对象，item 快照不更新）。
        // G1：检测是否真正写盘——markReview 被拒（条目并发删除/已完成/时间门禁）时 lastReviewed
        // 不更新，返回 undefined 让会话不展示假间隔（不落回快照旧排期）
        const updated = fresh.find((i) => i.filePath === item.filePath);
        if (!updated || updated.lastReviewed !== item.lastReviewed) return undefined;
        return updated.nextReviewDate || undefined;
      },
      onFailed: async (item, rating, entry) => {
        if (mode !== 'redo') {
          await this.markReview(item.filePath, rating as Rating, { autoPending: true });
          await this.applyReviewStyles(app);
        }
        // 打开原文（复习此笔记语义）
        const file = app.vault.getAbstractFileByPath(item.filePath);
        if (file instanceof TFile) {
          const leaf = app.workspace.getLeaf(false);
          await leaf.openFile(file);
        }
      },
    });
    // 会话结束：回队列 + 染色 + 通知（done 全清）
    await this.refreshPanel();
    await this.applyReviewStyles(app);
  },


  /** 顺序复习循环（源码 L686-709 逐字；item 4 悬浮评级条 + item 5 离篇宽限/断点可恢复）
   *  - 屏幕底部挂迷你评级条（忘了/困难/一般/简单 + 跳过）：点评级写盘 → 轮询检测翻篇；跳过不评级直接下一篇
   *  - 离篇持续 REVIEW_AWAY_GRACE_MS 才判中断（宽限期内回篇继续）；中断/超时保留 _pendingRound，
   *    通知挂「继续本轮」action 断点续跑 */
  async reviewLoop(overdueNotes: ReviewItem[], index: number): Promise<void> {
    // F2：防重入——已有活动循环（连点「继续本轮」/复习中重开命令）→ 拒绝并提示，
    // 防双 interval 并行翻篇竞态（悬浮条互覆、_reviewNotice/_pendingRound 单槽互覆）。
    // 正常翻篇递归前已 clearLoop，不受此守卫影响
    if (this._reviewLoops.size > 0) {
      notice(t('app.roundRunning'));
      return;
    }
    const app = getApp();
    this.ensure(app);
    const dm = this.dataManager!;
    if (index >= overdueNotes.length) {
      this._pendingRound = null;
      this.hideReviewBar();
      if (this._reviewNotice) {
        this._reviewNotice.setType('success');
        this._reviewNotice.setMessage(t('app.overdueDone'));
        this._reviewNotice = null;
      } else {
        notice(t('app.overdueDone'), 'success');
      }
      return;
    }
    const item = overdueNotes[index];
    const file = app.vault.getAbstractFileByPath(item.filePath);
    if (!file) {
      await dm.removeItem(item.filePath);
      await this.reviewLoop(overdueNotes, index + 1);
      return;
    }
    this._pendingRound = { items: overdueNotes, index }; // item 5：断点（完成/清零时置空）
    const leaf = app.workspace.getLeaf(false);
    if (file instanceof TFile) await leaf.openFile(file);
    // item 4：挂悬浮迷你评级条（ui 不可用时静默降级为命令评级）
    this.hideReviewBar();
    let barMounted = false;
    try {
      const { mountFloatingRatingBar } = await import('./ui');
      this._reviewBar = mountFloatingRatingBar({
        name: item.name,
        index: index + 1,
        total: overdueNotes.length,
        remaining: Math.max(0, overdueNotes.length - index - 1),
        onRate: (rating) => {
          // 评级写盘 → 下方轮询检测 lastReviewed 更新自动翻篇（本条收起由按钮点击即收）
          void this.markReview(item.filePath, rating);
        },
        onSkip: () => {
          // 跳过：不评级不写盘，直接进下一篇
          void advance();
        },
        onPause: () => this.pauseRound(),
      });
      barMounted = true;
    } catch {
      /* ignore */
    }
    /* 浮条自己就在显示「篇名 3/7」，再挂一条同内容的进度通知，手机上正好压在
       评级按钮上（通知 z 更高，点「忘了/困难」会落到通知上）。挂上浮条就不弹它；
       浮条挂不上时才退回通知这条老路。 */
    if (barMounted) {
      if (this._reviewNotice?.el?.isConnected) this._reviewNotice.hide();
      this._reviewNotice = null;
    } else {
      // 连续复习：常驻单框动态更新（同键存活时原地合并，不刷屏）
      const reviewMsg = t('app.reviewingOf', { index: index + 1, total: overdueNotes.length, name: item.name });
      // U9：复用前验活（对齐 _overdueNotice 先例）——progress 通知到期消失后旧句柄 setMessage
      // 是 no-op，不验活会让后续每篇的进度提示静默失效
      if (this._reviewNotice && this._reviewNotice.el?.isConnected) {
        this._reviewNotice.setMessage(reviewMsg);
      } else {
        this._reviewNotice = notify(reviewMsg, { type: 'progress', dedupeKey: 'review-loop' });
      }
    }

    let checkCount = 0;
    const maxChecks = 120; // 120 × 2.5s = 300s：超时绝对时长与旧 300×1s 持平（拍板「行为语义不变」）
    let advanced = false;
    let awaySince: number | null = null; // item 5：持续离篇起点（null=在篇上）
    // 呈报#38（R3）「命中才读盘」：轻量探测 review.json 的 stat.mtime（getAbstractFileByPath
    // 走 vault 内存缓存，无 IO），与上次全量读的基线对比——有变化才全量读。大库空耗从
    // 「每 tick 一次全量 JSON 解析」降为「每 2.5s 一次内存 stat 对比」。
    // 基线 null（首轮/探测不可用）→ 保守回退全量读，翻篇检测不劣化。
    let lastMtime: number | null = null;
    // 索引优先（内存零 IO）；点前缀数据目录索引恒空 → 落 adapter.stat 兜底，
    // 否则 mtime 永远是 null，轮询退化成每 2.5s 全量读盘。
    const storageMtime = async (): Promise<number | null> => {
      try {
        const f = app.vault.getAbstractFileByPath(getReviewFilePath()) as { stat?: { mtime?: number } } | null;
        if (f && typeof f.stat?.mtime === 'number') return f.stat.mtime;
        const st = await diskPathStat(app, getReviewFilePath());
        return st && typeof st.mtime === 'number' ? st.mtime : null;
      } catch {
        return null;
      }
    };
    const advance = async (): Promise<void> => {
      if (advanced) return;
      advanced = true;
      this.hideReviewBar();
      clearLoop();
      /* 暂停：不往下翻，但把断点留在「下一篇」上——继续时正好接着走，
         不会把刚评完的这篇再复习一遍。 */
      if (this._roundPaused) {
        this._pendingRound = { items: overdueNotes, index: index + 1 };
        const left = Math.max(0, overdueNotes.length - index - 1);
        if (this._reviewNotice) {
          this._reviewNotice.setMessage(t('app.pausedLeft', { n: left }));
          this._reviewNotice.setType('info');
          this._reviewNotice = null;
        }
        notify(t('app.pausedRound', { n: left }), {
          type: 'info',
          action: { label: t('app.resume'), onClick: () => void reviewApp.resumeRound() },
        });
        return;
      }
      await this.reviewLoop(overdueNotes, index + 1);
    };
    const interval = window.setInterval(() => {
      void (async () => {
      checkCount++;
      const activeFile = app.workspace.getActiveFile();
      if (!activeFile || activeFile.path !== item.filePath) {
        // item 5：离篇宽限——持续离篇超过阈值才算中断；宽限期内回篇自动续候
        const nowMs = Date.now();
        if (awaySince === null) awaySince = nowMs;
        if (nowMs - awaySince < REVIEW_AWAY_GRACE_MS) return;
        advanced = true;
        this.hideReviewBar();
        clearLoop();
        // P1-2：本轮连续复习中断（保留 _pendingRound 供「继续本轮」断点续跑）
        if (this._reviewNotice) {
          this._reviewNotice.setMessage(t('app.leftNote'));
          this._reviewNotice.setType('warning');
          this._reviewNotice = null;
        }
        notify(t('app.leftNote'), {
          type: 'warning',
          dedupeKey: 'review-loop-interrupted',
          action: { label: t('app.resumeRound'), onClick: () => void reviewApp.resumeRound() },
        });
        return;
      }
      awaySince = null; // 回到篇上：宽限计时复位
      // 超时判定在读盘前（R3 降频后 mtime 未变的 tick 会提前 return，判定不可再挂在读盘之后）
      if (checkCount >= maxChecks) {
        advanced = true;
        this.hideReviewBar();
        clearLoop();
        if (this._reviewNotice) {
          this._reviewNotice.setMessage(t('app.timeout'));
          this._reviewNotice.setType('warning');
          this._reviewNotice = null;
        } else {
          notice(t('app.timeout'), 'warning');
        }
        notify(t('app.timeoutResume'), {
          type: 'info',
          dedupeKey: 'review-loop-timeout',
          action: { label: t('app.resumeRound'), onClick: () => void reviewApp.resumeRound() },
        });
        return;
      }
      const mtime = await storageMtime();
      if (lastMtime !== null && mtime !== null && mtime === lastMtime) return; // 未变：本 tick 不读盘
      const updatedItems = await dm.loadItems();
      lastMtime = await storageMtime();
      const updated = updatedItems.find((i) => i.filePath === item.filePath);
      if (updated && updated.lastReviewed) {
        const last = new Date(updated.lastReviewed);
        if (Date.now() - last.getTime() < 30000) {
          await advance();
          return;
        }
      }
      })();
    }, REVIEW_POLL_INTERVAL_MS);
    // P3：句柄入账（stopReviewLoops 统一清理），防插件禁用后轮询残留
    this._reviewLoops.add(interval);
    const clearLoop = (): void => {
      window.clearInterval(interval);
      this._reviewLoops.delete(interval);
    };
  },

  /** item 5：从断点恢复本轮（中断/超时后「继续本轮」入口；无断点给明确反馈） */
  resumeRound(): void {
    const r = this._pendingRound;
    if (!r) {
      notice(t('app.noRound'));
      return;
    }
    this._roundPaused = false;
    void this.reviewLoop(r.items, r.index);
  },

  /**
   * 暂停本轮（批 2）。
   *
   * 与「离开笔记被判中断」区分：这是用户自己按的，不给警告、不丢断点。
   *
   * 暂停必须**当场掐掉轮询**（真机事故）：以前只隐藏浮条、interval 还活着，
   * 于是「继续」撞上 reviewLoop 的防重入守卫（「本轮复习已在进行」）根本没反应；
   * 那条带「继续」的提示十几秒后自己消失，这一轮就彻底卡死在暂停态——
   * 浮条没了、评级按钮没了、命令也进不去，只能重载应用。
   */
  pauseRound(): void {
    this._roundPaused = true;
    this.hideReviewBar();
    /* 只掐轮询、保留断点：stopReviewLoops 是卸载用的，它连 _pendingRound 一起清，
       用它暂停等于把「继续」的落点也删了（真机复现：暂停后提示「本轮已经结束了」）。 */
    for (const t of this._reviewLoops) window.clearInterval(t);
    this._reviewLoops.clear();
    /* 断点留在「当前这条」不动：暂停前没评的那篇，继续时应该回到它，
       而不是悄悄跳过（以前 index+1 会把手上这篇直接丢出本轮，只剩一句
       「还剩 0 条」，用户以为复习被吞了）。 */
    // 进度通知跟着暂停收掉：留着「复习中」转圈，等于告诉用户还在跑
    if (this._reviewNotice?.el?.isConnected) this._reviewNotice.hide();
    this._reviewNotice = null;
    const r = this._pendingRound;
    /* 没有断点 = 这一轮其实已经走完了（浮条是最后一条留下的残影）：别报「还剩 0 条」
       再挂个点了没反应的「继续」，直接说结束。 */
    if (!r) {
      this._roundPaused = false;
      notice(t('app.roundEnded'), 'info');
      return;
    }
    const left = Math.max(0, r.items.length - r.index);
    // 提示条只是顺手给个入口；真正的恢复入口是面板「开始本轮」与「开始复习」命令
    notify(t('app.pausedUnseen', { n: left }), {
      type: 'info',
      action: { label: t('app.resume'), onClick: () => void this.resumeRound() },
    });
  },

  /**
   * 每日定时提醒（批 5）。
   *
   * 以前的提醒只有「有逾期就弹」，一天里可能弹好几次、也可能用户正好没开库。
   * 现在按设置的时间点每天提醒一次：过了点才提醒，同一天只提醒一次；
   * 没有到期条目就不打扰。
   */
  syncDailyReminder(items: ReviewItem[]): void {
    const s = getSettings();
    const now = new Date();
    if (!shouldRemindNow(now, s.reviewRemindAt, s.reviewRemindLast)) return;
    const round = roundQueue(items, Number(s.reviewRThreshold) || DEFAULT_R_THRESHOLD, this.currentW());
    if (!round.length) return;
    s.reviewRemindLast = dateKey(now);
    void saveSettings();
    notify(t('app.todayDue', { n: round.length }), {
      type: 'info',
      duration: 0,
      dedupeKey: 'review-daily-remind',
      action: { label: t('app.goReview'), onClick: () => void this.startRoundSprint() },
    });
  },

  /**
   * 休假收尾（批 3）：结束那天把整份计划的「下次复习日期」整体顺延。
   *
   * 为什么要顺延：不休假期间条目照样走到期，回来就是一屏逾期几百条，很多人
   * 因此直接放弃这个插件。顺延等于「这段时间不算数」，回来节奏还是走之前的样子。
   */
  async syncVacation(): Promise<void> {
    const s = getSettings();
    const until = s.reviewVacationUntil ? new Date(s.reviewVacationUntil).getTime() : NaN;
    if (!Number.isFinite(until) || Date.now() < until) return;
    this.ensure(getApp());
    const from = s.reviewVacationFrom ? new Date(s.reviewVacationFrom).getTime() : NaN;
    const shift = Number.isFinite(from) ? Math.max(0, until - from) : 0;
    if (shift > 0) await this.dataManager!.shiftAllNextReview(shift);
    const live = getSettings();
    live.reviewVacationUntil = '';
    live.reviewVacationFrom = '';
    void saveSettings();
    notice(t('app.vacationEnded', { n: Math.round(shift / 86400000) }), 'success');
    if (shift > 0) {
      try {
        const { uiManager } = await import('./index');
        if (uiManager) void uiManager.refreshPanel().catch(() => undefined);
      } catch {
        /* 面板没开不影响 */
      }
    }
  },

  /** 撤销上一次评级：把整条排期恢复到评级前那一刻（含 S/D、历史、下次日期） */
  async undoLastRating(): Promise<boolean> {
    const last = this._undoStack.pop();
    if (!last) {
      notice(t('app.nothingToUndo'));
      return false;
    }
    this.ensure(getApp());
    const ok = await this.dataManager!.restoreSnapshot(last.filePath, last.item);
    if (!ok) {
      notice(t('app.itemGoneUndo'), 'warning');
      return false;
    }
    notice(t('app.undone'), 'success');
    try {
      const { uiManager } = await import('./index');
      if (uiManager) void uiManager.refreshPanel().catch(() => undefined);
    } catch {
      /* 面板没开不影响撤销本身 */
    }
    return true;
  },

  /** 加入当前笔记到复习：2026-11-21 起统一走 add-flow.ts 的 openAddToReviewFlow，
   *   这个方法不再保留第二套写库路径（删掉是为了让人没法再绕过去）。 */

  /** 文件树染色 + 阶段徽标（源码 L719-772 逐字；ticket 100 加「文件树标记」开关；
   *   ticket 48 收敛：不再全库 getMarkdownFiles + 逐路径 querySelector——
   *   处理范围 = 复习条目路径 + 曾染色路径（移出计划后回退），树节点一次 querySelectorAll 建 Map 查找；
   *   可选 items 参数：checkOverdueAndNotify 传本轮已加载结果，避免每轮二次读盘。 */
  async applyReviewStyles(app: App, changedFile?: TFile, items?: ReviewItem[]): Promise<void> {
    if ((getSettings()).reviewTreeBadge === false) return; // ticket 100：关=清爽文件树（不染色不挂徽章）
    this.ensure(app);
    const allItems = items || (await this.dataManager!.loadItems());
    this._lastItems = allItems; // F9：全量结果入快照，供 vault modify 单文件路径复用
    const itemByPath = new Map<string, ReviewItem>();
    for (const item of allItems) {
      if (item.filePath) itemByPath.set(item.filePath, item);
    }

    // 处理路径集：单文件事件只处理该文件；全量轮 = 复习条目 + 曾染色路径（回退清洗用）
    const paths = new Set<string>();
    if (changedFile) {
      paths.add(changedFile.path);
    } else {
      for (const p of itemByPath.keys()) paths.add(p);
      for (const p of this._styledPaths) paths.add(p);
    }

    // 树节点一次收集（data-path → 元素，首个匹配语义与原 querySelector 一致）
    const els = new Map<string, HTMLElement>();
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('div[data-path]'))) {
      const p = el.getAttribute('data-path');
      if (p && !els.has(p)) els.set(p, el);
    }

    // R 染色与排期同口径：读拟合权重 currentW()（ADR-0077；默认回退 DEFAULT_W）
    for (const path of paths) {
      const el = els.get(path);
      if (!el) {
        // 树节点不存在（文件删除/目录收起）：从曾染色集合剔除，防集合无限增长
        this._styledPaths.delete(path);
        continue;
      }
      const target = el.querySelector<HTMLElement>('div.tree-item-inner');
      if (!target) continue;
      const badge = target.querySelector('.bzrv-stage-badge');
      if (badge) badge.remove();

      const item = itemByPath.get(path);
      if (!item) {
        // 仅回退「本插件曾染色」的路径（从未染色的非条目节点不触碰，缩范围语义）
        if (this._styledPaths.has(path)) {
          target.style.removeProperty('color');
          this._styledPaths.delete(path);
        }
        continue;
      }
      const currentStage = item.stage || 0;
      const now = new Date();
      const nextReview = item.nextReviewDate ? new Date(item.nextReviewDate) : null;
      let color = 'currentColor';
      let status = '';
      if (item.completed) {
        color = '#52c41a';
        status = 'complete';
      } else if (nextReview && now > nextReview) {
        color = '#ff4757';
        status = 'overdue';
      } else if (item.stability && item.lastReviewed) {
        const r = fsrsCurrentR(item, this.currentW(), now);
        if (r === null) {
          color = '#1890ff';
        } else if (r >= 0.9) color = '#52c41a';
        else if (r >= 0.7) color = '#faad14';
        else color = '#ff9f43';
      } else if (currentStage <= 2) {
        color = '#1890ff';
      } else if (currentStage <= 6) {
        color = '#faad14';
      } else {
        color = '#52c41a';
      }
      target.style.color = color;

      let timeText = '';
      let badgeIcon: 'check' | 'calendar' | null = null;
      if (status === 'complete') badgeIcon = 'check'; // item 14：✅ → lucide check
      else if (nextReview) {
        const diff = nextReview.getTime() - now.getTime();
        if (diff > 0) {
          const d = Math.floor(diff / (1000 * 60 * 60 * 24));
          const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
          const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
          if (d > 0) timeText = `${d}d`;
          else if (h > 0) timeText = `${h}h`;
          else timeText = `${m}m`;
        } else badgeIcon = 'calendar'; // item 14：📅 → lucide calendar
      }
      if (badgeIcon || timeText) {
        const badgeEl = createSpan();
        badgeEl.className = 'bzrv-stage-badge';
        // 寄生在 Obsidian 自己的文件树/标签里，不在插件容器内：自己挂作用域锚点
        markOwned(badgeEl);
        if (badgeIcon) {
          // item 14：徽标用 lucide（uiIcon 工厂；尺寸走域样式 .bzrv-stage-badge svg）
          const { uiIcon } = await import('../core/ui');
          badgeEl.appendChild(uiIcon(badgeIcon));
        } else {
          badgeEl.textContent = timeText;
        }
        // 视觉样式已收进 core/styles.css 的 [data-bzrv].bzrv-stage-badge；这里只传动态色，不再写 cssText
        badgeEl.style.setProperty('--bzrv-stage-badge-c', color);
        target.appendChild(badgeEl);
      }
      this._styledPaths.add(path);
    }
  },

  /** F9：单文件染色刷新（vault modify 高频路径）——优先复用最近快照（60s 轮询/全量刷维护，
   *  时效与原 60s 轮询同档），无快照才全量读盘；只处理该文件路径，
   *  不再每次保存任意 md 都全量读 review.json */
  async applyReviewStylesForFile(app: App, file: TFile): Promise<void> {
    this.ensure(app);
    const items = this._lastItems || (await this.dataManager!.loadItems());
    await this.applyReviewStyles(app, file, items);
  },

  /** A3/U3：卸载回退文件树染色与徽标（按曾染色路径逐个 revert，与 applyReviewStyles 的
   *  缩范围回退同口径；幂等）——插件禁用后彩色节点/徽标不再残留文件树 */
  revertReviewStyles(): void {
    const els = new Map<string, HTMLElement>();
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('div[data-path]'))) {
      const p = el.getAttribute('data-path');
      if (p && !els.has(p)) els.set(p, el);
    }
    for (const path of this._styledPaths) {
      const target = els.get(path)?.querySelector('div.tree-item-inner') as HTMLElement | null;
      if (target) {
        target.style.removeProperty('color');
        target.querySelector('.bzrv-stage-badge')?.remove();
      }
    }
    this._styledPaths.clear();
  },

  /**
   * 到期提醒 + 染色刷新（ticket 100：原只刷染色，重写为 diff + 通知；染色职责保留）
   * 每轮与已通知集合对比：新增逾期 → 弹篇数常驻通知（duration 0，逾期清零主动收起；不列题目）；
   * 移出逾期（评级/完成/挂起）从集合剔除 → 之后再次逾期重新提醒。
   * 启动首查把存量逾期当新产生 → 汇总篇数（Q1 拍板接受）。
   * ticket 48 收敛：与本轮 loadItems 共用结果，不再二次读盘；
   * ticket 58：通知挂「去复习」action → 打开最早逾期笔记；
   * ticket 153：「去复习」升级为走 autoJumpOverdue 完整流程（做题决定难度分流）。
   */
  async checkOverdueAndNotify(): Promise<void> {
    try {
      this.ensure(getApp());
      /* 休假中不提醒（批 3）：连染色与逾期通知一起停，否则「休假」只是不看而已，
         通知照样天天弹，用户会以为没设置成功。 */
      if (isOnVacation((getSettings()).reviewVacationUntil)) return;
      const dm = this.dataManager!;
      const items = await dm.loadItems();
      this._lastItems = items; // F9：轮询结果入快照（染色关闭时 applyReviewStyles 不读盘，快照在此保活）
      this.syncDailyReminder(items);
      /* 染色刷新保留（原 60s 轮询职责：逾期文件实时变红；是否染色由 reviewTreeBadge 决定）。
         窗口在后台时不刷：文件树根本看不见，刷一遍等于白跑一次 DOM 改写（批 7 性能）。
         通知照常，回来第一轮会把颜色补齐。 */
      if (typeof document === 'undefined' || !document.hidden) {
        await this.applyReviewStyles(getApp(), undefined, items);
      }
      if ((getSettings()).enableAutoNotify === false) return; // 通知开关关 → 不弹通知
      /* 面板正摆在眼前时不再挂常驻逾期通知：面板上就有逾期条数和「开始本轮」，
         多一条常驻通知只会压住面板右上角那三颗按钮（通知 z 更高，点击落在通知上，
         「设置」直接点不动——真机实测）。切回笔记后下一轮轮询会自然补上。 */
      if (this.panelOnScreen()) {
        this.hideOverdueNotice();
        return;
      }
      const overdueMap = new Map<string, ReviewItem>(
        items.filter((i) => i.isOverdue && !i.completed && !i.isMissing).map((i) => [i.filePath, i])
      );
      const newly = [...overdueMap.entries()].filter(([p]) => !this._notifiedOverdue.has(p));
      // 清掉已不再逾期的（评级/完成/挂起后）
      for (const p of this._notifiedOverdue) {
        if (!overdueMap.has(p)) this._notifiedOverdue.delete(p);
      }
      if (newly.length) {
        for (const [p] of newly) this._notifiedOverdue.add(p);
        // 通知只报当前逾期篇数，不列具体题目（用户拍板 2026-08-29）；duration 0 = 常驻（通知系统语义）
        // ticket 153：「去复习」不再只打开单篇（旧 ticket 58/修 #1 语义），
        // 而是走 autoJumpOverdue 完整复习流程（按 forceQuizForReview 分流做题/普通复习），
        // 通知名单仍只报 newly（diff 记忆语义保留，见上方过滤）。
        const handle = notify(t('app.overdueNotice', { n: overdueMap.size }), {
          type: 'info',
          duration: 0, // 常驻不自动消失，靠点击「去复习」/本体收起
          dedupeKey: 'review-overdue-notice',
          action: {
            label: t('app.goReview'), // action 文案不带 emoji（通知规范）
            onClick: () => {
              // ticket 153：走统一开始复习流程（autoJumpOverdue 内按 forceQuizForReview 分流：
              // 开启 → 批量出题做题；关闭 → 普通复习跳转笔记），不再裸开最早逾期笔记
              void reviewApp.autoJumpOverdue();
            },
          },
        });
        // 同键合并返回空操作句柄：仅当旧句柄已失联（被消费）时才换存新句柄，保证清零收起有效
        const cur = this._overdueNotice;
        if (!cur || !cur.el.isConnected) this._overdueNotice = handle;
      } else if (!overdueMap.size) {
        // 逾期清零：常驻通知失去时效，主动收起（句柄已被点击消费时 hide 幂等无害）
        this._overdueNotice?.hide();
        this._overdueNotice = null;
      }
    } catch (e) {
      console.error('复习检查出错:', e);
    }
  },

  /** 收起逾期常驻通知（面板打开时用；句柄已被点掉时幂等无害） */
  hideOverdueNotice(): void {
    if (this._overdueNotice?.el?.isConnected) this._overdueNotice.hide();
    this._overdueNotice = null;
    /* 兜底（2026-11-19）：同键合并 / 句柄被消费后引用会失联，只靠句柄收不干净——
       嵌入 bz-reader 时真机上就出现过「通知一直压住头栏四颗图标」。按 action 文案
       认回那条常驻逾期通知直接摘掉；别的通知没有「去复习」按钮，不会误伤。 */
    if (typeof document === 'undefined') return;
    document.querySelectorAll<HTMLElement>('.bzrv-notice').forEach((el) => {
      if (el.querySelector('.bzrv-notice-action')?.textContent === t('app.goReview')) el.remove();
    });
  },

  /** 复习面板是否正摆在眼前（原生页形态 = 当前标签页就是它；嵌入形态 = 宿主可见） */
  panelOnScreen(): boolean {
    try {
      /* 嵌入 bz-reader：宿主还在文档里、且没被 display:none 藏起来（切到别的标签页），
         就算面板在眼前。offsetParent 为 null 时多半是宿主被隐藏了。 */
      const host = this.embeddedHost;
      if (host) return host.isConnected && host.offsetParent !== null;
      /* activeLeaf 是官方 lint 的 no-deprecated 豁免项：minAppVersion 1.7.2 下无等价替代
         （要的正是「当前标签页」这个语义，getActiveViewOfType 只认 ItemView，覆盖不到）。
         这里用局部结构类型读同一字段，行为不变，也不带 deprecated 类型标记。 */
      const ws = getApp()?.workspace as
        | { activeLeaf?: { view?: { getViewType?: () => string } } }
        | undefined;
      return !!ws?.activeLeaf && ws.activeLeaf.view?.getViewType?.() === REVIEW_VIEW_TYPE;
    } catch {
      return false;
    }
  },

  /** 刷新面板（源码 refreshPanel） */
  async refreshPanel(): Promise<void> {
    const { uiManager } = await import('./index');
    if (!uiManager) return;
    const items = await this.dataManager!.loadItems();
    uiManager.renderEntries(items);
  },
};
