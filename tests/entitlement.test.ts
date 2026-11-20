import { describe, expect, it, afterEach } from 'vitest';
import {
  FREE_CARD_LIMIT,
  FREE_NOTE_LIMIT,
  canAddCard,
  canAddNote,
  licenseSummary,
  quotaBlock,
  QuotaExceededError,
  quotaInfo,
  refreshLicense,
  currentLicenseCode,
  getLicenseState,
  remainingCards,
  remainingNotes,
} from '../src/data/entitlement';
import { HAS_KEYS, HAS_READER_KEYS, signCode, signReaderCode } from './helpers/sign';

afterEach(async () => {
  await refreshLicense('');
});

describe('基础版上限', () => {
  it('两类分别是 20 篇与 50 条', () => {
    expect(FREE_NOTE_LIMIT).toBe(20);
    expect(FREE_CARD_LIMIT).toBe(50);
  });

  it('笔记：第 20 篇还能加，第 21 篇开始拦', () => {
    expect(canAddNote(0)).toBe(true);
    expect(canAddNote(19)).toBe(true);
    expect(canAddNote(20)).toBe(false);
    expect(canAddNote(21)).toBe(false);
  });

  it('划线卡：第 50 条还能加，第 51 条开始拦', () => {
    expect(canAddCard(49)).toBe(true);
    expect(canAddCard(50)).toBe(false);
  });

  it('老数据超过上限时按已满处理，但不要求删除', () => {
    const block = quotaBlock('note', { notes: 300, cards: 0 });
    expect(block.ok).toBe(false);
    expect(block.message).toContain('300');
    expect(block.message).not.toContain('删除');
  });

  it('到顶抛带类型的错误，界面据此弹升级窗而不是当成写盘失败', () => {
    const err = new QuotaExceededError('note', '已用 20/20 篇复习笔记（基础版上限）。');
    expect(err).toBeInstanceOf(Error);
    expect(err.kind).toBe('note');
    expect(err.message).toContain('20/20');
  });

  it('两类各数各的：笔记满了不影响划线卡', () => {
    expect(quotaBlock('note', { notes: 20, cards: 0 }).ok).toBe(false);
    expect(quotaBlock('card', { notes: 20, cards: 0 }).ok).toBe(true);
  });

  it('还剩几个：已满给 0，不会给负数', () => {
    expect(remainingNotes(0)).toBe(20);
    expect(remainingNotes(25)).toBe(0);
    expect(remainingCards(50)).toBe(0);
  });

  it('用量一眼看清：已用几条、上限几条、还剩几条', () => {
    expect(quotaInfo('note', { notes: 5, cards: 0 })).toEqual({ used: 5, limit: 20, remaining: 15, full: false });
    expect(quotaInfo('card', { notes: 0, cards: 50 })).toEqual({ used: 50, limit: 50, remaining: 0, full: true });
  });

  it('老数据超过上限时用量照实报，不会把已用的数字藏起来', () => {
    const info = quotaInfo('note', { notes: 26, cards: 0 });
    expect(info.used).toBe(26);
    expect(info.full).toBe(true);
    expect(info.remaining).toBe(0);
  });

  it('拦下时说明「已用 20/20」，并且明说已有数据不会被删', () => {
    const block = quotaBlock('note', { notes: 20, cards: 0 });
    expect(block.message).toContain('已用 20/20');
    expect(block.message).toContain('不会被删');
    expect(block.message).toContain('激活高级版');
  });

  it('划线卡用自己那一套数字，不借用笔记的 20', () => {
    const block = quotaBlock('card', { notes: 0, cards: 50 });
    expect(block.message).toContain('50/50');
  });
});

describe('高级版', () => {
  it.runIf(HAS_KEYS)('有效码激活后两类都不限', async () => {
    const state = await refreshLicense(signCode({ id: 'REV-2026-0100', name: '测试' }));
    expect(state.paid).toBe(true);
    expect(canAddNote(9999)).toBe(true);
    expect(canAddCard(9999)).toBe(true);
    expect(remainingNotes(9999)).toBe(Infinity);
    expect(licenseSummary()).toContain('高级版');
  });

  it.runIf(HAS_KEYS)('过期码不会把人留在高级版', async () => {
    const state = await refreshLicense(signCode({ id: 'REV-2026-0101', exp: Date.now() - 1000 }));
    expect(state.paid).toBe(false);
    expect(canAddNote(20)).toBe(false);
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
    expect(canAddNote(9999)).toBe(true);
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
    expect(canAddNote(19)).toBe(true);
  });
});
