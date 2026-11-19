import { describe, expect, it } from 'vitest';
import { isBzPluginEnabled } from '../src/core/plugin-path';
import { bzStatsOfItems } from '../src/data/migrate';

describe('从 bz 导入：检测与统计', () => {
  it('只有 bz 插件确实加载时才显示入口', () => {
    expect(
      isBzPluginEnabled({ plugins: { plugins: { bz: { manifest: { id: 'bz' } } } } }),
    ).toBe(true);
    expect(isBzPluginEnabled({ plugins: { plugins: {} } })).toBe(false);
    expect(isBzPluginEnabled({ plugins: { plugins: { bz: {} } } })).toBe(false);
  });

  it('简要统计：条目数 / 已到期 / 累计复习次数', () => {
    const today = new Date().toISOString().slice(0, 10);
    const items = [
      { completed: false, nextReviewDate: `${today}`, totalReviews: 3, reviewHistory: [1, 2, 3] },
      { completed: false, nextReviewDate: '2099-01-01', totalReviews: 1, reviewHistory: [1] },
      { completed: true, nextReviewDate: '2020-01-01', totalReviews: 5, reviewHistory: [1] },
    ];
    expect(bzStatsOfItems(items)).toEqual({ notes: 3, due: 1, reviews: 9 });
  });

  it('坏字段不会炸：按 0 算', () => {
    expect(bzStatsOfItems([null, {}, { totalReviews: 'x' }])).toEqual({ notes: 3, due: 0, reviews: 0 });
  });
});
