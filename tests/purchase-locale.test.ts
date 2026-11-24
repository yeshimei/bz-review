/**
 * 购买入口按界面语言分流（2026-11-24 起，与 bz Reader 同款）。
 *
 * 解锁弹层那颗「去购买」与更新日志统计卡的购买确认共用一套：
 * 简体中文国内店，英文（含繁体 / 其它宿主语言，review 只有中英两包）走 Creem。
 * 远程 bzr-data.json 给了 buyCn / buyIntl 就跳新地址，离线走内置兜底。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { initLocale, locale, setLocale } from '../src/i18n';
import { isSimplifiedHostCode, resolvePurchaseChinese } from '../src/i18n/strings';
import { purchaseUrlFor, sponsorUrlFor, _resetBzrDataForTests, _setBzrHttpForTests, refreshBzrData, type BzrData } from '../src/review/ui/bzr-data';
import { resolveConfirmTarget } from '../src/review/ui/changelog-note';
import { PURCHASE_URL, PURCHASE_URL_INTL } from '../src/data/entitlement';
import { SPONSOR_URL } from '../src/review/ui/reward';

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
  initLocale('auto', 'zh');
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
    initLocale('zh', 'zh-CN');
    expect(resolveConfirmTarget('buy', null)).toBe(PURCHASE_URL);
  });

  it('英文点购买取海外地址', () => {
    initLocale('en', 'en');
    expect(resolveConfirmTarget('buy', null)).toBe(PURCHASE_URL_INTL);
  });

  it('繁体宿主即使界面折叠成简体，购买也走海外', () => {
    initLocale('auto', 'zh-TW');
    expect(locale()).toBe('zh');
    expect(resolveConfirmTarget('buy', null)).toBe(PURCHASE_URL_INTL);
  });

  it('打赏仍走 support 老字段，不跟语言变', () => {
    const d = { links: { support: 'https://afdian.net/a/x', buy: '', buyCn: '', buyIntl: '' } } as BzrData;
    setLocale('en');
    expect(resolveConfirmTarget('support', d)).toBe('https://afdian.net/a/x');
  });
});

/* ── 第2条：真简体判定（界面三档不动，只看宿主原始语言） ────────── */

describe('真简体判定 · 宿主语言码', () => {
  it('简中系列算简体', () => {
    for (const code of ['zh', 'zh-CN', 'zh-cn', 'zh_Hans', 'zh-Hans-CN']) {
      expect(isSimplifiedHostCode(code)).toBe(true);
    }
  });

  it('繁中系列不算简体', () => {
    for (const code of ['zh-TW', 'zh-tw', 'zh-HK', 'zh-MO', 'zh-Hant', 'zh-Hant-TW', 'zh_Hant']) {
      expect(isSimplifiedHostCode(code)).toBe(false);
    }
  });

  it('非中文与空都不算简体', () => {
    for (const code of ['en', 'en-GB', 'ja', '', null, undefined]) {
      expect(isSimplifiedHostCode(code)).toBe(false);
    }
  });

  it('手动选中文=国内、选英文=海外，auto 看宿主原始码', () => {
    expect(resolvePurchaseChinese('zh', 'en')).toBe(true);
    expect(resolvePurchaseChinese('en', 'zh-CN')).toBe(false);
    expect(resolvePurchaseChinese('auto', 'zh-TW')).toBe(false);
    expect(resolvePurchaseChinese('auto', 'zh-CN')).toBe(true);
  });

  it('界面仍是简体两档：繁体宿主时 locale() 依旧折叠为 zh', () => {
    initLocale('auto', 'zh-TW');
    // 界面语言只有 zh/en 两档，繁体宿主折叠为 zh（三档设置不动）
    expect(locale()).toBe('zh');
    // 但购买判定独立算成非简体 → 走海外
    expect(resolvePurchaseChinese('auto', 'zh-TW')).toBe(false);
  });
});

/* ── 第1条：支持作者弹层的赞助按钮按语言分流 ─────────────────── */

describe('支持作者 · 赞助按钮分流', () => {
  it('简中走国内赞助店，非简中走海外店（与购买按钮同机制）', () => {
    expect(sponsorUrlFor(true, null)).toBe(SPONSOR_URL);
    expect(sponsorUrlFor(false, null)).toBe(PURCHASE_URL_INTL);
  });

  it('非简中时远程 buyIntl 能覆盖内置海外地址', async () => {
    _setBzrHttpForTests(() => Promise.resolve(REMOTE_DOC));
    await refreshBzrData({ force: true });
    const { currentBzrData } = await import('../src/review/ui/bzr-data');
    expect(sponsorUrlFor(false, currentBzrData())).toBe('https://new-intl.example.com/pay');
  });

  it('简中始终走国内赞助店，与 reader 一致（不读 buyCn）', async () => {
    _setBzrHttpForTests(() => Promise.resolve(REMOTE_DOC));
    await refreshBzrData({ force: true });
    const { currentBzrData } = await import('../src/review/ui/bzr-data');
    expect(sponsorUrlFor(true, currentBzrData())).toBe(SPONSOR_URL);
  });
});
