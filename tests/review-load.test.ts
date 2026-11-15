/**
 * 复习量对比（review/stats.ts 的 fixedCountFor / compareReviewLoad）
 *
 * 这两个数是给用户看的「省了多少」，所以口径必须钉死：
 *   · 实际次数按**复习日**去重（同一天点两次不算多复习一次）
 *   · 固定次数按每条自己的时间跨度算，不按全局天数
 *   · 只复习过一天、或一天之内点完的条目不计入
 */
import { describe, expect, it } from 'vitest';
import { FIXED_INTERVALS, compareReviewLoad, fixedCountFor } from '../src/review/stats';

/** 造一条只有复习历史的条目（其余字段不参与计算） */
function item(days: string[]): any {
  return { reviewHistory: days.map((d) => ({ timestamp: `${d}T10:00:00` })) };
}

describe('fixedCountFor：固定间隔要复习几次', () => {
  it('间隔表本身是 1/2/4/7/15/30/60/120', () => {
    expect(FIXED_INTERVALS).toEqual([1, 2, 4, 7, 15, 30, 60, 120]);
  });

  it('累计到覆盖跨度就停', () => {
    expect(fixedCountFor(1)).toBe(1); // 1
    expect(fixedCountFor(3)).toBe(2); // 1+2
    expect(fixedCountFor(7)).toBe(3); // 1+2+4
    expect(fixedCountFor(14)).toBe(4); // +7
    expect(fixedCountFor(29)).toBe(5); // +15
    expect(fixedCountFor(59)).toBe(6); // +30
    expect(fixedCountFor(119)).toBe(7); // +60
    expect(fixedCountFor(239)).toBe(8); // +120
  });

  it('表用完之后按 180 天一次往上加', () => {
    // 239 天用掉全部 8 次，剩下的 261 天按 180 天一次 → 2 次
    expect(fixedCountFor(500)).toBe(10);
  });

  it('跨度为 0 或负数时至少算 1 次（不会出现 0 次复习）', () => {
    expect(fixedCountFor(0)).toBe(1);
    expect(fixedCountFor(-5)).toBe(1);
  });
});

describe('compareReviewLoad：实际 vs 固定间隔', () => {
  it('没有复习历史时返回 null', () => {
    expect(compareReviewLoad([])).toBeNull();
    expect(compareReviewLoad([{ reviewHistory: [] } as any])).toBeNull();
  });

  it('只复习过一次的条目不参与（没有跨度可比）', () => {
    expect(compareReviewLoad([item(['2026-01-01'])])).toBeNull();
  });

  it('同一天点了两次也只算一天，不参与对比', () => {
    expect(compareReviewLoad([{ reviewHistory: [{ timestamp: '2026-01-01T09:00:00' }, { timestamp: '2026-01-01T21:00:00' }] } as any])).toBeNull();
  });

  it('两条各复习两天、跨度 10 天：实际 4 次，固定要 8 次', () => {
    const res = compareReviewLoad([item(['2026-01-01', '2026-01-11']), item(['2026-01-01', '2026-01-11'])]);
    expect(res).not.toBeNull();
    expect(res!.notes).toBe(2);
    expect(res!.actual).toBe(4); // 2 条 × 2 天
    expect(res!.fixed).toBe(8); // 每条跨度 10 天 → 4 次 × 2 条
    expect(res!.saved).toBe(4);
    expect(res!.percent).toBeCloseTo(0.5, 5);
  });

  it('跨度不同的条目各按各的算', () => {
    // A：跨度 3 天 → 2 次；B：跨度 30 天 → 6 次（1/2/4/7/15/30 累计 59 天才覆盖 30）
    const res = compareReviewLoad([item(['2026-01-01', '2026-01-04']), item(['2026-01-01', '2026-01-31'])]);
    expect(res!.notes).toBe(2);
    expect(res!.actual).toBe(4);
    expect(res!.fixed).toBe(8); // 2 + 6
    expect(res!.spanDays).toBe(30);
  });

  it('复习得比固定间隔还勤时，saved 是负数而不是 0', () => {
    // 一条笔记在 20 天里复习了 8 天；固定间隔 20 天只要 5 次
    const days = ['2026-01-01', '2026-01-03', '2026-01-05', '2026-01-08', '2026-01-11', '2026-01-14', '2026-01-17', '2026-01-21'];
    const res = compareReviewLoad([item(days)]);
    expect(res!.actual).toBe(8);
    expect(res!.fixed).toBe(5);
    expect(res!.saved).toBe(-3);
    expect(res!.percent).toBeLessThan(0);
  });
});
