/**
 * FSRS-7 参数拟合器（34 维联合优化，复刻官方 srs-benchmark 训练口径）。
 *
 * 与 v4 拟合器的差别：
 * - 权重 19→34；状态从 (S,D) 升为 (S_long,S_short,D)；
 * - 回放时四档评级都记 pass（log R），again 记 log(1−R)——官方把 hard 当 pass；
 * - 逐维 box 约束取官方 clip 界，再施加单调约束（w1≤w2≤w3、w25≤w26）；
 * - L2 prior 用官方 sigma，防参数跑飞；
 * - 官方 FSRS-7 全参数联合优化（不再分"基础八参/全参"档），但保留样本门槛与分档门槛：
 *   <100 跳过；100–299 只动初始稳定性/难度前 8 维（低样本保守）；≥300 全 34 维。
 *
 * 护栏不变：迭代上限 + 停滞早停 + 墙钟时限（默认 800ms）+ 分片让出主线程。
 */

import { DEFAULT_W, FSRS, type Rating } from './fsrs';

const RATING_NAMES: Rating[] = ['again', 'hard', 'good', 'easy'];
const RATING_INDEX: Record<string, number> = { again: 0, hard: 1, good: 2, easy: 3 };

/** 官方 34 参数逐维 clip 界（srs-benchmark/models/fsrs_v7.py 的 _CLIP_LO/_CLIP_HI）。 */
const CLIP_LO = [0.0001, 0.0001, 0.0001, 0.0001, 1.0, 0.001, 0.1, 0.0, 0.0, 0.3, 0.01, 0.1, 0.0, 0.0, 1.0, 0.0, 0.0, 0.5, 0.001, 0.001, 0.0, 0.0, 1.0, 0.01, 0.01, 0.2, 0.5, 0.01, 0.1, 0.0, 0.1, 0.0, 0.0, 0.0];
const CLIP_HI = [50.0, 100.0, 100.0, 100.0, 10.0, 4.0, 4.0, 4.0, 1.2, 3.0, 1.5, 1.0, 3.5, 1.0, 7.0, 4.0, 2.0, 6.0, 1.5, 1.0, 5.0, 1.0, 7.0, 0.25, 0.95, 0.85, 0.99, 1.0, 1.0, 0.9, 1.1, 1.0, 0.6, 0.6];

/** 官方 L2 prior sigma（34 维；前 4 维自由=用极大 sigma 近似无正则）。 */
const L2_SIGMA = [9999, 9999, 9999, 9999, 0.523, 0.2528, 0.4329, 0.2966, 0.2139, 0.2889, 0.1862, 0.175, 0.3812, 0.3013, 0.9104, 0.3234, 0.2448, 0.3273, 0.1842, 0.1735, 0.4608, 0.311, 0.864, 0.0418, 0.2596, 0.0798, 0.0682, 0.1282, 0.1397, 0.1407, 0.1489, 0.2, 0.15, 0.15];
const L2_WEIGHT = 0.3333;

/** 逐维约束 + 单调约束（复刻官方 clipper）。 */
export function clipWToBounds(w: number[]): number[] {
  const out = w.map((x, i) => {
    if (!Number.isFinite(x)) return DEFAULT_W[i];
    const lo = CLIP_LO[i] ?? 0;
    const hi = CLIP_HI[i] ?? Infinity;
    return Math.max(lo, Math.min(hi, x));
  });
  if (out.length > 3) {
    out[1] = Math.max(out[1], out[0]);
    out[2] = Math.max(out[2], out[1]);
    out[3] = Math.max(out[3], out[2]);
  }
  if (out.length > 26) out[26] = Math.max(out[26], out[25]);
  return out;
}

/** 回放序列：单条目 FSRS 相位的复习观察。 */
export interface ReplaySeries {
  initRating: number;
  pairs: Array<{ t: number; rating: number }>;
}

export function buildReplaySeries(
  history: Array<{ timestamp: string; stage?: number; rating: string; stability?: number }>
): ReplaySeries | null {
  const entries = history.filter((h) => h.stability !== undefined);
  if (entries.length < 2) return null;
  const initRating = RATING_INDEX[entries[0].rating];
  if (initRating === undefined) return null;
  const pairs: Array<{ t: number; rating: number }> = [];
  for (let i = 1; i < entries.length; i++) {
    const t = (new Date(entries[i].timestamp).getTime() - new Date(entries[i - 1].timestamp).getTime()) / 86400000;
    if (!(t > 0)) continue;
    const rating = RATING_INDEX[entries[i].rating];
    if (rating === undefined) continue;
    pairs.push({ t, rating });
  }
  return pairs.length ? { initRating, pairs } : null;
}

export function buildReplaySeriesFromItems(
  items: Array<{ reviewHistory?: Array<{ timestamp: string; stage?: number; rating: string; stability?: number }> }>
): ReplaySeries[] {
  const out: ReplaySeries[] = [];
  for (const it of items) {
    const s = buildReplaySeries(it.reviewHistory || []);
    if (s) out.push(s);
  }
  return out;
}

/** 回放对数似然（含 L2 prior）：四档 pass 记 log R，again 记 log(1−R)。 */
export function replayLogLikelihood(w: number[], series: ReplaySeries[]): number {
  const fsrs = new FSRS(w);
  let sum = 0;
  for (const s of series) {
    const init = fsrs.initState(RATING_NAMES[s.initRating] ?? 'good');
    let sLong = init.sLong;
    let sShort = init.sShort;
    let d = init.d;
    for (const p of s.pairs) {
      const r = fsrs.R(p.t, sLong, sShort, d);
      const remember = p.rating >= 1;
      const prob = remember ? r : 1 - r;
      sum += Math.log(Math.max(1e-9, Math.min(1 - 1e-9, prob)));
      const next = fsrs.nextState(sLong, sShort, d, p.t, RATING_NAMES[p.rating] ?? 'good');
      sLong = next.sLong;
      sShort = next.sShort;
      d = next.d;
    }
  }
  // L2 prior：偏离默认参数的惩罚（官方训练目标的一部分）
  for (let i = 0; i < Math.min(w.length, L2_SIGMA.length); i++) {
    const sig = L2_SIGMA[i];
    if (sig < 1000) sum -= L2_WEIGHT * Math.pow((w[i] - DEFAULT_W[i]) / sig, 2);
  }
  return sum;
}

/** 数值梯度（中心差分，对前 fitLen 维）。 */
export function numericGradient(w: number[], series: ReplaySeries[], fitLen = 8, eps = 1e-5): number[] {
  const grad: number[] = Array.from({ length: w.length }, () => 0);
  const wp = [...w];
  const wm = [...w];
  for (let i = 0; i < Math.min(fitLen, w.length); i++) {
    wp[i] = w[i] + eps;
    wm[i] = w[i] - eps;
    grad[i] = (replayLogLikelihood(wp, series) - replayLogLikelihood(wm, series)) / (2 * eps);
    wp[i] = w[i];
    wm[i] = w[i];
  }
  return grad;
}

export interface FitResult {
  w: number[];
  logLikelihood: number;
  iterations: number;
  full: boolean;
}

/** 单个让出分片的目标耗时（ms）。 */
const FIT_SLICE_MS = 50;

export async function fitFSRSParams(
  series: ReplaySeries[],
  opts: {
    initW?: number[];
    iterations?: number;
    lr?: number;
    full?: boolean;
    maxMs?: number;
    stallRounds?: number;
  } = {}
): Promise<FitResult> {
  const initW = opts.initW ? [...opts.initW] : [...DEFAULT_W];
  const iterations = Math.max(1, opts.iterations ?? (opts.full ? 120 : 80));
  const lr = opts.lr ?? 0.05;
  const full = opts.full ?? false;
  const maxMs = Math.max(0, opts.maxMs ?? 800);
  const stallRounds = Math.max(1, opts.stallRounds ?? 10);

  const fitLen = full ? Math.min(34, initW.length) : Math.min(8, initW.length);
  let w = clipWToBounds(initW);

  const m = Array.from({ length: w.length }, () => 0);
  const v = Array.from({ length: w.length }, () => 0);
  const beta1 = 0.9;
  const beta2 = 0.999;
  const eps = 1e-8;

  const t0 = Date.now();
  let sliceStart = t0;
  let lastLL = replayLogLikelihood(w, series);
  let bestW = [...w];
  let bestLL = lastLL;
  let stall = 0;
  let done = 0;

  for (let it = 1; it <= iterations; it++) {
    done = it;
    const lrIt = lr * (1 - 0.75 * (it / iterations));
    const grad = numericGradient(w, series, fitLen);
    for (let i = 0; i < fitLen; i++) {
      m[i] = beta1 * m[i] + (1 - beta1) * grad[i];
      v[i] = beta2 * v[i] + (1 - beta2) * grad[i] * grad[i];
      const mHat = m[i] / (1 - Math.pow(beta1, it));
      const vHat = v[i] / (1 - Math.pow(beta2, it));
      w[i] += lrIt * mHat / (Math.sqrt(vHat) + eps);
    }
    w = clipWToBounds(w);

    const ll = replayLogLikelihood(w, series);
    if (ll > bestLL) {
      bestLL = ll;
      bestW = [...w];
    }
    if (Math.abs(ll - lastLL) < 1e-6) {
      stall++;
      if (stall >= stallRounds) break;
    } else stall = 0;
    lastLL = ll;
    if (maxMs > 0 && Date.now() - t0 > maxMs) break;
    if (Date.now() - sliceStart >= FIT_SLICE_MS) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      sliceStart = Date.now();
    }
  }

  return { w: clipWToBounds(bestW), logLikelihood: bestLL, iterations: done, full };
}

/** 拟合入口：构造回放序列 → 判门槛 → 分档拟合。 */
export async function fitFromItems(
  items: Array<{ reviewHistory?: Array<{ timestamp: string; stage?: number; rating: string; stability?: number }> }>,
  opts?: { full?: boolean }
): Promise<{ fit: FitResult; count: number } | null> {
  const series = buildReplaySeriesFromItems(items);
  const count = series.reduce((n, s) => n + s.pairs.length, 0);
  if (count < 100) return null;
  const full = opts?.full ?? count >= 300;
  return { fit: await fitFSRSParams(series, { full }), count };
}

/** 拟合权重合并为完整 34 维。 */
export function mergeFittedW(fitted: number[]): number[] {
  const out = [...DEFAULT_W];
  for (let i = 0; i < Math.min(34, fitted.length); i++) out[i] = fitted[i];
  return clipWToBounds(out);
}
