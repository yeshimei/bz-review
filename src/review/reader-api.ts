/**
 * 复习计划对外门面（ADR-0294 同范式：叶子模块，只放类型与注册表）。
 *
 * bz-reader 的「划线 → 复习卡」要往计划里加一篇**它自己写出来的笔记**，
 * 这是它第一次反向写 bz 的排期数据（以前只有 knowledge 录入与 readerAi 检索，
 * 都是「交给你内容」或「问你只读算力」）。所以单独开一个门面而不是塞进
 * knowledge：录入的生命周期是知识盒、复习的生命周期是复习域，混在一起
 * 调用方探测「能不能加复习」会拿到一个永远存在的函数，探测就失去意义。
 *
 * 注册方在 `review/index.ts` 的 ensureReview（复习域初始化时挂），
 * unloadReview 置 null。未注册时调用方按「这台 bz 还没有这个能力」降级。
 */

/** 没加进去的原因：已在计划中 / 文件不存在 */
import type { CardMode } from './card-mode';

export type ReviewAddReason = 'exists' | 'notFound';

export interface ReviewAddOutcome {
  /** 真的写进计划了（false 时看 reason） */
  added: boolean;
  reason?: ReviewAddReason;
}

export interface ReviewAddSummary {
  /** 本次新增的条数 */
  added: number;
  /** 已经在计划里（含批内重复）的条数 */
  exists: number;
  /** 文件不存在或路径为空的条数 */
  notFound: number;
  /**
   * 因为免费版额度到顶而没加进去的条数（已激活高级版时恒为 0）。
   *
   * 单独一个字段而不是并进 notFound：调用方要能说「加了 40 条，10 条超出
   * 免费版上限」，而不是让用户以为那 10 条数据有问题。
   */
  rejected?: number;
  /**
   * 本次真正新进来的卡片钥匙（只对 addCards 有意义）。
   *
   * 复习域用它决定「给哪几张生成 AI 内容」——已经在计划里的卡不重复生成，
   * 用户手点的「重新生成」才覆盖。调用方不读这个字段也不影响既有行为。
   */
  addedKeys?: string[];
}

/**
 * 一张卡片在复习计划里的现状（只读）。
 *
 * 阅读器拿它做两件事：划线上标「复习中」，以及把下次复习日期写在提示里。
 * `planned: false` 时其余字段全是空态——调用方不必再判空。
 */
export interface ReviewNoteStatus {
  /** 传进来的原路径（原样回传，好让调用方直接按路径对齐） */
  path: string;
  planned: boolean;
  /** 下次复习日期（ISO）；没进计划 / 还没排期时为 null */
  nextReviewDate: string | null;
  /** 兼容字段：FSRS-7 无阶梯，恒 0（保留供契约兼容） */
  stage: number;
  phase: 'ladder' | 'fsrs';
  /** 已经复习过几次 */
  totalReviews: number;
}

/**
 * 一张划线卡（阅读器交过来的内容）。
 *
 * 阅读器不再生成 Markdown：内容直接进排期表。所以这里要收齐「复习时用户
 * 需要看见的一切」——原文、想法、出处、回原文的链接。少给一样，复习时那
 * 一面就是空的。
 */
export interface ReviewCardInput {
  /** 稳定钥匙（阅读器建议 `reader:<bookId>:<highlightId>`） */
  key: string;
  bookTitle: string;
  chapterTitle?: string;
  /** 划线原文（调用方负责截断超长文本） */
  text: string;
  comment?: string;
  /** 回到原文的链接（obsidian:// 协议串） */
  backlink?: string;
  /**
   * 划线前后各一段原文（可选）。
   *
   * 给了，复习时才能用「上下文」方式——把划线藏起来，凭前后文回忆。
   * 不给也能用，只是这个方式退化成「凭出处回忆」。
   */
  context?: { before?: string; after?: string };
  /**
   * 已经出好的问答对（可选，2026-11-16）。
   *
   * 阅读器那边如果已经让模型把题出好了（比如「从章节正文挑重点」那条路，
   * 模型一次调用既挑句子又出问题），就把 q 和 a 一起交过来，这里直接存下，
   * 不再按当前复习方式重新生成一遍——既省一次调用，也不会因为二次生成
   * 把题面换个说法。
   *
   * 没给就还是老路子：加入之后按 `reviewCardMode` 在后台补内容。
   */
  qa?: { q: string; a: string };
  /**
   * 这张卡按哪种方式复习（可选，2026-11-16 配合「方式跟着卡走」）。
   *
   * 2026-11-15 起复习方式存在卡上（`ReviewCard.mode`），不再是一个全局开关。
   * 阅读器是唯一知道「这张卡里到底有什么」的一方，所以它该说话：
   *   · 已经出好问答对的（`qa` 有值）→ 传 `flashcard`，直接用题面考，
   *     不能让 Review 那边按「做题」再生成一份题库；
   *   · 只交了划线原文 → 可以不传，由 `stampCardModes` 按用户设的默认方式盖章。
   *
   * 不传时行为与以前完全一致（批量加卡统一盖默认方式）。
   */
  mode?: CardMode;
  /**
   * 做题卡已经出好的选择题（可选，2026-11-17）。
   *
   * 阅读器三选一里选了「做题」并出了题，就随卡片一起交过来；这里落进
   * 独立题库。给了题的卡不再排队让 Review 二次生成——用户在阅读器里
   * 删过、补过、重新生成过的题必须原样保留。不给则走原来的生成路径。
   */
  questions?: Array<{ q: string; options: string[]; correct: number[]; explain?: string }>;
}

/** 卡片类额度（阅读器批量列表据此提前标「超出基础版上限」） */
export interface CardQuota {
  used: number;
  limit: number;
  remaining: number;
  full: boolean;
}

export interface ReviewPlanApi {
  /** 门面本身能不能用（复习域已初始化） */
  isReady(): boolean;
  hasNote(path: string): Promise<boolean>;
  addNote(path: string): Promise<ReviewAddOutcome>;
  addNotes(paths: string[]): Promise<ReviewAddSummary>;
  removeNote(path: string): Promise<boolean>;
  /** 批量加划线卡（内容进条目，不落文件） */
  addCards(cards: ReviewCardInput[]): Promise<ReviewAddSummary>;
  /** 移出一张划线卡 */
  removeCard(key: string): Promise<boolean>;
  /** 批量查现状（一趟读盘）；返回顺序与入参一致 */
  statusOf(paths: string[]): Promise<ReviewNoteStatus[]>;
  /** 划线卡额度预知（无限额时 limit/remaining 是 Infinity） */
  quota(): Promise<CardQuota>;
}

let source: ReviewPlanApi | null = null;

/** 注册/撤销（复习域 ensure 时注册、unload 时传 null） */
export function setReviewPlanApi(api: ReviewPlanApi | null): void {
  source = api;
}

/** 取门面；未注册返回 null */
export function getReviewPlanApi(): ReviewPlanApi | null {
  return source;
}
