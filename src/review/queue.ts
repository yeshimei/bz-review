/**
 * 复习队列口径（item 6/9 拍板，2026-09）：三区列与「开始本轮」同一套纯函数。
 *
 * 统一前的问题：列表三区按「时刻已过 = 逾期 / 日历日 = 今天 / 其余 = 未来」分区，
 * 而「开始本轮」（dueItems）只含 逾期 + R<阈值提前逾期——「今日到期但时刻未到」的
 * 中列条目点「开始本轮」不带，两套口径打架。
 *
 * 统一后（全部走本模块，互斥分区）：
 * - 逾期列 = isOverdue（时刻已过）
 * - 今天列 = isDueToday（日历日含逾期早段外的今日；提前卡落此列）
 * - 未来列 = 其余未完成
 * - 「开始本轮」= 逾期 ∪ R 阈值提前 ∪ 今日到期（item 9：今日到期时刻未到 → 允许提前开始今天全部）
 * 依赖方向：只依赖 data/fsrs 类型（纯数据层，可 node 环境直测）。
 */
import type { ReviewItem } from './data';
import { DEFAULT_W, currentR } from './fsrs';
import { dateKey } from './stats';
import { isHiddenFromQueue } from './card-manager';

/** R 阈值缺省值（设置 reviewRThreshold 未配置/非法时的回退；markReview 放行、开始本轮、三区列共用） */
export const DEFAULT_R_THRESHOLD = 0.9;

/**
 * 粗估剩余耗时（批 2）：一条按 1 分钟算。
 *
 * 为什么只给量级：复习一条笔记的实际耗时从 20 秒到 5 分钟都有，精确预估是假的；
 * 用户要的是「还要不要坐半小时」，1 分钟/条已经够回答这个问题。
 */
export function etaTextOf(count: number): string {
  const n = Math.max(0, Math.round(Number(count) || 0));
  if (n <= 0) return '';
  return `约 ${n} 分钟`;
}

/** 是否今日到期（nextReviewDate 落在今日本地日内；与 isOverdue 正交的日历口径）。
 *  自 ui.ts 迁入（item 6 口径统一）：纯函数下沉 queue.ts，ui.ts re-export 保持签名。 */
export function isDueToday(item: ReviewItem): boolean {
  if (!item.nextReviewDate) return false;
  return dateKey(new Date(item.nextReviewDate)) === dateKey(new Date());
}

/** R 阈值提前复习判定：fsrs 相位 + 可算 R + R<threshold（与 markReview 放行、调度排期同口径）。
 *  A7 审查修复：当前 R 计算收编 fsrs.currentR 单源（原五处同式复写之一）。 */
export function isEarlyDue(item: ReviewItem, rThreshold: number, w: number[]): boolean {
  const r = currentR(item, w);
  return r !== null && r < rThreshold;
}

/** 队列条目可用性：非完成、非文件缺失、非挂起/埋藏（分区前置过滤）。
 *  卡片管理器的两个标记只在这一处拦——三区列、本轮队列、负荷预测自动同口径。 */
function active(i: ReviewItem): boolean {
  return !i.isCompleted && !i.completed && !i.isMissing && !isHiddenFromQueue(i);
}

/** 三区列分区（互斥）：逾期 → 今天（日历日 ∪ R 阈值提前卡，拍板：提前卡落「今天」列）→ 未来；done 独立 */
export interface QueueColumns {
  overdue: ReviewItem[];
  today: ReviewItem[];
  future: ReviewItem[];
  done: ReviewItem[];
}

export function partitionQueue(
  items: ReviewItem[],
  rThreshold: number = DEFAULT_R_THRESHOLD,
  w: number[] = DEFAULT_W
): QueueColumns {
  const overdue: ReviewItem[] = [];
  const today: ReviewItem[] = [];
  const future: ReviewItem[] = [];
  const done: ReviewItem[] = [];
  for (const i of items) {
    if (!active(i)) {
      done.push(i);
      continue;
    }
    if (i.isOverdue) overdue.push(i);
    else if (isDueToday(i) || isEarlyDue(i, rThreshold, w)) today.push(i);
    else future.push(i);
  }
  return { overdue, today, future, done };
}

/**
 * 「开始本轮」集合（未排序、未截断）：逾期 ∪ R 阈值提前 ∪ 今日到期。
 * 与三区列同源（partitionQueue 的 overdue+today 再并入提前卡）——列表看到什么本轮就复习什么。
 */
export function roundQueue(items: ReviewItem[], rThreshold: number, w: number[]): ReviewItem[] {
  return items.filter((i) => {
    if (!active(i)) return false;
    if (i.isOverdue) return true;
    if (isDueToday(i)) return true;
    return isEarlyDue(i, rThreshold, w);
  });
}

/** R 阈值提前卡（挂「提前」tag 用；在 roundQueue 集合内但既非逾期也非今日到期） */
export function earlyDueOnly(items: ReviewItem[], rThreshold: number, w: number[]): ReviewItem[] {
  return items.filter((i) => active(i) && !i.isOverdue && !isDueToday(i) && isEarlyDue(i, rThreshold, w));
}

// ==================== 批 3：本轮限额 / 休假 / 到点时刻 ====================

/** 新条目：一次都没复习过（改造前老数据用 lastReviewed 兜底） */
export function isNewItem(item: ReviewItem): boolean {
  return !(Number(item.totalReviews) > 0) && !item.lastReviewed;
}

export interface RoundLimits {
  /** 新条目上限；0/缺省 = 不限 */
  newLimit?: number;
  /** 到期（已复习过）上限；0/缺省 = 不限 */
  reviewLimit?: number;
  /** 先清到期（默认）还是先上新卡 */
  order?: 'due-first' | 'new-first';
}

/**
 * 本轮截断（批 3）。
 *
 * 为什么要分开两个额度：新卡与到期卡的成本完全不同——新卡要读、要想、要建立记忆，
 * 到期卡只是验证。合成一个「每日上限」时，用户要么被新卡压垮，要么整天只复习旧的。
 *
 * 为什么顺序可配：考试前想先清到期（把已经会的巩固掉），平时想先上新卡（趁精神好）。
 * 截断只影响本轮，不动数据、不改排期——没复习到的下次还在队列里。
 */
export function applyRoundLimits(items: ReviewItem[], limits: RoundLimits = {}): ReviewItem[] {
  const order = limits.order ?? 'due-first';
  const take = (arr: ReviewItem[], limit?: number): ReviewItem[] =>
    limit && limit > 0 ? arr.slice(0, Math.floor(limit)) : arr;
  const fresh = items.filter(isNewItem);
  const due = items.filter((i) => !isNewItem(i));
  const pickedNew = take(fresh, limits.newLimit);
  const pickedDue = take(due, limits.reviewLimit);
  return order === 'new-first' ? [...pickedNew, ...pickedDue] : [...pickedDue, ...pickedNew];
}

/**
 * 休假中？（批 3）
 *
 * 只认「到哪一天为止」这一个字段：设置里填一个日期，那天之前不弹提醒、不进本轮、
 * 逾期也不累计。比「暂停开关 + 时长」少一个状态，用户不用记得回来关。
 */
export function isOnVacation(vacationUntil: string | undefined | null, now: Date = new Date()): boolean {
  if (!vacationUntil) return false;
  const t = new Date(vacationUntil).getTime();
  if (!Number.isFinite(t)) return false;
  return now.getTime() < t;
}

/**
 * 今天稍后到点的时刻（批 3）。
 *
 * 阶梯里的 1m / 30m / 6h 是**当天内**的复习步：以前这些条目在列表里只显示「今天到期」，
 * 看不出到底什么时候到点，用户只能一遍遍刷新。返回 HH:MM（本地），不是今天或已经到点返回 null。
 */
export function dueTimeLabel(item: ReviewItem, now: Date = new Date()): string | null {
  if (!item.nextReviewDate) return null;
  const d = new Date(item.nextReviewDate);
  if (!Number.isFinite(d.getTime())) return null;
  if (dateKey(d) !== dateKey(now)) return null;
  if (d.getTime() <= now.getTime()) return null;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** 今天稍后还会到点的条数（提醒文案用：不催，只告诉用户晚上还有几条） */
export function dueLaterTodayCount(items: ReviewItem[], now: Date = new Date()): number {
  return items.filter((i) => active(i) && dueTimeLabel(i, now) !== null).length;
}

// ==================== 批 5：定时提醒 / 负荷预测 ====================

/**
 * 现在该不该弹每日提醒（批 5）。
 *
 * 以前只有「有逾期就弹」，开着库就可能在上午九点弹一次、下午三点再弹一次。
 * 定时提醒的语义是「每天一次，到点提醒」：过了点才提醒（晚一点开着也无所谓），
 * 同一天只提醒一次（靠调用方记日期，这里只判时间）。
 */
export function shouldRemindNow(now: Date, at: string | undefined | null, lastRemindedDate?: string | null): boolean {
  const text = String(at ?? '').trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!m) return false;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return false;
  const due = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
  if (now.getTime() < due.getTime()) return false;
  return String(lastRemindedDate ?? '') !== dateKey(now);
}

export interface LoadPoint {
  /** YYYY-MM-DD（本地日） */
  day: string;
  count: number;
}

/**
 * 未来 N 天的复习负荷（批 5）。
 *
 * 用途是「别把假期排满」：用户看到一个尖峰就知道那天要复习 120 条，
 * 与其到那天再崩，不如现在把间隔拉开。
 */
export function forecastLoad(items: readonly ReviewItem[], days: number = 30, now: Date = new Date()): LoadPoint[] {
  const span = Math.max(1, Math.min(365, Math.round(days)));
  const buckets = new Map<string, number>();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let i = 0; i < span; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    buckets.set(dateKey(d), 0);
  }
  for (const it of items) {
    if (!active(it) || !it.nextReviewDate) continue;
    const d = new Date(it.nextReviewDate);
    if (!Number.isFinite(d.getTime())) continue;
    const key = dateKey(d);
    if (!buckets.has(key)) continue;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return [...buckets.entries()].map(([day, count]) => ({ day, count }));
}

/** 未来 N 天的总量与峰值（弹窗里一句话说清） */
export function forecastSummary(points: readonly LoadPoint[]): { total: number; peak: number; peakDay: string } {
  let total = 0;
  let peak = 0;
  let peakDay = '';
  for (const p of points) {
    total += p.count;
    if (p.count > peak) {
      peak = p.count;
      peakDay = p.day;
    }
  }
  return { total, peak, peakDay };
}
