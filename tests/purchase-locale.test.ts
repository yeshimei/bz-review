/**
 * 购买入口按界面语言分流（2026-11-24 起，与 bz Reader 同款）。
 *
 * 解锁弹层那颗「去购买」与更新日志统计卡的购买确认共用一套：
 * 简体中文国内店，英文（含繁体 / 其它宿主语言，review 只有中英两包）走 Creem。
 * 远程 bzr-data.json 给了 buyCn / buyIntl 就跳新地址，离线走内置兜底。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../src/i18n';
import { purchaseUrlFor, _resetBzrDataForTests, _setBzrHttpForTests, refreshBzrData, type BzrData } from '../src/review/ui/bzr-data';
import { resolveConfirmTarget } from '../src/review/ui/changelog-note';
import { PURCHASE_URL, PURCHASE_URL_INTL } from '../src/data/entitlement';

const REMOTE_DOC = JSON.stringify({
  version: 1, updatedAt: '2026-11-24',
  changelog: [{ version: '1.0.2', date: '2026-11-24', added: [
    { domain: { zh: '阅读', en: 'Read' }, text: { zh: '改动', en: 'Change' } },
  ] }],
  roadmap: [], stats: { reward: 0, pro: 0, patrons: 0 },
  links: {
    support: 'https://afdian.net/a/x', buy: 'https://wzyp.cn/shop/IFCEI5I3',
    buyCn: 'https://new-cn.example.com/pay', buyIntl: 'https://new-intl.example.com/pay',
  },
});

afterEach(() => {
  setLocale('zh');
  _setBzrHttpForTests(null);
  _resetBzrDataForTests();
});

describe('购买分流 · 内置兜底', () => {
  it('国内地址仍是原来的链动小铺', () => {
    expect(PURCHASE_URL).toBe('https://wzyp.cn/shop/IFCEI5I3');
  });

  it('海外地址指向 Creem，且与国内不同', () => {
    expect(PURCHASE_URL_INTL).toBe('https://www.creem.io/stores/baizai');
    expect(PURCHASE_URL_INTL).not.toBe(PURCHASE_URL);
  });

  it('简中取国内店，英文取海外店', () => {
    expect(purchaseUrlFor(true, null)).toBe(PURCHASE_URL);
    expect(purchaseUrlFor(false, null)).toBe(PURCHASE_URL_INTL);
  });
});

describe('购买分流 · 远程换链接', () => {
  it('远程给了新 buyCn / buyIntl，分流取远程值', async () => {
    const { parseBzrData } = await import('../src/review/ui/bzr-data');
    const parsed = parseBzrData(REMOTE_DOC);
    expect(parsed?.links.buyCn).toBe('https://new-cn.example.com/pay');
    _setBzrHttpForTests(() => Promise.resolve(REMOTE_DOC));
    const ok = await refreshBzrData({ force: true });
    expect(ok).toBe(true);
    const { currentBzrData } = await import('../src/review/ui/bzr-data');
    const d: BzrData = currentBzrData();
    expect(purchaseUrlFor(true, d)).toBe('https://new-cn.example.com/pay');
    expect(purchaseUrlFor(false, d)).toBe('https://new-intl.example.com/pay');
  });

  it('老数据只有 buy 时，仍回退内置双地址', () => {
    const old = { links: { support: 'https://afdian.net/a/x', buy: 'https://wzyp.cn/shop/OLD' } } as BzrData;
    expect(purchaseUrlFor(true, old)).toBe(PURCHASE_URL);
    expect(purchaseUrlFor(false, old)).toBe(PURCHASE_URL_INTL);
  });
});

describe('购买分流 · 更新日志统计卡', () => {
  it('简中点购买取国内地址', () => {
    setLocale('zh');
    expect(resolveConfirmTarget('buy', null)).toBe(PURCHASE_URL);
  });

  it('英文点购买取海外地址', () => {
    setLocale('en');
    expect(resolveConfirmTarget('buy', null)).toBe(PURCHASE_URL_INTL);
  });

  it('打赏仍走 support 老字段，不跟语言变', () => {
    const d = { links: { support: 'https://afdian.net/a/x', buy: '', buyCn: '', buyIntl: '' } } as BzrData;
    setLocale('en');
    expect(resolveConfirmTarget('support', d)).toBe('https://afdian.net/a/x');
  });
});
