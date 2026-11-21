/**
 * 复习统计·加厚层（2026-11-20）
 *
 * 目的：把「数据」内置页从 6 张卡 + 5 个板块扩成一份能拿出去说的年度回顾。
 *
 * 口径原则（和 stats.ts 的既有约定保持一致，不另立一套）：
 *  - 条次 vs 天数分开说：`reviews` 是评级条次，`days` 是有复习的天数。旧代码里
 *    「总复习（天）」其实数的是天数，加厚层两个都给，别混。
 *  - streak 沿用宽松口径：所有评级都算，同一天多次算 1 天，今天没复习就从昨天起算。
 *  - 逾期用 nextReviewDate 与 now 比，不读运行时 isOverdue（纯函数要能直测）。
 *  - 记忆类指标（R / S）只对 FSRS 相位有意义的条目算；样本为 0 一律返回 null，
 *    渲染侧显示「-」，绝不拿 0 冒充。
 *  - 只读，不写盘；不让页面预演影响真实数据。
 */

import type { ReviewItem } from './data';
import { DEFAULT_W, currentR } from './fsrs';
import { localDayKey } from '../core/ui/str';
import { maturityLevel, MATURITY_LABELS } from './render';
import { t } from '../i18n/strings';

const DAY = 86_400_000;
const HEAT_DAYS = 365;
const LOAD_DAYS = 30;

export const RATING_KEYS = ['again', 'hard', 'good', 'easy'] as const;
export type RatingKey = (typeof RATING_KEYS)[number];

export interface DayCount {
  date: string;
  count: number;
}

export interface StageQuality {
  label: string;
  n: number;
  again: number;
}

export interface RankRow {
  id: string;
  name: string;
  n: number;
}

export interface StrengthRow {
  id: string;
  name: string;
  s: number;
}

export interface BadgeRow {
  id: string;
  name: string;
  /** 已达成 */
  got: boolean;
  /** 当前值 / 目标值（渲染进度条用） */
  cur: number;
  goal: number;
}

export interface RichStats {
  now: number;

  /* ── 量 ── */
  /** 评级条次 */
  reviews: number;
  /** 有复习的天数 */
  days: number;
  today: number;
  weekCur: number;
  weekPrev: number;
  monthCur: number;
  monthPrev: number;
  yearCur: number;
  perActiveDay: number;
  bestDay: DayCount | null;

  /* ── 节律 ── */
  hours: number[];
  /** 周一 = 0 */
  weekdays: number[];
  months: number[];
  monthsPrevYear: number[];
  heat: DayCount[];

  /* ── 连续性 ── */
  streak: number;
  bestStreak: number;
  /** 最长断更天数（两次复习之间空着的整天数） */
  gap: number;

  /* ── 质量 ── */
  rating: Record<RatingKey, number>;
  /** good + easy 占比 */
  passRate: number;
  /** 按阶段看「忘了」的比例，找最容易被忘掉的那一段 */
  stageAgain: StageQuality[];

  /* ── 记忆 ── */
  avgR: number | null;
  /** 0-20 / 20-40 / 40-60 / 60-80 / 80-100 五档 */
  rBuckets: number[];
  sMedian: number | null;
  strongest: StrengthRow[];
  weakest: StrengthRow[];

  /* ── 状态 ── */
  phase: { ladder: number; fsrs: number };
  stages: Array<{ label: string; n: number }>;
  kinds: { note: number; card: number; noteReviews: number; cardReviews: number };
  suspended: number;

  /* ── 负载 ── */
  /** 未来 30 天每天到期条数，[0] = 今天 */
  load: number[];
  overdue: StageQuality[];

  /* ── 排行 ── */
  top: RankRow[];
  /** 平均间隔（天）：同一条首末跨度 / 复习次数差，只算复习过 ≥2 天的条目 */
  avgInterval: number | null;

  /* ── 成就 ── */
  badges: BadgeRow[];
}

const pad = (n: number): string => String(n).padStart(2, '0');

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** 成熟度分档（FSRS-7 无阶梯）：按复习次数分 5 档，单源复用 render.maturityLevel。 */
function stageBucket(reviews: number): number {
  return maturityLevel(reviews) - 1;
}

const STAGE_LABELS = MATURITY_LABELS;

/** 成熟度档位名按当前语言出词（中文基准仍是 MATURITY_LABELS） */
const STAGE_KEYS = ['stats.stage.0', 'stats.stage.1', 'stats.stage.2', 'stats.stage.3', 'stats.stage.4'] as const;
function stageLabel(i: number): string {
  return t(STAGE_KEYS[i] ?? 'stats.stage.0');
}

export interface RichOptions {
  /** R 口径权重（拟合优先；缺省回退默认，与调度同口径） */
  w?: number[];
  now?: number;
}

export function computeRichStats(items: ReviewItem[], opts?: RichOptions): RichStats {
  const now = Number(opts?.now) || Date.now();
  const w = opts?.w || DEFAULT_W;
  const todayKey = localDayKey(new Date(now));

  /* 一次遍历把所有历史拍平，后面的指标全部吃这份结果 */
  const dayCount = new Map<string, number>();
  const hours = new Array(24).fill(0) as number[];
  const weekdays = new Array(7).fill(0) as number[];
  const months = new Array(12).fill(0) as number[];
  const monthsPrevYear = new Array(12).fill(0) as number[];
  const rating: Record<RatingKey, number> = { again: 0, hard: 0, good: 0, easy: 0 };
  const stageN = new Array(5).fill(0) as number[];
  const stageAgain = new Array(5).fill(0) as number[];

  let reviews = 0;
  let today = 0;
  let weekCur = 0;
  let weekPrev = 0;
  let monthCur = 0;
  let monthPrev = 0;
  let yearCur = 0;
  let noteReviews = 0;
  let cardReviews = 0;

  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const prevWeekStart = new Date(weekStart.getTime() - 7 * DAY);
  const monthStart = new Date(now);
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const prevMonthStart = new Date(monthStart);
  prevMonthStart.setMonth(prevMonthStart.getMonth() - 1);
  const yearStart = new Date(now);
  yearStart.setMonth(0, 1);
  yearStart.setHours(0, 0, 0, 0);
  const thisYear = new Date(now).getFullYear();

  for (const item of items) {
    const isCard = item.kind === 'card';
    for (const [ri, h] of (item.reviewHistory || []).entries()) {
      const t = new Date(h?.timestamp).getTime();
      if (!Number.isFinite(t)) continue;
      const d = new Date(t);
      const key = localDayKey(d);
      reviews += 1;
      dayCount.set(key, (dayCount.get(key) || 0) + 1);
      if (isCard) cardReviews += 1;
      else noteReviews += 1;

      hours[d.getHours()] += 1;
      weekdays[(d.getDay() + 6) % 7] += 1;
      if (d.getFullYear() === thisYear) months[d.getMonth()] += 1;
      else if (d.getFullYear() === thisYear - 1) monthsPrevYear[d.getMonth()] += 1;

      const rk = String(h.rating) as RatingKey;
      if (rk in rating) rating[rk] += 1;

      const b = stageBucket(ri + 1);
      stageN[b] += 1;
      if (h.rating === 'again') stageAgain[b] += 1;

      if (key === todayKey) today += 1;
      if (t >= weekStart.getTime()) weekCur += 1;
      else if (t >= prevWeekStart.getTime()) weekPrev += 1;
      if (t >= monthStart.getTime()) monthCur += 1;
      else if (t >= prevMonthStart.getTime()) monthPrev += 1;
      if (t >= yearStart.getTime()) yearCur += 1;
    }
  }

  const days = dayCount.size;

  /* 连续性：当前连续（宽松口径，今天没有就从昨天起）+ 历史最长 + 最长断更 */
  const dayKeys = [...dayCount.keys()].sort();
  let bestStreak = 0;
  let run = 0;
  let prevKey: string | null = null;
  let gap = 0;
  for (const key of dayKeys) {
    const t = new Date(`${key}T00:00:00`).getTime();
    if (prevKey) {
      const diff = Math.round((t - new Date(`${prevKey}T00:00:00`).getTime()) / DAY);
      run = diff === 1 ? run + 1 : 1;
      if (diff > 1) gap = Math.max(gap, diff - 1);
    } else {
      run = 1;
    }
    if (run > bestStreak) bestStreak = run;
    prevKey = key;
  }

  let streak = 0;
  const cursor = new Date(now);
  if (!dayCount.has(todayKey)) cursor.setDate(cursor.getDate() - 1);
  while (dayCount.has(localDayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  /* 热力：近 365 天，含今天，缺的日子补 0 */
  const heat: DayCount[] = [];
  for (let i = HEAT_DAYS - 1; i >= 0; i--) {
    const key = shiftDayFor(now, -i);
    heat.push({ date: key, count: dayCount.get(key) || 0 });
  }

  const bestDay = heat.reduce<DayCount | null>(
    (best, d) => (d.count > (best?.count || 0) ? d : best),
    null,
  );

  /* 记忆状态：R 五档 + S 中位数 + 最强/最弱 */
  let rSum = 0;
  let rN = 0;
  const rBuckets = new Array(5).fill(0) as number[];
  const stabilities: number[] = [];
  const strengths: StrengthRow[] = [];
  for (const item of items) {
    const r = currentR(item, w);
    if (r !== null) {
      rSum += r;
      rN += 1;
      rBuckets[Math.min(4, Math.max(0, Math.floor(r * 5)))] += 1;
    }
    const s = Number(item.stability);
    if (Number.isFinite(s) && s > 0) {
      stabilities.push(s);
      strengths.push({ id: item.id, name: item.name, s });
    }
  }
  strengths.sort((a, b) => b.s - a.s);

  /* 成熟度与类型（FSRS-7 无阶梯）：ladder 语义 = 0 次复习的新卡数，fsrs = 已复习数 */
  const stageItems = new Array(5).fill(0) as number[];
  let ladder = 0;
  let fsrs = 0;
  let notes = 0;
  let cards = 0;
  let suspended = 0;
  for (const item of items) {
    if (item.suspended) suspended += 1;
    if (item.kind === 'card') cards += 1;
    else notes += 1;
    const n = Number(item.totalReviews) || (item.reviewHistory || []).length;
    if (n === 0) ladder += 1;
    else fsrs += 1;
    stageItems[maturityLevel(n) - 1] += 1;
  }

  /* 负载：未来 30 天 + 逾期分档。
     按「自然日」分桶，不按 24 小时窗口——晚上 11 点打开时，明晚 8 点到期的那条
     必须落在「明天」，否则用户会看到今天和明天的数都少一条。 */
  const load = new Array(LOAD_DAYS).fill(0) as number[];
  const overdue = [0, 0, 0, 0];
  const startOfDay = (t: number): number => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const today0 = startOfDay(now);
  for (const item of items) {
    if (item.completed || item.suspended || !item.nextReviewDate) continue;
    const t = new Date(item.nextReviewDate).getTime();
    if (!Number.isFinite(t)) continue;
    const dayDiff = Math.round((startOfDay(t) - today0) / DAY);
    if (dayDiff === 0) {
      /* 「今天到期」在面板两处都展示：逾期分档的 overdue[0] 与负载柱的 load[0]。
         旧代码只把它塞进 load[0]、overdue[0] 恒为 0（因为下面只有 dayDiff<0 才分档，
         且 late=-dayDiff≥1，索引最小是 1），于是逾期面板的「今天到期」永远是 0。
         这里同时填入两处，口径各自正确，也不动既有 load[0] 的展示。 */
      overdue[0] += 1;
      load[0] += 1;
      continue;
    }
    if (dayDiff < 0) {
      const late = -dayDiff;
      overdue[late <= 3 ? 1 : late <= 7 ? 2 : 3] += 1;
      continue;
    }
    if (dayDiff < LOAD_DAYS) load[dayDiff] += 1;
  }

  /* 排行与平均间隔 */
  const top: RankRow[] = items
    .map((i) => ({
      id: i.id,
      name: i.name,
      n: (i.reviewHistory || []).length,
      last: i.reviewHistory?.[i.reviewHistory.length - 1]?.timestamp || '',
    }))
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 8)
    .map(({ id, name, n }) => ({ id, name, n }));

  let intervalSum = 0;
  let intervalN = 0;
  for (const item of items) {
    const hist = item.reviewHistory || [];
    if (hist.length < 2) continue;
    const stamps = hist
      .map((h) => new Date(h?.timestamp).getTime())
      .filter((t) => Number.isFinite(t))
      .sort((a, b) => a - b);
    if (stamps.length < 2) continue;
    const span = (stamps[stamps.length - 1] - stamps[0]) / DAY;
    if (span <= 0) continue;
    intervalSum += span / (stamps.length - 1);
    intervalN += 1;
  }

  const passRate = reviews ? (rating.good + rating.easy) / reviews : 0;
  const sMedian = median(stabilities);

  return {
    now,
    reviews,
    days,
    today,
    weekCur,
    weekPrev,
    monthCur,
    monthPrev,
    yearCur,
    perActiveDay: days ? reviews / days : 0,
    bestDay: bestDay && bestDay.count > 0 ? bestDay : null,
    hours,
    weekdays,
    months,
    monthsPrevYear,
    heat,
    streak,
    bestStreak,
    gap,
    rating,
    passRate,
    stageAgain: STAGE_LABELS.map((_label, i) => ({ label: stageLabel(i), n: stageN[i], again: stageAgain[i] })),
    avgR: rN ? rSum / rN : null,
    rBuckets,
    sMedian,
    strongest: strengths.slice(0, 5),
    weakest: [...strengths].slice(-5).reverse(),
    phase: { ladder, fsrs },
    stages: STAGE_LABELS.map((_label, i) => ({ label: stageLabel(i), n: stageItems[i] })),
    kinds: { note: notes, card: cards, noteReviews, cardReviews },
    suspended,
    load,
    overdue: [
      { label: t('achv.dueToday'), n: overdue[0], again: 0 },
      { label: t('achv.due1to3'), n: overdue[1], again: 0 },
      { label: t('achv.due4to7'), n: overdue[2], again: 0 },
      { label: t('achv.due8plus'), n: overdue[3], again: 0 },
    ],
    top,
    avgInterval: intervalN ? intervalSum / intervalN : null,
    badges: buildBadges({
      reviews,
      days,
      streak,
      bestStreak,
      notes: notes + cards,
      strengths: strengths.length,
      veryStable: strengths.filter((s) => s.s >= 100).length,
      passRate,
      bestDay,
    }),
  };
}

/** 按给定「现在」推 n 天前的本地日期键（不用 Date.now，方便测试） */
function shiftDayFor(now: number, n: number): string {
  const d = new Date(now);
  d.setDate(d.getDate() + n);
  return localDayKey(d);
}

interface BadgeInput {
  reviews: number;
  days: number;
  streak: number;
  bestStreak: number;
  notes: number;
  strengths: number;
  /** S ≥ 100 天的条目数 */
  veryStable: number;
  passRate: number;
  bestDay: DayCount | null;
}

/**
 * 成就徽章：全部实时算，不落盘。
 * 落盘的话用户清一次数据就永久丢，反而成了投诉来源；这里只做展示。
 */
function buildBadges(b: BadgeInput): BadgeRow[] {
  const peak = b.bestDay?.count || 0;
  const mk = (id: string, name: string, cur: number, goal: number): BadgeRow => ({
    id,
    name,
    got: cur >= goal,
    cur,
    goal,
  });
  return [
    mk('streak7', t('achv.streak7'), b.streak, 7),
    mk('streak30', t('achv.streak30'), b.streak, 30),
    mk('streak100', t('achv.streak100'), b.bestStreak, 100),
    mk('reviews100', t('achv.reviews100'), b.reviews, 100),
    mk('reviews500', t('achv.reviews500'), b.reviews, 500),
    mk('reviews2000', t('achv.reviews2000'), b.reviews, 2000),
    mk('notes10', t('achv.notes10'), b.notes, 10),
    mk('notes50', t('achv.notes50'), b.notes, 50),
    mk('notes100', t('achv.notes100'), b.notes, 100),
    mk('day50', t('achv.day50'), peak, 50),
    mk('s30', t('achv.stable10'), b.strengths, 10),
    mk('s100', t('achv.evergreen5'), b.veryStable, 5),
    mk('pass80', t('achv.passRate80'), b.reviews >= 50 ? Math.round(b.passRate * 100) : 0, 80),
  ];
}

/** 渲染用：日期键 → MM/DD */
export function shortDate(key: string): string {
  return key.slice(5).replace('-', '/');
}

/** 渲染用：小时 → 02 这种两位 */
export function hh(h: number): string {
  return pad(h);
}
