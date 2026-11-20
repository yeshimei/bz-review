/**
 * FSRS-7 首次复习间隔 —— 直接调用插件真实代码
 * 运行：node --experimental-strip-types scripts/fsrs7-first-interval.ts
 */
import {
  FSRS, DEFAULT_W, DEFAULT_DESIRED_RETENTION,
  clampIntervalDays, formatInterval, scheduleNext, type Rating,
} from '../src/review/fsrs.ts';

const fsrs = new FSRS(DEFAULT_W);
const ratings: Rating[] = ['again', 'hard', 'good', 'easy'];
const gradeNum: Record<Rating, number> = { again: 1, hard: 2, good: 3, easy: 4 };

console.log('| 首次评级 | G | 初始S_long(天) | 初始S_short(天) | 初始D | 理论间隔(天) | 实际间隔(clamp后) | 提示文案 |');
console.log('|---|---:|---:|---:|---:|---:|---:|---|');
for (const rating of ratings) {
  const g = gradeNum[rating];
  const init = fsrs.initState(rating);
  const raw = fsrs.intervalForRetention(init.sLong, init.sShort, init.d, DEFAULT_DESIRED_RETENTION);
  // 插件评级落盘前实际走钳位：最短 1 分钟，scale=1，最长不限（设置默认）
  const clamped = clampIntervalDays(raw, 1, 0);
  // 交叉验证：scheduleNext 首次分支应给出同样的 intervalDays
  const decision = scheduleNext(
    { stage: 0, phase: 'fsrs', stability: 1, stabilityShort: 0.8, difficulty: 0.3, lastReviewed: null, reviewStart: '2026-01-01T00:00:00Z' },
    rating, new Date('2026-01-01T00:00:00Z'), DEFAULT_W, DEFAULT_DESIRED_RETENTION
  );
  if (Math.abs(decision.intervalDays - raw) > 1e-6) throw new Error('scheduleNext 与直接求解不一致: ' + rating);
  console.log(
    `| ${rating} | ${g} | ${init.sLong.toFixed(4)} | ${init.sShort.toFixed(4)} | ${init.d.toFixed(2)} | ` +
    `${raw.toFixed(4)} | ${clamped.toFixed(4)} (${(clamped * 24).toFixed(2)}h) | ${formatInterval(clamped)} |`
  );
}

// 参数溯源：把用到的 34 个默认参数逐项列出，方便外部核验
console.log('\nDEFAULT_W (34):', JSON.stringify(DEFAULT_W));
console.log('DEFAULT_DESIRED_RETENTION:', DEFAULT_DESIRED_RETENTION);
