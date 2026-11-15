/**
 * 复习统计与负载计算（ADR-0077，ticket 174）
 *
 * 统计弹窗数据源：全局指标（总复习次数/streak/评级分布/逾期率/平均 R 趋势）+ 单条时间线。
 * 负载：各条目 nextReviewDate 落在某天的数量（未来 N 天分布 / 日历热力图 / 今日明日预告）。
 *
 * streak 口径（用户拍板宽松）：所有评级都算，同一天多次复习算 1 次（仅去重，防刷指标）。
 */

import type { ReviewItem } from './data';
import { DEFAULT_W, currentR } from './fsrs';
import { localDayKey } from '../core/ui/str';

/** 评级 → 中文/颜色（UI 共用） */
export const RATING_NAMES: Record<string, string> = { again: '忘了', hard: '困难', good: '一般', easy: '简单' };
export const RATING_COLORS: Record<string, string> = { again: '#ff4757', hard: '#ff9f43', good: '#2ed573', easy: '#7bed9f' };

export interface ReviewStats {
  /** 总复习次数（按评级记录去重同日） */
  totalReviews: number;
  /** 连续复习天数 streak（宽松口径：所有评级都算，同日去重） */
  streak: number;
  /** 今日复习次数 */
  todayReviews: number;
  /** 评级分布 { rating: count } */
  ratingDist: Record<string, number>;
  /** 逾期率（逾期条目 / 未完成条目） */
  overdueRate: number;
  /** 平均记忆保留度 R（FSRS 相位条目当前 R 的均值；无可算条目为 null） */
  avgR: number | null;
  /** 复习过的笔记数（去重 filePath） */
  reviewedNotes: number;
  /** 最早复习日期（reviewHistory 最早 timestamp；无则 null） */
  firstReviewAt: string | null;
  /** 最近 7 天每日复习次数（补零，键 YYYY-MM-DD） */
  daily7: Array<{ date: string; count: number }>;
}

/** 把 timestamp 转本地日期键 YYYY-MM-DD（A9/C3 审查收编：实现单源 core/ui/str localDayKey——
 *  零依赖区，纯数据层可安全引入 node 直测；此处转发保 queue/render/stats-ui 既有消费路径） */
export function dateKey(d: Date): string {
  return localDayKey(d);
}

/** 解析 reviewHistory 成 { timestamp, rating, stage, stability, R? } 列表 */
export interface HistoryEntry {
  timestamp: string;
  rating: string;
  stage: number;
  stability?: number;
  difficulty?: number;
  R?: number;
  /** 所属笔记路径（flatten 时注入） */
  filePath?: string;
}

export function historyOf(item: ReviewItem): HistoryEntry[] {
  return ((item.reviewHistory as any[]) || []).map((h) => ({
    timestamp: h.timestamp,
    rating: h.rating,
    stage: h.stage,
    stability: h.stability,
    difficulty: h.difficulty,
    R: h.R,
  }));
}

/** 全部条目的历史拍平（用于全局统计） */
export function flattenHistory(items: ReviewItem[]): HistoryEntry[] {
  return items.flatMap((i) => historyOf(i).map((h) => ({ ...h, filePath: i.filePath })));
}

/**
 * 全局统计。streak 宽松口径：
 * - 所有评级都计入
 * - 同一天多次复习算 1 次（按日期去重）
 * - streak = 从最近一次复习日往前连续的天数（断一天即停）
 * @param opts.w R 口径权重（拟合优先；缺省回退 DEFAULT_W——与调度排期同口径，item 12 拍板）
 */
export function computeStats(items: ReviewItem[], opts?: { w?: number[] }): ReviewStats {
  const history = flattenHistory(items);
  const days = new Set<string>();
  for (const h of history) days.add(dateKey(new Date(h.timestamp)));

  // 总复习次数（去重同日）
  const totalReviews = days.size;

  // streak：从今天往前连续复习的天数（宽松口径：今天没复习但昨天有，从昨天起算）
  const todayKey = dateKey(new Date());
  let streak = 0;
  // 若今天没复习，从昨天开始往前找连续段
  let cursor = new Date();
  if (!days.has(todayKey)) cursor.setDate(cursor.getDate() - 1);
  while (days.has(dateKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  // 今日复习次数（同日去重后今日的条数）
  const todayCount = history.filter((h) => dateKey(new Date(h.timestamp)) === todayKey).length;

  // 评级分布
  const ratingDist: Record<string, number> = { again: 0, hard: 0, good: 0, easy: 0 };
  for (const h of history) {
    if (h.rating in ratingDist) ratingDist[h.rating]++;
  }

  // 逾期率
  const active = items.filter((i) => !i.completed && !i.isCompleted);
  const overdue = active.filter((i) => i.isOverdue);
  const overdueRate = active.length ? overdue.length / active.length : 0;

  // 平均 R（FSRS 相位且有 stability+lastReviewed 的条目；A7 审查修复：当前 R 走 fsrs.currentR
  // 单源——原与 queue.isEarlyDue 等五处同式复写，防口径漂移）
  let rSum = 0;
  let rN = 0;
  for (const i of items) {
    const r = currentR(i, opts?.w || DEFAULT_W);
    if (r !== null) {
      rSum += r;
      rN++;
    }
  }
  const avgR = rN ? rSum / rN : null;

  // 最早复习日期
  let firstReviewAt: string | null = null;
  if (history.length) {
    const ts = history.map((h) => new Date(h.timestamp).getTime());
    firstReviewAt = new Date(Math.min(...ts)).toISOString();
  }

  // 最近 7 天每日复习次数（补零）
  const daily7: Array<{ date: string; count: number }> = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = dateKey(d);
    const count = history.filter((h) => dateKey(new Date(h.timestamp)) === key).length;
    daily7.push({ date: key, count });
  }

  const reviewedNotes = new Set(history.filter((h) => h.filePath).map((h) => h.filePath!)).size;

  return {
    totalReviews,
    streak,
    todayReviews: todayCount,
    ratingDist,
    overdueRate,
    avgR,
    reviewedNotes,
    firstReviewAt,
    daily7,
  };
}

/* ─────────── 复习量对比（2026-11-16） ───────────
 *
 * 「动态抗遗忘到底省了多少」一直是句形容词。这里把它算成两个可以摆在一起的数：
 *
 *   actual = 这套排期实际让你复习了多少条次（同日去重，跟总复习天数同口径）
 *   fixed  = 同样的笔记、同样的时间跨度，按传统固定间隔要复习多少条次
 *
 * 只做算术，不承诺效果：固定间隔不一定达到同样的记忆强度，所以文案只说
 * 「同样这些笔记、同样这些天，老办法要复习 N 次」，不说「你的记忆提升了 X%」。
 *
 * 参与对比的门槛：一条至少复习过两个不同的日子，且跨度 ≥ 1 天。只复习过
 * 一次、或者一天之内连点两下的，算进去只会让比例失真。
 */

/** 传统固定间隔复习法（艾宾浩斯系）：1/2/4/7/15/30/60/120 天 */
export const FIXED_INTERVALS = [1, 2, 4, 7, 15, 30, 60, 120];

/**
 * 按固定间隔表覆盖 spanDays 天需要复习几次。
 *
 * 累计到 ≥ span 就停：跨度 1 天 → 1 次，3 天 → 2 次，7 天 → 3 次，14 天 → 4 次。
 * 表用完之后（239 天以上）按 180 天一次往上加，不封顶。
 */
export function fixedCountFor(spanDays: number): number {
  const span = Math.max(0, Math.round(Number(spanDays) || 0));
  if (span <= 0) return 1;
  let acc = 0;
  let n = 0;
  while (acc < span && n < FIXED_INTERVALS.length) {
    acc += FIXED_INTERVALS[n];
    n += 1;
  }
  if (acc >= span) return Math.max(1, n);
  return FIXED_INTERVALS.length + Math.ceil((span - acc) / 180);
}

/** 复习量对比结果 */
export interface LoadCompare {
  /** 参与对比的条目数（复习过 ≥2 个不同日子） */
  notes: number;
  /** 实际复习条次（同日去重） */
  actual: number;
  /** 固定间隔推算的条次 */
  fixed: number;
  /** fixed − actual（可能为负：复习得比老办法还勤） */
  saved: number;
  /** saved / fixed（0~1；fixed 为 0 时为 0） */
  percent: number;
  /** 跨度最长的那一条撑了多少天 */
  spanDays: number;
}

/** 汇总全部条目的「实际 vs 固定间隔」；没有可比条目返回 null */
export function compareReviewLoad(items: ReviewItem[]): LoadCompare | null {
  let notes = 0;
  let actual = 0;
  let fixed = 0;
  let maxSpan = 0;
  for (const item of items) {
    const hist = item.reviewHistory || [];
    if (hist.length < 2) continue;
    const days = new Set<string>();
    let first = Infinity;
    let last = -Infinity;
    for (const h of hist) {
      const t = new Date(h?.timestamp).getTime();
      if (!Number.isFinite(t)) continue;
      days.add(dateKey(new Date(t)));
      if (t < first) first = t;
      if (t > last) last = t;
    }
    /* 只复习过一次、或者全在同一天点完的，没有「跨度」可比 */
    if (days.size < 2 || !Number.isFinite(first) || !Number.isFinite(last)) continue;
    const span = Math.round((last - first) / 86_400_000);
    if (span < 1) continue;
    notes += 1;
    actual += days.size;
    fixed += fixedCountFor(span);
    if (span > maxSpan) maxSpan = span;
  }
  if (!notes) return null;
  const saved = fixed - actual;
  return { notes, actual, fixed, saved, percent: fixed > 0 ? saved / fixed : 0, spanDays: maxSpan };
}

/** 负载分布：返回 { date: YYYY-MM-DD, count } 数组（N 天内，含今天） */
export function loadDistribution(items: ReviewItem[], nDays: number): Array<{ date: string; count: number }> {
  const out: Array<{ date: string; count: number }> = [];
  for (let i = 0; i < nDays; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    out.push({ date: dateKey(d), count: 0 });
  }
  for (const item of items) {
    if (item.completed || item.isCompleted || !item.nextReviewDate || item.isMissing) continue;
    const d = new Date(item.nextReviewDate);
    const key = dateKey(d);
    const slot = out.find((x) => x.date === key);
    if (slot) slot.count++;
  }
  return out;
}
