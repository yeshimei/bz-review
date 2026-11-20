/**
 * 加厚层统计口径测试（stats-rich）
 *
 * 全部用本地时间构造函数造时间（new Date(y, m, d, h)），不写 UTC 字符串——
 * 日期键走 localDayKey，换成 UTC 会在非 UTC 机器上把「今天」算错一天。
 */

import { describe, expect, it } from 'vitest';
import { computeRichStats } from '../src/review/stats-rich';
import { maturityLevel, stageNum, MATURITY_LABELS } from '../src/review/render';
import type { ReviewItem } from '../src/review/data';

const at = (day: number, hour = 9): string => new Date(2026, 10, day, hour, 0, 0).toISOString();
const NOW = new Date(2026, 10, 20, 12, 0, 0).getTime();

function item(over: Partial<ReviewItem> & { history?: Array<{ t: string; rating?: string; stage?: number }> }): ReviewItem {
  const { history, ...rest } = over;
  return {
    id: rest.id || 'i1',
    filePath: rest.filePath || 'a.md',
    name: rest.name || '条目',
    reviewStart: at(1),
    stage: 0,
    phase: 'ladder',
    stability: 1,
    difficulty: 0.3,
    reviewHistory: (history || []).map((h) => ({
      timestamp: h.t,
      rating: h.rating || 'good',
      stage: h.stage ?? 0,
    })),
    totalReviews: 0,
    averageConfidence: 0,
    nextReviewDate: null,
    lastReviewed: null,
    lastDifficulty: null,
    completed: false,
    ...rest,
  } as ReviewItem;
}

describe('computeRichStats · 量', () => {
  it('条次与天数分开数，空库不产生 NaN', () => {
    const s = computeRichStats([], { now: NOW });
    expect(s.reviews).toBe(0);
    expect(s.days).toBe(0);
    expect(s.perActiveDay).toBe(0);
    expect(s.passRate).toBe(0);
    expect(s.avgR).toBeNull();
    expect(s.sMedian).toBeNull();
    expect(s.avgInterval).toBeNull();
    expect(s.heat.length).toBe(365);
  });

  it('一天评三次算 3 条次、1 天', () => {
    const s = computeRichStats([item({
      history: [{ t: at(20, 8) }, { t: at(20, 9) }, { t: at(20, 10) }],
    })], { now: NOW });
    expect(s.reviews).toBe(3);
    expect(s.days).toBe(1);
    expect(s.today).toBe(3);
    expect(s.perActiveDay).toBe(3);
  });
});

describe('computeRichStats · 连续性', () => {
  it('今天没复习也从昨天起算（宽松口径）', () => {
    const s = computeRichStats([item({ history: [{ t: at(18) }, { t: at(19) }] })], { now: NOW });
    expect(s.streak).toBe(2);
  });

  it('断一天就停，最长断更按空整天算', () => {
    const s = computeRichStats([item({
      history: [{ t: at(1) }, { t: at(2) }, { t: at(3) }, { t: at(10) }, { t: at(11) }],
    })], { now: NOW });
    expect(s.streak).toBe(0); // 11 号之后一直没复习
    expect(s.bestStreak).toBe(3);
    expect(s.gap).toBe(6); // 3 号到 10 号之间空了 6 天
  });
});

describe('computeRichStats · 节律与质量', () => {
  it('小时 / 星期 / 月份落桶正确', () => {
    const s = computeRichStats([item({
      history: [{ t: at(20, 21) }, { t: at(20, 22) }, { t: at(16, 8) }],
    })], { now: NOW });
    expect(s.hours[21]).toBe(1);
    expect(s.hours[22]).toBe(1);
    expect(s.hours[8]).toBe(1);
    expect(s.months[10]).toBe(3); // 11 月
    // 2026-11-20 是周五（周一起算 = 4）
    expect(s.weekdays[4]).toBe(2);
    expect(s.weekdays[0]).toBe(1);
  });

  it('一次通过率 = good + easy 占比', () => {
    const s = computeRichStats([item({
      history: [
        { t: at(19), rating: 'good' },
        { t: at(19), rating: 'easy' },
        { t: at(19), rating: 'again' },
        { t: at(19), rating: 'hard' },
      ],
    })], { now: NOW });
    expect(s.passRate).toBeCloseTo(0.5, 6);
    expect(s.rating.again).toBe(1);
  });

  it('按复习次数分档统计遗忘率（FSRS-7 无阶梯，5 档成熟度）', () => {
    const s = computeRichStats([item({
      history: [
        { t: at(19), stage: 0, rating: 'again' }, // 第 1 次 → Lv.1 档
        { t: at(19), stage: 0, rating: 'good' },  // 第 2 次 → Lv.2 档
        { t: at(19), stage: 0, rating: 'again' }, // 第 3 次 → Lv.2 档
        { t: at(19), stage: 0, rating: 'good' },  // 第 4 次 → Lv.3 档
      ],
    })], { now: NOW });
    expect(s.stageAgain).toHaveLength(5);
    const l1 = s.stageAgain.find((x) => x.label === '新卡 0-1次');
    expect(l1).toMatchObject({ n: 1, again: 1 });
    const l2 = s.stageAgain.find((x) => x.label === '2-3次');
    expect(l2).toMatchObject({ n: 2, again: 1 });
    const l3 = s.stageAgain.find((x) => x.label === '4-7次');
    expect(l3).toMatchObject({ n: 1, again: 0 });
  });
});

describe('computeRichStats · 负载', () => {
  it('未来 30 天只算未完成未挂起，逾期按天数分档', () => {
    const s = computeRichStats([
      item({ id: 'a', nextReviewDate: at(20, 18) }),
      item({ id: 'b', nextReviewDate: at(22, 9) }),
      item({ id: 'c', nextReviewDate: at(18, 9) }), // 逾期 2 天
      item({ id: 'd', nextReviewDate: at(5, 9) }), // 逾期 15 天
      item({ id: 'e', nextReviewDate: at(21, 9), suspended: true }),
      item({ id: 'f', nextReviewDate: at(21, 9), completed: true }),
    ], { now: NOW });
    expect(s.load[0]).toBe(1);
    expect(s.load[2]).toBe(1);
    expect(s.load[1]).toBe(0);
    // 今天到期的（a）也要进逾期分档的「今天到期」，旧实现这档恒为 0
    expect(s.overdue.find((o) => o.label === '今天到期')?.n).toBe(1);
    expect(s.overdue.find((o) => o.label === '逾期 1-3 天')?.n).toBe(1);
    expect(s.overdue.find((o) => o.label === '逾期 8 天以上')?.n).toBe(1);
    expect(s.suspended).toBe(1);
  });
});

describe('computeRichStats · 记忆与间隔', () => {
  it('S 中位数与强弱排序', () => {
    const s = computeRichStats([
      item({ id: 'a', name: 'A', stability: 10 }),
      item({ id: 'b', name: 'B', stability: 30 }),
      item({ id: 'c', name: 'C', stability: 20 }),
    ], { now: NOW });
    expect(s.sMedian).toBe(20);
    expect(s.strongest.map((x) => x.name)).toEqual(['B', 'C', 'A']);
    expect(s.weakest.map((x) => x.name)).toEqual(['A', 'C', 'B']);
  });

  it('平均间隔 = 首末跨度 / (次数-1)，只算复习过 ≥2 次的', () => {
    const s = computeRichStats([
      item({ id: 'a', history: [{ t: at(1) }, { t: at(11) }] }), // 10 天 / 1
      item({ id: 'b', history: [{ t: at(1) }, { t: at(6) }, { t: at(16) }] }), // 15 天 / 2
      item({ id: 'c', history: [{ t: at(1) }] }),
    ], { now: NOW });
    // 每条自己算平均间隔再取均值：(10/1 + 15/2) / 2 = 8.75
    expect(s.avgInterval).toBeCloseTo(8.75, 6);
  });
});

describe('computeRichStats · 成就', () => {
  it('徽章按当前值判达成，未达成给进度', () => {
    const s = computeRichStats([item({
      history: Array.from({ length: 7 }, (_, i) => ({ t: at(14 + i) })),
    })], { now: NOW });
    const b = s.badges.find((x) => x.id === 'reviews100');
    expect(b).toMatchObject({ got: false, cur: 7, goal: 100 });
    expect(s.badges.find((x) => x.id === 'streak7')?.got).toBe(true);
    expect(s.badges.find((x) => x.id === 'streak100')?.got).toBe(false);
  });

  it('通过率徽章样本不够时不算达成', () => {
    const s = computeRichStats([item({ history: [{ t: at(19), rating: 'easy' }] })], { now: NOW });
    expect(s.badges.find((x) => x.id === 'pass80')?.got).toBe(false);
  });

  it('记忆常青徽章：S ≥ 100 天的条目满 5 条才解锁', () => {
    const s0 = computeRichStats([item({ id: 'a', stability: 99 })], { now: NOW });
    expect(s0.badges.find((x) => x.id === 's100')).toMatchObject({ got: false, cur: 0, goal: 5 });
    const s1 = computeRichStats(
      Array.from({ length: 5 }, (_, i) => item({ id: `a${i}`, stability: 100 + i })),
      { now: NOW },
    );
    expect(s1.badges.find((x) => x.id === 's100')?.got).toBe(true);
    expect(s1.badges.length).toBe(13);
  });
});

describe('成熟度档位单源（FSRS-7 无阶梯）', () => {
  it('5 档边界与标签一一对应', () => {
    expect(MATURITY_LABELS).toHaveLength(5);
    expect(maturityLevel(0)).toBe(1);
    expect(maturityLevel(1)).toBe(1);
    expect(maturityLevel(2)).toBe(2);
    expect(maturityLevel(3)).toBe(2);
    expect(maturityLevel(4)).toBe(3);
    expect(maturityLevel(7)).toBe(3);
    expect(maturityLevel(8)).toBe(4);
    expect(maturityLevel(15)).toBe(4);
    expect(maturityLevel(16)).toBe(5);
  });

  it('历史弹窗阶段文案走单源：stage=0 的新卡显示 FSRS Lv.1，不再是负数', () => {
    const fresh = item({ stage: 0, totalReviews: 0 });
    expect(stageNum(fresh)).toBe('FSRS Lv.1');
    const old = item({ stage: 0, totalReviews: 20 });
    expect(stageNum(old)).toBe('FSRS Lv.5');
  });
});
