import { describe, expect, it } from 'vitest';
import { applyRoundLimits, dueLaterTodayCount, dueTimeLabel, isNewItem, isOnVacation } from '../src/review/queue';

const mk = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  filePath: `${id}.md`,
  name: id,
  stage: 1,
  phase: 'ladder' as const,
  stability: 1,
  difficulty: 0.3,
  reviewHistory: [],
  reviewStart: '2026-11-01T00:00:00.000Z',
  totalReviews: 3,
  lastReviewed: '2026-11-10T00:00:00.000Z',
  ...extra,
});

describe('新条目判定', () => {
  it('一次都没复习过才算新卡（老数据没有 totalReviews 时看 lastReviewed）', () => {
    expect(isNewItem(mk('a', { totalReviews: 0, lastReviewed: undefined }) as any)).toBe(true);
    expect(isNewItem(mk('b') as any)).toBe(false);
    expect(isNewItem(mk('c', { totalReviews: 0 }) as any)).toBe(false);
  });
});

describe('本轮分额度截断', () => {
  const items = [
    mk('due1', { stage: 4 }),
    mk('due2', { stage: 5 }),
    mk('new1', { totalReviews: 0, lastReviewed: undefined }),
    mk('new2', { totalReviews: 0, lastReviewed: undefined }),
  ] as any[];

  it('到期与新卡各算各的额度', () => {
    const picked = applyRoundLimits(items, { newLimit: 1, reviewLimit: 1 });
    expect(picked.map((i) => i.id)).toEqual(['due1', 'new1']);
  });

  it('额度为 0 / 不填 = 不限，不能理解成「一个都不给」', () => {
    expect(applyRoundLimits(items, { newLimit: 0, reviewLimit: 0 })).toHaveLength(4);
    expect(applyRoundLimits(items)).toHaveLength(4);
  });

  it('可以先上新卡（趁精神好），默认先清到期', () => {
    expect(applyRoundLimits(items, { newLimit: 1, reviewLimit: 1, order: 'new-first' }).map((i) => i.id)).toEqual([
      'new1',
      'due1',
    ]);
  });

  it('截断只影响本轮，不动原数组', () => {
    const copy = items.slice();
    applyRoundLimits(items, { newLimit: 1 });
    expect(items).toEqual(copy);
  });
});

describe('休假', () => {
  const now = new Date('2026-11-15T10:00:00.000Z');

  it('填了未来的日期就算休假中', () => {
    expect(isOnVacation('2026-11-20T00:00:00.000Z', now)).toBe(true);
  });

  it('没填 / 填过去 / 填垃圾都不算休假（不能让脏值把复习永久停掉）', () => {
    expect(isOnVacation(undefined, now)).toBe(false);
    expect(isOnVacation('', now)).toBe(false);
    expect(isOnVacation('2026-11-01T00:00:00.000Z', now)).toBe(false);
    expect(isOnVacation('随便写的', now)).toBe(false);
  });
});

describe('今天稍后到点', () => {
  const now = new Date(2026, 10, 15, 10, 0, 0);

  it('当天内的 1m / 30m 步给出具体的 HH:MM', () => {
    const at = new Date(2026, 10, 15, 10, 30, 0).toISOString();
    expect(dueTimeLabel({ nextReviewDate: at } as any, now)).toBe('10:30');
  });

  it('已经到点、或不在今天，都不给时刻', () => {
    expect(dueTimeLabel({ nextReviewDate: new Date(2026, 10, 15, 9, 0).toISOString() } as any, now)).toBeNull();
    expect(dueTimeLabel({ nextReviewDate: new Date(2026, 10, 16, 9, 0).toISOString() } as any, now)).toBeNull();
    expect(dueTimeLabel({} as any, now)).toBeNull();
  });

  it('数得出今天还剩几条稍后到点（已完成的不算）', () => {
    const later = new Date(2026, 10, 15, 11, 0).toISOString();
    const items = [
      { id: 'a', nextReviewDate: later, totalReviews: 2 },
      { id: 'b', nextReviewDate: later, totalReviews: 2, completed: true },
      { id: 'c', nextReviewDate: later, totalReviews: 2, isMissing: true },
    ] as any[];
    expect(dueLaterTodayCount(items, now)).toBe(1);
  });
});
