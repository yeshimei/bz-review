/**
 * FSRS-7 排期模型（2026-11 升级，复刻官方 srs-benchmark/models/fsrs_v7.py）。
 *
 * 相比 v4 的结构性变化：
 * - 34 参数（v4 是 19）；记忆状态从 (S, D) 升为 (S_long, S_short, D) 双稳定性；
 * - 遗忘曲线是短期/长期两条幂律的加权和，权重随 S/D 变；
 * - 间隔不再有解析解，按目标留存率 DR 二分求 R(t)=DR 的 t；
 * - 去掉 10 级阶梯：新卡首次评级即初始化三元组，之后每轮都走 FSRS。
 *
 * 数据承载：`stability` = S_long（字段名不变，下游读到的仍是"稳定性"），
 * `stabilityShort` = S_short（新增），`difficulty` = D。详见 docs/FSRS-7-实现说明.md。
 */
export type Rating = 'again' | 'hard' | 'good' | 'easy';

/** 官方 FSRS-7 默认 34 参数（srs-benchmark/models/fsrs_v7.py 的 init_w）。 */
export const DEFAULT_W = [
  0.1104, 2.2395, 3.9221, 11.7841, 6.1686, 0.6457, 3.6807, 1.9795, 0.0, 1.3826,
  0.7024, 0.5999, 0.8146, 0.6398, 1.0, 1.3207, 0.6707, 3.8668, 0.4416, 0.0934,
  1.8631, 0.6162, 1.0869, 0.1567, 0.0801, 0.2421, 0.9464, 0.1433, 0.7145,
  0.0, 0.5667, 0.3734, 0.5333, 0.3048,
];

/** 默认目标留存率（官方推荐的 90%：留存与复习负担的平衡点）。 */
export const DEFAULT_DESIRED_RETENTION = 0.9;

const S_MIN = 1e-4;
/** 官方 S_MAX：稳定性上界 36500 天（srs-benchmark/models/fsrs_v7.py 的 S_MAX）。 */
const S_MAX = 36500;
const MAX_INTERVAL = 36500; // 100 年，与官方 interval solver 上界一致

const RATING_INDEX: Record<Rating, number> = { again: 0, hard: 1, good: 2, easy: 3 };
const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));

/** 保留：最短间隔 1 分钟（评级 toast 与钳位下界的口径，学习步骤也用它作下限）。 */
export const MIN_INTERVAL_DAYS = 1 / 1440;

/**
 * Anki 式学习步骤：解析 "1m 10m 1d" 为分钟数组。
 * 只认 1m/10m/30m 这类"分钟"单位；≥1d 的步骤不认（FSRS 下步骤必须当天完成，
 * Anki 官方明确反对跨天步骤），返回 null 表示整串无效（关闭）。
 */
export function parseLearningSteps(text: unknown): number[] | null {
  if (typeof text !== 'string') return null;
  const parts = text.trim().split(/[\s,，]+/).filter(Boolean);
  if (!parts.length) return null;
  const mins: number[] = [];
  for (const p of parts) {
    const m = /^(\d+(?:\.\d+)?)\s*(m|min|分钟)?$/i.exec(p);
    if (!m) return null; // 不认 h/d —— 步骤必须当天
    const v = Number(m[1]);
    if (!Number.isFinite(v) || v < 1 || v > 1440) return null;
    mins.push(v);
  }
  return mins.length ? mins : null;
}

/**
 * Anki Hard 步长：第一步 = 前两步均值；其它步 = 重复当前步。
 * 只有一步时 Hard = 该步 ×1.5（Anki 对单步的特殊规则），上限 1 天。
 */
export function hardStepMinutes(stepsMins: readonly number[], currentIdx: number): number {
  if (stepsMins.length === 1) return Math.min(1440, stepsMins[0] * 1.5);
  if (currentIdx === 0) return (stepsMins[0] + stepsMins[1]) / 2;
  return stepsMins[Math.min(currentIdx, stepsMins.length - 1)];
}

/** 兼容旧符号：v7 无阶梯，这些常量保留给仍引用它们的数据/UI 代码。 */
export const FSRS_FIRST_INTERVALS = [1 / 1440, 1 / 48, 1 / 4, 1, 3, 7, 15, 30, 60, 120];
export const FSRS_FIRST_TEXTS = ['1m', '30m', '6h', '1d', '3d', '7d', '15d', '30d', '60d', '120d'];
export const TOTAL_STAGES = 10;
export const LADDER_MAX = 9;

/** 单次遗忘曲线系数（内部用，避免重复计算）。 */
interface CurveCoeffs {
  d1: number; a1: number; d2: number; a2: number; w1: number; w2: number;
}

function coeffs(sLong: number, sShort: number, d: number, w: number[]): CurveCoeffs {
  const d1 = -clamp(w[23] * Math.pow(sShort, w[33] - 0.3), 0.01, 0.95);
  const f1 = Math.exp(clamp(Math.log(Math.max(w[25], 1e-9)) / d1, -700, 60)) - 1;
  const a1 = f1 / Math.max(sShort, S_MIN);
  const d2 = -clamp(w[24], 0.01, 0.95);
  const f2 = Math.pow(Math.max(w[26], 1e-9), 1 / d2) - 1;
  const dts = Math.exp((d - 5) * (w[32] - 0.3));
  const a2 = (f2 * dts) / Math.max(sLong, S_MIN);
  const w1 = w[27] * Math.pow(Math.max(sShort, S_MIN), -w[29]);
  const w2 = w[28] * Math.pow(Math.max(sLong, S_MIN), w[30]) * Math.exp((d - 5) * (w[31] - 0.5));
  return { d1, a1, d2, a2, w1, w2 };
}

export class FSRS {
  w: number[];

  constructor(w: number[] = DEFAULT_W) {
    this.w = w;
  }

  /** 混合遗忘曲线 R(t)：短期/长期双幂律加权。 */
  R(t: number, sLong: number, sShort: number, d: number): number {
    if (!(t > 0)) return 1;
    const c = coeffs(sLong, sShort, d, this.w);
    const i1 = Math.max(c.a1 * t + 1, 1e-12);
    const i2 = Math.max(c.a2 * t + 1, 1e-12);
    const r1 = Math.pow(i1, c.d1);
    const r2 = Math.pow(i2, c.d2);
    const denom = c.w1 + c.w2;
    const ret = denom > 0 ? (c.w1 * r1 + c.w2 * r2) / denom : 0;
    return clamp(ret * (1 - 2e-5) + 1e-5, 0, 1);
  }

  /** 短期分量 R_short(t)（更新 S_short 用）。 */
  rShort(t: number, sShort: number): number {
    const d1 = -clamp(this.w[23] * Math.pow(Math.max(sShort, S_MIN), this.w[33] - 0.3), 0.01, 0.95);
    const f1 = Math.exp(clamp(Math.log(Math.max(this.w[25], 1e-9)) / d1, -700, 60)) - 1;
    const a1 = f1 / Math.max(sShort, S_MIN);
    return Math.pow(Math.max(a1 * Math.max(t, 0) + 1, 1e-12), d1);
  }

  /** 首次评级的初始三元组：S_long=w[G-1]、S_short=0.8·S_long、D=initD(G)。 */
  initState(rating: Rating): { sLong: number; sShort: number; d: number } {
    const idx = RATING_INDEX[rating];
    const sLong = clamp(this.w[idx] ?? DEFAULT_W[idx], S_MIN, S_MAX);
    return { sLong, sShort: 0.8 * sLong, d: this.initD(rating) };
  }

  /** 兼容旧调用：初始长期稳定性。 */
  initS(rating: Rating): number {
    return this.initState(rating).sLong;
  }

  /** 初始难度：clamp(w4 − e^(w5·(G−1)) + 1, 1, 10)。 */
  initD(rating: Rating): number {
    const g = RATING_INDEX[rating] + 1;
    return clamp(this.w[4] - Math.exp(this.w[5] * (g - 1)) + 1, 1, 10);
  }

  /** 更新一个稳定性分量。a=7 长期（用混合 R），a=15 短期（用 R_short）。 */
  private nextStability(s: number, d: number, r: number, rating: Rating, a: number): number {
    const g = RATING_INDEX[rating] + 1;
    const hard = g === 2 ? this.w[a + 6] : 1;
    const easy = g === 4 ? this.w[a + 7] : 1;
    const sFail = this.w[a + 3] * (Math.pow(s + 1, this.w[a + 4]) - 1) * Math.exp((1 - r) * this.w[a + 5]);
    const postLapse = Math.min(s, sFail);
    if (g === 1) return clamp(postLapse, S_MIN, S_MAX);
    const sinc = Math.exp(this.w[a] - 1.5) * (11 - d) * Math.pow(s, -this.w[a + 1]) *
      (Math.exp((1 - r) * this.w[a + 2]) - 1) * hard * easy + 1;
    return clamp(Math.max(postLapse, s * sinc), S_MIN, S_MAX);
  }

  /** 更新难度：L=R+0.1(again)，固定 1%/99% 均值回归。 */
  nextDifficulty(d: number, r: number, rating: Rating): number {
    const g = RATING_INDEX[rating] + 1;
    const L = g === 1 ? r + 0.1 : 1;
    const deltaD = -this.w[6] * (g - 3) * ((10 - d) / 9) * L;
    return clamp(0.01 * this.initD('easy') + 0.99 * (d + deltaD), 1, 10);
  }

  /** 一次复习后的新三元组。 */
  nextState(sLong: number, sShort: number, d: number, t: number, rating: Rating): { sLong: number; sShort: number; d: number; r: number } {
    const r = this.R(t, sLong, sShort, d);
    const r1 = this.rShort(t, sShort);
    let newLong = this.nextStability(sLong, d, r, rating, 7);
    let newShort = this.nextStability(sShort, d, r1, rating, 15);
    if (rating === 'again') newShort = Math.min(newShort, 0.8 * newLong);
    return { sLong: newLong, sShort: newShort, d: this.nextDifficulty(d, r, rating), r };
  }

  /** 二分求 R(t)=target 的 t（R 单调递减，绝对收敛）。 */
  intervalForRetention(sLong: number, sShort: number, d: number, target = DEFAULT_DESIRED_RETENTION): number {
    let lo = 0;
    let hi = MAX_INTERVAL;
    // 40 次二分：上界 36500 天 → 精度 3e-8 天（约 2.6 毫秒），足够且比 60 次省 1/3。
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (this.R(mid, sLong, sShort, d) > target) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }
}

/** 落盘前钳位：乘缩放系数 → 压到 [最短, 上限]。 */
export function clampIntervalDays(days: number, scale = 1, capDays = 0): number {
  const k = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const cap = capDays > 0 ? Math.max(capDays, MIN_INTERVAL_DAYS) : Infinity;
  return Math.min(Math.max(days * k, MIN_INTERVAL_DAYS), cap);
}

/** 间隔说人话（评级 toast）。 */
export function formatInterval(days: number): string {
  const minutes = Math.round(days * 1440);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/**
 * 本地日期键 YYYY-MM-DD。
 *
 * 排期里 ISO 串是 UTC，但「今天是不是建档那天」必须按用户本地日历算：
 * 东八区凌晨 0–8 点，ISO 的日期还是昨天。以前拿 toISOString().slice(0,10)
 * 跟本地 todayKey 比，会把刚建档的新卡误判成跨天、直接跳过学习步骤。
 */
export function localDateKey(value: Date | number): string {
  const d = value instanceof Date ? value : new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Anki 复习间隔 fuzz 的抖动幅度（天）。
 *
 * 官方规则（rslib/src/scheduler/states/fuzz.rs）：<2.5 天不抖；>=2.5 天从
 * 「1 天 + 各区间系数×落在区间内的天数」起算：2.5–7 天每天 +0.15，
 * 7–20 天 +0.10，20 天以上 +0.05。目的不是改记忆模型，而是把同一天到期的卡
 * 摊到相邻几天，避免「复习高峰扎堆」。
 */
export function reviewFuzzDelta(intervalDays: number): number {
  if (!(intervalDays >= 2.5)) return 0;
  let delta = 1;
  // 每一项都要像 Anki 那样先 .max(0)：区间外的贡献不能倒扣基础 1 天。
  delta += 0.15 * Math.max(0, Math.min(intervalDays, 7) - 2.5);
  delta += 0.1 * Math.max(0, Math.min(intervalDays, 20) - 7);
  delta += 0.05 * Math.max(0, intervalDays - 20);
  return Math.max(0, delta);
}

/** 稳定伪随机 [0,1)：同一 seed 恒定，跨设备/重装一致（Anki 用 card_id+reps 做种）。 */
export function fuzzFactor(seed: string): number {
  let h = 2166136261; // FNV-1a
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15; h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Anki 学习步骤抖动：在原分钟数上再加 0~25%，最多加 5 分钟（只加不减）。
 * 源码 anki/rslib/src/scheduler/answering/learning.rs 的 learning_ivl_with_fuzz。
 */
export function learningStepFuzzMinutes(minutes: number, fuzz: number): number {
  if (!(minutes > 0) || !Number.isFinite(fuzz)) return minutes;
  // Anki 源码以秒计：min(25%, 300 秒)=最多 5 分钟；这里入参是分钟，故封顶 5。
  const extra = Math.min(minutes * 0.25, 5);
  return minutes + clamp(fuzz, 0, 1) * extra;
}

/**
 * 对 FSRS 间隔施加 Anki 式抖动。
 * 保留本插件的小数天（Anki 取整到天），抖完仍钳在 [minDays, maxDays] 内。
 * fuzz ∈ [0,1)，上下界各扩 reviewFuzzDelta(intervalDays)。
 */
export function applyReviewFuzz(
  intervalDays: number,
  fuzz: number,
  minDays = MIN_INTERVAL_DAYS,
  maxDays = Infinity
): number {
  if (!(intervalDays > 0) || !Number.isFinite(fuzz)) return intervalDays;
  const delta = reviewFuzzDelta(intervalDays);
  if (delta <= 0) return Math.min(Math.max(intervalDays, minDays), maxDays);
  const lo = Math.max(minDays, intervalDays - delta);
  const hi = Math.min(maxDays, intervalDays + delta);
  if (!(hi > lo)) return Math.min(Math.max(intervalDays, minDays), maxDays);
  const f = clamp(fuzz, 0, 1);
  return lo + f * (hi - lo);
}

/** Anki 源码：Easy 毕业间隔必须严格大于 Good（good+1 天作下限）。 */
function easyAtLeast(goodDays: number, rating: Rating, days: number): number {
  return rating === 'easy' ? Math.max(days, goodDays + 1) : days;
}

// ==================== 调度纯函数 ====================

export interface ScheduleState {
  stage: number;
  phase: 'ladder' | 'fsrs' | 'relearn';
  stability?: number | null;      // S_long
  stabilityShort?: number | null; // S_short
  difficulty?: number | null;
  lastReviewed?: string | null;
  reviewStart?: string;
}

export interface ScheduleDecision {
  stage: number;                  // 步骤序号（ladder/relearn 期）/ 0（fsrs 期）
  phase: 'ladder' | 'fsrs' | 'relearn';
  stability: number | null;       // S_long（写回；步骤期 null = 不写）
  stabilityShort: number | null;  // S_short（写回；步骤期 null）
  difficulty: number | null;
  intervalDays: number;
  enteringFsrs: boolean;          // 毕业/首次评级（初始化三元组）
  graduated: boolean;             // 本次是走完步骤毕业（区别于裸 FSRS 首次）
  historyStage: number;
  R: number | null;
  historyStability: number | null;
  historyStabilityShort: number | null;
  historyDifficulty: number | null;
}

/** 学习步骤配置（Anki 口径）。 */
export interface LearningStepsOpts {
  /** 步骤分钟数组（parseLearningSteps 解析结果）；空/null = 关闭，直接 FSRS */
  stepsMins?: number[] | null;
  /** 毕业间隔（天，下限保护）；默认 1 */
  graduatingDays?: number;
  /** 重新学习步骤（FSRS 阶段点"忘了"后的当天重学，分钟）；空/null = 关闭 */
  relearnStepsMins?: number[] | null;
  /** 当天是否还在同一天（步骤只在当天有效；false = 强制毕业） */
  sameDay?: boolean;
}

/**
 * 调度纯函数：Anki 式学习步骤 + 全量 FSRS-7。
 * - 学习步骤（opts.stepsMins 非空、同日、未毕业）：Good 进下一步、Again 回第一步、
 *   Hard 第一步给前两步均值、Easy 直接毕业；步骤期不写 S/D；
 * - 毕业（走完最后一步 Good 或任意步 Easy）→ 初始化 FSRS 三元组、按 graduatingDays 排期；
 * - 无步骤/跨天 → 直接 FSRS：首次评级初始化三元组、之后算 R 更新并二分求间隔。
 */
export function scheduleNext(
  state: ScheduleState,
  rating: Rating,
  now: Date,
  w: number[] = DEFAULT_W,
  desiredRetention = DEFAULT_DESIRED_RETENTION,
  opts: LearningStepsOpts = {}
): ScheduleDecision {
  const fsrs = new FSRS(w);

  // ===== Anki 学习步骤分支 =====
  const steps = opts.stepsMins;
  const inSteps = state.phase === 'ladder' && steps && steps.length > 0 && opts.sameDay !== false;
  if (inSteps) {
    const idx = Math.max(0, Math.min(state.stage, steps.length - 1));
    let nextStage: number;
    let days: number;
    let graduate = false;
    if (rating === 'easy') {
      graduate = true;
    } else if (rating === 'again') {
      nextStage = 0;
      days = steps[0] / 1440;
    } else if (rating === 'hard') {
      nextStage = idx;
      days = hardStepMinutes(steps, idx) / 1440;
    } else { // good
      if (idx >= steps.length - 1) graduate = true;
      else { nextStage = idx + 1; days = steps[idx + 1] / 1440; }
    }

    // 步骤期也更新记忆状态（Anki 源码：LearnState.memory_state = fsrs_next_states[评级].memory）。
    // 首次评级 initState，之后 nextState（t 用当前间隔——步骤间隔是分钟级，t 很小）。
    let sl: number, ss: number, dd: number;
    // 新卡的 stability=1 / difficulty=0.3 是占位初值，不是真实三元组：
    // 第一次评级必须 initState(rating)，否则 0.3 会被 nextDifficulty 钳成 1（误判成极简卡）。
    // 走过至少一步后 lastReviewed 才有值，才按 nextState 推进。
    if (!state.lastReviewed || !(state.stability && state.stability > 0)) {
      const init = fsrs.initState(rating);
      sl = init.sLong; ss = init.sShort; dd = init.d;
    } else {
      const prevS = state.stability;
      const prevSs = state.stabilityShort && state.stabilityShort > 0 ? state.stabilityShort : 0.8 * prevS;
      const prevD = state.difficulty && state.difficulty > 0 ? state.difficulty : fsrs.initD('good');
      const t = state.lastReviewed ? Math.max(0, (now.getTime() - new Date(state.lastReviewed).getTime()) / 86400000) : 0;
      const nx = fsrs.nextState(prevS, prevSs, prevD, t, rating);
      sl = nx.sLong; ss = nx.sShort; dd = nx.d;
    }
    const rS = Math.round(sl * 100) / 100;
    const rSs = Math.round(ss * 100) / 100;
    const rD = Math.round(dd * 100) / 100;

    if (graduate) {
      // 毕业：三元组由本次评级重新初始化（与裸 FSRS 首次同口径），间隔 = 该评级的 FSRS 首间隔。
      // Anki FSRS 模式下毕业间隔来自 fsrs.good/easy.interval，不是固定 graduating interval。
      const init = fsrs.initState(rating);
      const gS = Math.round(init.sLong * 100) / 100;
      const gSs = Math.round(init.sShort * 100) / 100;
      const gD = Math.round(init.d * 100) / 100;
      const fsrsFirst = fsrs.intervalForRetention(init.sLong, init.sShort, init.d, desiredRetention);
      const goodInit = fsrs.initState('good');
      const goodDays = fsrs.intervalForRetention(goodInit.sLong, goodInit.sShort, goodInit.d, desiredRetention);
      const gradDays = easyAtLeast(goodDays, rating, Math.max(MIN_INTERVAL_DAYS, fsrsFirst, opts.graduatingDays ?? 1));
      return {
        stage: 0, phase: 'fsrs', stability: gS, stabilityShort: gSs, difficulty: gD,
        intervalDays: gradDays, enteringFsrs: true, graduated: true,
        historyStage: 1, R: null, historyStability: gS, historyStabilityShort: gSs, historyDifficulty: gD,
      };
    }
    // 仍在步骤中：写三元组（拟合可用），phase 保持 ladder。
    return {
      stage: nextStage!, phase: 'ladder', stability: rS, stabilityShort: rSs, difficulty: rD,
      intervalDays: days!, enteringFsrs: false, graduated: false,
      historyStage: nextStage! + 1, R: null,
      historyStability: rS, historyStabilityShort: rSs, historyDifficulty: rD,
    };
  }

  // ===== 重新学习步骤（FSRS 阶段点"忘了"后，Anki 的 relearn_steps）=====
  if (state.phase === 'relearn') {
    const rsteps = opts.relearnStepsMins;
    const idx = rsteps && rsteps.length ? Math.max(0, Math.min(state.stage, rsteps.length - 1)) : 0;
    // 三元组已在该次 Again 时按 FSRS 更新过；这里继续按评级推进
    const prevS = Math.max(S_MIN, state.stability || 1);
    const prevSs = state.stabilityShort && state.stabilityShort > 0 ? state.stabilityShort : 0.8 * prevS;
    const prevD = state.difficulty && state.difficulty > 0 ? state.difficulty : fsrs.initD('good');
    const t = state.lastReviewed ? Math.max(0, (now.getTime() - new Date(state.lastReviewed).getTime()) / 86400000) : 0;
    const nx = fsrs.nextState(prevS, prevSs, prevD, t, rating);
    const rS = Math.round(nx.sLong * 100) / 100;
    const rSs = Math.round(nx.sShort * 100) / 100;
    const rD = Math.round(nx.d * 100) / 100;

    // 无重学步骤 / 跨天 / Easy / 走完最后一步 Good → 重新毕业回 FSRS
    let graduate = rating === 'easy' || !rsteps || !rsteps.length || opts.sameDay === false;
    let nextStage = idx;
    let days = 0;
    if (!graduate) {
      if (rating === 'again') { nextStage = 0; days = rsteps![0] / 1440; }
      else if (rating === 'hard') { nextStage = idx; days = hardStepMinutes(rsteps!, idx) / 1440; }
      else { // good
        if (idx >= rsteps!.length - 1) graduate = true;
        else { nextStage = idx + 1; days = rsteps![idx + 1] / 1440; }
      }
    }
    if (graduate) {
      // 重新毕业：间隔用更新后三元组的 FSRS good/easy 首间隔（Anki 口径）
      const fsrsFirst = fsrs.intervalForRetention(nx.sLong, nx.sShort, nx.d, desiredRetention);
      let goodDays = fsrsFirst;
      if (rating === 'easy') {
        const g = fsrs.nextState(prevS, prevSs, prevD, t, 'good');
        goodDays = fsrs.intervalForRetention(g.sLong, g.sShort, g.d, desiredRetention);
      }
      const gradDays = easyAtLeast(goodDays, rating, Math.max(MIN_INTERVAL_DAYS, fsrsFirst, opts.graduatingDays ?? 1));
      return {
        stage: 0, phase: 'fsrs', stability: rS, stabilityShort: rSs, difficulty: rD,
        intervalDays: gradDays, enteringFsrs: false, graduated: true,
        historyStage: (state.stage + 1), R: null,
        historyStability: rS, historyStabilityShort: rSs, historyDifficulty: rD,
      };
    }
    return {
      stage: nextStage, phase: 'relearn', stability: rS, stabilityShort: rSs, difficulty: rD,
      intervalDays: days, enteringFsrs: false, graduated: false,
      historyStage: state.stage + 1, R: null,
      historyStability: rS, historyStabilityShort: rSs, historyDifficulty: rD,
    };
  }

  // ===== 全量 FSRS-7 =====
  const first = !state.lastReviewed || !(state.stability && state.stability > 0);

  let sLong: number;
  let sShort: number;
  let d: number;
  let r: number | null = null;
  let intervalDays: number;

  if (first) {
    const init = fsrs.initState(rating);
    sLong = init.sLong;
    sShort = init.sShort;
    d = init.d;
    intervalDays = fsrs.intervalForRetention(sLong, sShort, d, desiredRetention);
  } else {
    sLong = Math.max(S_MIN, state.stability!);
    sShort = Math.max(S_MIN, state.stabilityShort && state.stabilityShort > 0 ? state.stabilityShort : 0.8 * sLong);
    d = state.difficulty && state.difficulty > 0 ? state.difficulty : fsrs.initD('good');
    const last = state.lastReviewed || state.reviewStart;
    let t = last ? (now.getTime() - new Date(last).getTime()) / 86400000 : 0;
    if (!(t > 0)) t = 0;
    const next = fsrs.nextState(sLong, sShort, d, t, rating);
    sLong = next.sLong;
    sShort = next.sShort;
    d = next.d;
    r = next.r;
    intervalDays = fsrs.intervalForRetention(sLong, sShort, d, desiredRetention);
    // Anki：FSRS 阶段点"忘了" → 进重新学习步骤（当天重学后再回 FSRS）
    if (rating === 'again' && opts.relearnStepsMins && opts.relearnStepsMins.length && opts.sameDay !== false) {
      const rS1 = Math.round(sLong * 100) / 100;
      const rSs1 = Math.round(sShort * 100) / 100;
      const rD1 = Math.round(d * 100) / 100;
      return {
        stage: 0, phase: 'relearn', stability: rS1, stabilityShort: rSs1, difficulty: rD1,
        intervalDays: opts.relearnStepsMins[0] / 1440, enteringFsrs: false, graduated: false,
        historyStage: state.stage + 1, R: r,
        historyStability: rS1, historyStabilityShort: rSs1, historyDifficulty: rD1,
      };
    }
  }

  const rS = Math.round(sLong * 100) / 100;
  const rSs = Math.round(sShort * 100) / 100;
  const rD = Math.round(d * 100) / 100;
  return {
    stage: 0,
    phase: 'fsrs',
    stability: rS,
    stabilityShort: rSs,
    difficulty: rD,
    intervalDays,
    enteringFsrs: first,
    graduated: false,
    historyStage: first ? 1 : (state.stage + 1),
    R: r,
    historyStability: rS,
    historyStabilityShort: rSs,
    historyDifficulty: rD,
  };
}

/**
 * 当前记忆保留度 R：三元组齐全 + lastReviewed 守卫。
 * stabilityShort 缺失时按 0.8·S_long 回退（老数据/单 stability 数据）。
 */
export function currentR(
  item: Pick<ScheduleState, 'phase' | 'stability' | 'stabilityShort' | 'difficulty' | 'lastReviewed'>,
  w: number[],
  now: number | Date = Date.now()
): number | null {
  // 学习步骤期的 stability=1 只是占位初值，不是真实三元组，不算 R。
  if (item.phase === 'ladder' || !item.stability || !item.lastReviewed) return null;
  const sLong = item.stability;
  const sShort = item.stabilityShort && item.stabilityShort > 0 ? item.stabilityShort : 0.8 * sLong;
  const d = item.difficulty && item.difficulty > 0 ? item.difficulty : 5;
  const t = (new Date(now).getTime() - new Date(item.lastReviewed).getTime()) / 86400000;
  if (!(t > 0)) return null;
  return new FSRS(w).R(t, sLong, sShort, d);
}
