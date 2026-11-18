/**
 * 高级档能力位：从「只锁数量」升级为「数量 + 少数高价值功能」双门槛。
 *
 * 这四个权益都是卖断制下可验证、零持续成本的功能：
 * 听卡片、跳回原文高亮、按书报告导出、卡片管理器。
 * 这里先把「免费不可用 / 激活后可用 / 拦截文案不误导」钉住，再接入入口。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  FREE_NOTE_LIMIT,
  canAddNote,
  canUseCapability,
  capabilityBlock,
  setLicenseState,
  type ProCapability,
} from '../src/data/entitlement';

const CAPS: ProCapability[] = ['speech', 'sourceLink', 'bookReport', 'cardManager'];

beforeEach(() => {
  setLicenseState({ paid: false, checkedAt: 0 });
});

describe('高级档能力位 · 门控口径', () => {
  it('免费档四个能力全部不可用', () => {
    for (const cap of CAPS) {
      expect(canUseCapability(cap), `${cap} 不该免费放开`).toBe(false);
    }
  });

  it('激活后四个能力全部可用', () => {
    setLicenseState({ paid: true, checkedAt: Date.now(), name: '测试用户' });
    for (const cap of CAPS) {
      expect(canUseCapability(cap), `${cap} 激活后该可用`).toBe(true);
    }
  });

  it('未知能力不误放行', () => {
    expect(canUseCapability('unknown' as ProCapability)).toBe(false);
  });

  it('数量限制不受能力位影响，不回归原口径', () => {
    expect(canAddNote(0)).toBe(true);
    expect(canAddNote(FREE_NOTE_LIMIT)).toBe(false);
  });
});

describe('高级档能力位 · 拦截文案', () => {
  it('每个能力都给一句能直接弹给人的话', () => {
    for (const cap of CAPS) {
      const block = capabilityBlock(cap);
      expect(block.ok, cap).toBe(false);
      expect(block.message, cap).toContain('高级版');
      expect(block.message.length, cap).toBeGreaterThan(8);
    }
  });

  it('文案明确不删数据，避免让用户误以为超限就没收', () => {
    expect(capabilityBlock('speech').message).toContain('已有数据不会被删');
  });

  it('未拦截时不给多余提示', () => {
    setLicenseState({ paid: true, checkedAt: 0 });
    expect(capabilityBlock('cardManager')).toEqual({ ok: true, message: '' });
  });
});
