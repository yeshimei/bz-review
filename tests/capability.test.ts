/**
 * 能力位：产品决策 2026-11-18 —— 基础版与高级版功能完全一致，只限数量。
 *
 * 能力位保留为登记清单（供界面文案与测试引用），但门控恒放行：
 * 现在四个能力免费可用，未来新增的能力同样不对基础版关闭。
 * 唯一差异是复习笔记 + 划线卡合计 50 条的数量上限。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  FREE_ITEM_LIMIT,
  canAdd,
  canUseCapability,
  capabilityBlock,
  licenseSummary,
  setLicenseState,
  type ProCapability,
} from '../src/data/entitlement';

const CAPS: ProCapability[] = ['speech', 'sourceLink', 'bookReport', 'cardManager'];

beforeEach(() => {
  setLicenseState({ paid: false, checkedAt: 0 });
});

describe('能力位 · 全部放开', () => {
  it('免费档四个能力全部可用', () => {
    for (const cap of CAPS) {
      expect(canUseCapability(cap), `${cap} 不该被锁`).toBe(true);
    }
  });

  it('激活后同样可用，不改变口径', () => {
    setLicenseState({ paid: true, checkedAt: Date.now(), name: '测试用户' });
    for (const cap of CAPS) {
      expect(canUseCapability(cap), `${cap} 激活后该可用`).toBe(true);
    }
  });

  it('未来新增的能力名也放行——架构上不再有功能差异', () => {
    expect(canUseCapability('futureFeature' as ProCapability)).toBe(true);
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

describe('能力位 · 不再有拦截文案', () => {
  it('任何能力都不拦截，也不给多余提示', () => {
    for (const cap of CAPS) {
      expect(capabilityBlock(cap)).toEqual({ ok: true, message: '' });
    }
  });
});
