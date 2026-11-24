/**
 * 能力位：产品决策 2026-11-18 —— 基础版与高级版功能完全一致，只限数量。
 *
 * 能力清单只作登记与界面文案；恒真的门控函数已删，入口直接打开。
 * 唯一差异是复习笔记 + 划线卡合计 50 条的数量上限。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CAPABILITY_LABELS,
  FREE_ITEM_LIMIT,
  PRO_CAPABILITIES,
  canAdd,
  licenseSummary,
  setLicenseState,
} from '../src/data/entitlement';

beforeEach(() => {
  setLicenseState({ paid: false, checkedAt: 0 });
});

describe('能力位 · 只作登记，门控已移除', () => {
  it('四项能力都有登记与界面文案', () => {
    expect(PRO_CAPABILITIES).toEqual(['speech', 'sourceLink', 'bookReport', 'cardManager']);
    for (const cap of PRO_CAPABILITIES) {
      expect(CAPABILITY_LABELS[cap]).toBeTruthy();
    }
  });

  it('数量限制不受能力位影响，仍是合计 50 条', () => {
    expect(canAdd({ notes: 0, cards: 0 })).toBe(true);
    expect(canAdd({ notes: FREE_ITEM_LIMIT, cards: 0 })).toBe(false);
    expect(canAdd({ notes: 5, cards: 45 })).toBe(false);
  });

  it('授权状态文案只谈数量，不再说功能未解锁', () => {
    const free = licenseSummary();
    expect(free).not.toContain('未解锁');
    expect(free).toContain('50 条');
  });
});
