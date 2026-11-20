import { describe, expect, it, afterEach } from 'vitest';
import {
  FREE_ITEM_LIMIT,
  batchQuota,
  canAdd,
  licenseSummary,
  overLimitMessage,
  quotaBlock,
  quotaInfo,
  refreshLicense,
  currentLicenseCode,
  getLicenseState,
  remaining,
  totalOf,
} from '../src/data/entitlement';
import { HAS_KEYS, HAS_READER_KEYS, signCode, signReaderCode } from './helpers/sign';

afterEach(async () => {
  await refreshLicense('');
});

describe('基础版上限 · 笔记 + 划线合计', () => {
  it('合计上限是 20 条，不再分笔记和划线', () => {
    expect(FREE_ITEM_LIMIT).toBe(20);
    expect(totalOf({ notes: 12, cards: 8 })).toBe(20);
    expect(totalOf({ notes: 0, cards: 50 })).toBe(50);
  });

  it('单条：合计第 20 条还能加，第 21 条开始拦', () => {
    expect(canAdd({ notes: 0, cards: 0 })).toBe(true);
    expect(canAdd({ notes: 19, cards: 0 })).toBe(true);
    expect(canAdd({ notes: 10, cards: 10 })).toBe(false);
    expect(canAdd({ notes: 0, cards: 20 })).toBe(false);
    expect(canAdd({ notes: 0, cards: 21 })).toBe(false);
  });

  it('两类不再各数各的：笔记没满但合计满了照样拦', () => {
    expect(quotaBlock({ notes: 5, cards: 15 }).ok).toBe(false);
    expect(quotaBlock({ notes: 19, cards: 0 }).ok).toBe(true);
  });

  it('老数据超过上限时按已满处理，但不要求删除', () => {
    const block = quotaBlock({ notes: 300, cards: 0 });
    expect(block.ok).toBe(false);
    expect(block.message).toContain('300');
    expect(block.message).not.toContain('删除');
  });

  it('还剩几个：已满给 0，不会给负数', () => {
    expect(remaining({ notes: 0, cards: 0 })).toBe(20);
    expect(remaining({ notes: 5, cards: 10 })).toBe(5);
    expect(remaining({ notes: 25, cards: 0 })).toBe(0);
  });

  it('用量一眼看清：已用合计、上限合计、还剩几条', () => {
    expect(quotaInfo({ notes: 5, cards: 3 })).toEqual({ used: 8, limit: 20, remaining: 12, full: false });
    expect(quotaInfo({ notes: 10, cards: 10 })).toEqual({ used: 20, limit: 20, remaining: 0, full: true });
  });

  it('老数据超过上限时用量照实报，不会把已用的数字藏起来', () => {
    const info = quotaInfo({ notes: 26, cards: 0 });
    expect(info.used).toBe(26);
    expect(info.full).toBe(true);
    expect(info.remaining).toBe(0);
  });

  it('拦下时说明「已用 20/20」，并且明说已有数据不会被删', () => {
    const block = quotaBlock({ notes: 20, cards: 0 });
    expect(block.message).toContain('已用 20/20');
    expect(block.message).toContain('不会被删');
    expect(block.message).toContain('激活高级版');
  });
});

describe('批量导入 · 超一次宽限', () => {
  it('合计没满、加完也不超：整批放行，不算超限', () => {
    const q = batchQuota({ notes: 5, cards: 5 }, 8);
    expect(q).toEqual({ allowed: 8, overLimit: false });
  });

  it('合计没满、加完越过 20：整批放行，但标超限让调用方提醒', () => {
    const q = batchQuota({ notes: 5, cards: 5 }, 20);
    expect(q).toEqual({ allowed: 20, overLimit: true });
  });

  it('刚好加到 20：放行但不算超限', () => {
    expect(batchQuota({ notes: 10, cards: 0 }, 10)).toEqual({ allowed: 10, overLimit: false });
  });

  it('导入前合计已满：整批拒绝，一条都不放', () => {
    const q = batchQuota({ notes: 12, cards: 8 }, 5);
    expect(q).toEqual({ allowed: 0, overLimit: true });
  });

  it('迁移进来的超限老数据：再导入整批拒绝', () => {
    expect(batchQuota({ notes: 26, cards: 0 }, 3).allowed).toBe(0);
  });

  it('空批直接放行，不算超限', () => {
    expect(batchQuota({ notes: 20, cards: 0 }, 0)).toEqual({ allowed: 0, overLimit: false });
  });

  it('提醒文案说清「这次全进、下次要升级」，不提拒绝、不含 emoji', () => {
    const msg = overLimitMessage({ notes: 5, cards: 5 }, 20);
    expect(msg).toContain('20 条已全部加入');
    expect(msg).toContain('30 条');
    expect(msg).toContain('下次再加入需要先升级高级版');
    expect(msg).not.toContain('拒绝');
    expect(msg).not.toContain('未加入');
  });
});

describe('高级版', () => {
  it.runIf(HAS_KEYS)('有效码激活后合计不限', async () => {
    const state = await refreshLicense(signCode({ id: 'REV-2026-0100', name: '测试' }));
    expect(state.paid).toBe(true);
    expect(canAdd({ notes: 9999, cards: 9999 })).toBe(true);
    expect(remaining({ notes: 9999, cards: 9999 })).toBe(Infinity);
    expect(batchQuota({ notes: 9999, cards: 9999 }, 50)).toEqual({ allowed: 50, overLimit: false });
    expect(licenseSummary()).toContain('高级版');
  });

  it.runIf(HAS_KEYS)('过期码不会把人留在高级版', async () => {
    const state = await refreshLicense(signCode({ id: 'REV-2026-0101', exp: Date.now() - 1000 }));
    expect(state.paid).toBe(false);
    expect(canAdd({ notes: 20, cards: 0 })).toBe(false);
    expect(licenseSummary()).toContain('已过期');
  });

  it.runIf(HAS_READER_KEYS)('Reader 的赞助人码在本插件也能解锁数量', async () => {
    const code = signReaderCode({
      id: 'BZR-AF-2026-0176',
      name: 'Pomodorinettina',
      patron: true,
      plan: 'lifetime',
    });
    const state = await refreshLicense(code);
    expect(state.paid).toBe(true);
    expect(state.name).toBe('Pomodorinettina');
    expect(canAdd({ notes: 9999, cards: 9999 })).toBe(true);
    expect(licenseSummary()).toContain('Pomodorinettina');
  });

  it.runIf(HAS_KEYS)('试填错码不掉级、不覆盖真码', async () => {
    const good = signCode({ id: 'REV-2026-0300', name: '原码' });
    await refreshLicense(good);
    expect(getLicenseState().paid).toBe(true);
    expect(currentLicenseCode()).toBe(good);

    const r = await refreshLicense('这不是码', false);
    expect(r.paid).toBe(false);
    /* 这枚码不认，但运行期授权、生效码、状态文案都还是原来那枚 */
    expect(getLicenseState().paid).toBe(true);
    expect(currentLicenseCode()).toBe(good);
    expect(licenseSummary()).toContain('原码');
  });

  it.runIf(HAS_KEYS)('启动验签（默认）遇到坏码仍按未激活处理', async () => {
    const good = signCode({ id: 'REV-2026-0301', name: '原码' });
    await refreshLicense(good);
    const r = await refreshLicense('这不是码');
    expect(r.paid).toBe(false);
    expect(getLicenseState().paid).toBe(false);
  });

  it('填错码只降级，不抛错', async () => {
    const state = await refreshLicense('这不是码');
    expect(state.paid).toBe(false);
    expect(canAdd({ notes: 19, cards: 0 })).toBe(true);
  });
});
