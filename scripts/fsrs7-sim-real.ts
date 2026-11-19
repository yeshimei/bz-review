/**
 * FSRS-7 长期仿真 —— 直接调用插件真实代码 src/review/fsrs.ts
 * ================================================================
 * 与 fsrs7-sim.py（公式复刻）不同，本脚本 import 真实的 FSRS 类与 scheduleNext，
 * 跑的就是插件本身在用的排期代码。
 *
 * 虚拟学生：
 *  - 每天新增 0~5 张卡（固定种子随机，可复现）；
 *  - 卡到期时按模型真实留存概率 R(t) 决定答对(good)/答错(again)；
 *  - 用真实 scheduleNext() 更新三元组并求下次间隔（目标留存率 0.9，最长间隔不限）。
 *
 * 运行：node --experimental-strip-types scripts/fsrs7-sim-real.ts
 */
import { FSRS, DEFAULT_W, DEFAULT_DESIRED_RETENTION, scheduleNext, type Rating } from '../src/review/fsrs.ts';

function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Card {
  sLong: number; sShort: number; d: number;
  dueDay: number; lastReviewedDay: number; totalReviews: number;
}

interface Snapshot {
  cards: number;          // 累计新增卡片
  reviews: number;        // 累计复习
  correct: number;        // 累计答对
  retention: number;      // 累计实际留存率
  againPct: number;       // 累计 again 占比（实际遗忘率）
  dailyAvg: number;       // 近30天日均复习
  dailyPeak: number;      // 近30天单日峰值
  dailyNewAvg: number;    // 近30天日均新增
  avgInterval: number;    // 近30天平均间隔
  maxInterval: number;    // 近30天最大间隔
  reviewsPerCard: number; // 每张卡平均被复习次数 = 累计复习/累计新增
  medianSLong: number;    // 全库长期稳定性中位数（天）
  avgD: number;           // 全库平均难度
  maturePct: number;      // 成熟卡占比（复习≥3次）
  backlogPct: number;     // 近30天里"到期未当天处理完"的比例（本模型每天全清，恒0；留作口径）
}

const MILESTONES = [30, 182, 365, 730, 1095, 1825, 2555, 3650];

function simulate(years: number, seed: number, capDays = 0): Map<number, Snapshot> {
  const rng = makeRng(seed);
  const days = years * 365;
  const cards: Card[] = [];
  const fsrs = new FSRS(DEFAULT_W);
  const DR = DEFAULT_DESIRED_RETENTION;

  const perDayReviews = new Float64Array(days);
  const perDayCorrect = new Float64Array(days);
  const perDayNew = new Float64Array(days);
  const perDayDue = new Float64Array(days);
  const perDayInterval = new Float64Array(days);
  const perDayMaxIv = new Float64Array(days);

  const milestones = new Set(MILESTONES);
  const snapshots = new Map<number, Snapshot>();
  let cumReviews = 0, cumCorrect = 0, cumAgain = 0;

  for (let day = 0; day < days; day++) {
    const newCount = Math.floor(rng() * 6); // 0~5 张/天
    for (let k = 0; k < newCount; k++) {
      cards.push({ sLong: 0, sShort: 0, d: 0, dueDay: day, lastReviewedDay: -1, totalReviews: 0 });
    }
    perDayNew[day] = newCount;

    let dueCount = 0, dayReviews = 0, dayCorrect = 0, ivSum = 0, ivCount = 0, ivMax = 0;

    for (const c of cards) {
      if (c.dueDay > day) continue;
      dueCount++;
      let rating: Rating;
      let decision;
      if (c.totalReviews === 0) {
        const init = fsrs.initState('good');
        const pRemember = fsrs.R(1, init.sLong, init.sShort, init.d);
        rating = rng() < pRemember ? 'good' : 'again';
        decision = scheduleNext(
          { stage: 0, phase: 'fsrs', stability: 1, stabilityShort: 0.8, difficulty: 0.3, lastReviewed: null, reviewStart: new Date(day * 86400000).toISOString() },
          rating, new Date(day * 86400000), DEFAULT_W, DR
        );
      } else {
        const t = day - c.lastReviewedDay;
        const r = fsrs.R(t, c.sLong, c.sShort, c.d);
        rating = rng() < r ? 'good' : 'again';
        decision = scheduleNext(
          { stage: 0, phase: 'fsrs', stability: c.sLong, stabilityShort: c.sShort, difficulty: c.d, lastReviewed: new Date(c.lastReviewedDay * 86400000).toISOString(), reviewStart: new Date(day * 86400000).toISOString() },
          rating, new Date(day * 86400000), DEFAULT_W, DR
        );
      }
      c.sLong = decision.stability ?? c.sLong;
      c.sShort = decision.stabilityShort ?? c.sShort;
      c.d = decision.difficulty ?? c.d;
      c.lastReviewedDay = day;
      c.totalReviews++;
      let iv = decision.intervalDays;
      if (capDays > 0) iv = Math.min(iv, capDays);
      c.dueDay = day + Math.max(1, Math.round(iv));
      iv = c.dueDay - day;
      dayReviews++;
      if (rating === 'again') cumAgain++; else dayCorrect++;
      ivSum += iv; ivCount++;
      if (iv > ivMax) ivMax = iv;
    }
    cumReviews += dayReviews;
    cumCorrect += dayCorrect;
    perDayReviews[day] = dayReviews;
    perDayCorrect[day] = dayCorrect;
    perDayDue[day] = dueCount;
    perDayInterval[day] = ivCount ? ivSum / ivCount : 0;
    perDayMaxIv[day] = ivMax;

    if (milestones.has(day + 1)) {
      const end = day + 1;
      const lo = Math.max(0, end - 30);
      let avg = 0, peak = 0, ivAvg = 0, ivMaxAll = 0, ivN = 0, newAvg = 0;
      for (let i = lo; i < end; i++) {
        avg += perDayReviews[i];
        newAvg += perDayNew[i];
        if (perDayReviews[i] > peak) peak = perDayReviews[i];
        if (perDayInterval[i] > 0) { ivAvg += perDayInterval[i]; ivN++; }
        if (perDayMaxIv[i] > ivMaxAll) ivMaxAll = perDayMaxIv[i];
      }
      avg /= 30; newAvg /= 30;
      ivAvg = ivN ? ivAvg / ivN : 0;

      const sortedSLong = cards.filter((c) => c.totalReviews > 0).map((c) => c.sLong).sort((a, b) => a - b);
      const reviewed = sortedSLong.length || 1;
      const medianSLong = sortedSLong.length ? sortedSLong[Math.floor(sortedSLong.length / 2)] : 0;
      let dSum = 0, mature = 0;
      for (const c of cards) {
        if (c.totalReviews === 0) continue;
        dSum += c.d;
        if (c.totalReviews >= 3) mature++;
      }

      snapshots.set(end, {
        cards: cards.length,
        reviews: cumReviews,
        correct: cumCorrect,
        retention: cumReviews ? cumCorrect / cumReviews : 0,
        againPct: cumReviews ? cumAgain / cumReviews : 0,
        dailyAvg: avg,
        dailyPeak: peak,
        dailyNewAvg: newAvg,
        avgInterval: ivAvg,
        maxInterval: ivMaxAll,
        reviewsPerCard: cards.length ? cumReviews / cards.length : 0,
        medianSLong,
        avgD: dSum / reviewed,
        maturePct: mature / reviewed,
        backlogPct: 0,
      });
    }
  }
  return snapshots;
}

// 多 seed 取平均，让数据更稳健（固定种子保证可复现）
const SEEDS = [42, 7, 2026, 88, 1337];
const runs = SEEDS.map((s) => simulate(10, s, 0));
const avgSnapshot = (day: number): Snapshot => {
  const acc: Record<string, number> = {};
  for (const s of runs) {
    const v = s.get(day)!;
    for (const k of Object.keys(v)) acc[k] = (acc[k] || 0) + (v as unknown as Record<string, number>)[k];
  }
  const out = {} as Snapshot;
  for (const k of Object.keys(acc)) (out as unknown as Record<string, number>)[k] = acc[k] / runs.length;
  return out;
};

const labelOf = (d: number): string => d === 30 ? '1 个月' : d === 182 ? '半年' : `${d / 365} 年`;

console.log('| 时间 | 累计新增 | 日增卡 | 累计复习 | 每卡复习次数 | 实际留存率 | again率 | 日均复习 | 单日峰值 | 平均间隔 | 最大间隔 | S_long中位 | 平均难度 | 成熟卡占比 |');
console.log('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const d of MILESTONES) {
  const s = avgSnapshot(d);
  console.log(
    `| ${labelOf(d)} | ${Math.round(s.cards).toLocaleString()} | ${s.dailyNewAvg.toFixed(1)} | ${Math.round(s.reviews).toLocaleString()} | ` +
    `${s.reviewsPerCard.toFixed(1)} | ${(s.retention * 100).toFixed(2)}% | ${(s.againPct * 100).toFixed(1)}% | ${s.dailyAvg.toFixed(1)} | ` +
    `${Math.round(s.dailyPeak)} | ${s.avgInterval.toFixed(0)}天 | ${Math.round(s.maxInterval)}天 | ${s.medianSLong.toFixed(0)}天 | ` +
    `${s.avgD.toFixed(2)} | ${(s.maturePct * 100).toFixed(1)}% |`
  );
}
