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
const MAX_INTERVAL = 36500; // 100 年，与官方 interval solver 上界一致

const RATING_INDEX: Record<Rating, number> = { again: 0, hard: 1, good: 2, easy: 3 };
const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));

/** 保留：最短间隔 1 分钟（评级 toast 与钳位下界的口径，虽无阶梯仍沿用）。 */
export const MIN_INTERVAL_DAYS = 1 / 1440;

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
    const sLong = Math.max(S_MIN, this.w[idx] ?? DEFAULT_W[idx]);
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
    if (g === 1) return Math.max(S_MIN, postLapse);
    const sinc = Math.exp(this.w[a] - 1.5) * (11 - d) * Math.pow(s, -this.w[a + 1]) *
      (Math.exp((1 - r) * this.w[a + 2]) - 1) * hard * easy + 1;
    return Math.max(S_MIN, Math.max(postLapse, s * sinc));
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
    for (let i = 0; i < 60; i++) {
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

// ==================== 调度纯函数 ====================

export interface ScheduleState {
  stage: number;
  phase: 'ladder' | 'fsrs';
  stability?: number | null;      // S_long
  stabilityShort?: number | null; // S_short
  difficulty?: number | null;
  lastReviewed?: string | null;
  reviewStart?: string;
}

export interface ScheduleDecision {
  stage: number;
  phase: 'fsrs';
  stability: number | null;       // S_long（写回）
  stabilityShort: number | null;  // S_short（写回）
  difficulty: number | null;
  intervalDays: number;
  enteringFsrs: boolean;          // 首次评级（初始化三元组）
  historyStage: number;
  R: number | null;
  historyStability: number | null;
  historyStabilityShort: number | null;
  historyDifficulty: number | null;
}

/**
 * 调度纯函数：全量 FSRS-7，无阶梯。
 * - 首次评级（没有 lastReviewed / totalReviews===0，由调用方保证）→ 初始化三元组；
 * - 之后每轮 → 算 R、更新三元组、按 DR 二分求间隔。
 * 目标留存率由调用方从设置传入（默认 0.9）。
 */
export function scheduleNext(
  state: ScheduleState,
  rating: Rating,
  now: Date,
  w: number[] = DEFAULT_W,
  desiredRetention = DEFAULT_DESIRED_RETENTION
): ScheduleDecision {
  const fsrs = new FSRS(w);
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
  if (!item.stability || !item.lastReviewed) return null;
  const sLong = item.stability;
  const sShort = item.stabilityShort && item.stabilityShort > 0 ? item.stabilityShort : 0.8 * sLong;
  const d = item.difficulty && item.difficulty > 0 ? item.difficulty : 5;
  const t = (new Date(now).getTime() - new Date(item.lastReviewed).getTime()) / 86400000;
  if (!(t > 0)) return null;
  return new FSRS(w).R(t, sLong, sShort, d);
}
