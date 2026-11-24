/**
 * 与 bz Reader 对齐：授权组状态行整句 + 非简体收起中文生态入口（2026-11-25）。
 *
 * 三件事必须钉住：
 *   1. 状态行整句与 reader 的 tierText 逐字同款（高级版 / 赞助人 / 停用 / 基础版）；
 *   2. 关于条只有真简体用户才挂「视频教程 + QQ 交流群」，其余语言只留 GitHub /
 *      支持作者 / 更新日志；
 *   3. 更新日志页脚与解锁弹层的 QQ / B 站入口同样只在真简体下渲染。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { licenseTierText, setLicenseState } from '../src/data/entitlement';
import { markRevoked } from '../src/data/revoked';
import { aboutBarHtml } from '../src/review/ui/settings-page-pure';
import { initLocale, isChinesePurchase, setLocale } from '../src/i18n';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(join(here, '..', rel), 'utf8');

afterEach(() => {
  setLocale('zh');
  setLicenseState({ paid: false, checkedAt: 0 }, '');
});

describe('授权状态行 · 整句（reader 同款）', () => {
  it('简体 · 永久高级版：高级版已激活 · 永久有效', () => {
    setLocale('zh');
    setLicenseState({ paid: true, checkedAt: Date.now() }, 'BZP2.x.y.z');
    expect(licenseTierText()).toBe('高级版已激活 · 永久有效');
  });

  it('简体 · 赞助人码：句子里带「赞助人」', () => {
    setLocale('zh');
    setLicenseState({ paid: true, patron: true, checkedAt: Date.now() }, 'BZP2.x.y.z');
    expect(licenseTierText()).toContain('赞助人');
    expect(licenseTierText()).toContain('永久有效');
  });

  it('英文界面走英文整句（Pro activated · perpetual）', () => {
    setLocale('en');
    setLicenseState({ paid: true, checkedAt: Date.now() }, 'BZP2.x.y.z');
    expect(licenseTierText()).toBe('Pro activated · perpetual');
  });

  it('基础版只有「基础版」一句', () => {
    setLocale('zh');
    setLicenseState({ paid: false, checkedAt: Date.now() }, '');
    expect(licenseTierText()).toBe('基础版');
  });

  it('停用码：报出码号并说高级功能已关闭', () => {
    setLocale('zh');
    const code = 'BZP2.disabled.payload.sig';
    setLicenseState({ paid: true, licenseId: 'BZR-2026-0001', checkedAt: Date.now() }, code);
    markRevoked(code, Date.now());
    expect(licenseTierText()).toContain('停用');
    expect(licenseTierText()).toContain('BZR-2026-0001');
    expect(licenseTierText()).toContain('已关闭');
  });
});

describe('授权组结构 · 照 reader 两行（付费）/ 三行（免费）', () => {
  const schema = read('src/review/settings-schema.ts');

  it('付费时不再有独立的「停用名单」行，核对挂在状态行', () => {
    expect(schema).not.toContain("name: t('settings.license.recheck')");
    expect(schema).toContain("text: t('settings.lic.recheck')");
  });

  it('「高级版」行只在免费版显示（visibleWhen !isPaid）', () => {
    expect(schema).toContain('visibleWhen: () => !isPaid()');
    expect(schema).toContain("name: t('settings.lic.paid')");
  });

  it('状态行用 licenseTierText 整句，不再用短标签', () => {
    expect(schema).toContain('licenseTierText()');
    expect(schema).not.toContain("t('settings.license.proState')");
  });
});

describe('关于条 · 非简体收起中文生态入口', () => {
  it('简体：视频教程与 QQ 交流群都在', () => {
    setLocale('zh');
    const html = aboutBarHtml('1.0.3', true, '');
    expect(html).toContain('data-act="aboutvideo"');
    expect(html).toContain('data-act="copygroup"');
    expect(html).toContain('1130883117');
  });

  it('非简体：视频教程与 QQ 交流群都不渲染，只留 GitHub / 支持作者 / 更新日志', () => {
    setLocale('en');
    const html = aboutBarHtml('1.0.3', true, '', '1130883117', false);
    expect(html).not.toContain('data-act="aboutvideo"');
    expect(html).not.toContain('data-act="copygroup"');
    expect(html).not.toContain('1130883117');
    expect(html).toContain('data-act="aboutgithub"');
    expect(html).toContain('data-act="support"');
    expect(html).toContain('data-act="changelog"');
  });
});

describe('购买分流 · 真简体口径（与 reader isChineseUI 对齐）', () => {
  it('简体宿主走国内店', () => {
    initLocale('auto', 'zh-CN');
    expect(isChinesePurchase()).toBe(true);
  });

  it('英文宿主走海外店', () => {
    initLocale('auto', 'en-US');
    expect(isChinesePurchase()).toBe(false);
  });

  it('繁体宿主也算非简体（没有 QQ / 微信支付）', () => {
    initLocale('auto', 'zh-TW');
    expect(isChinesePurchase()).toBe(false);
  });

  afterEach(() => {
    initLocale('auto', 'zh-CN');
  });
});

describe('更新日志 / 解锁弹层 · 非简体入口收起', () => {
  it('更新日志页脚按语言决定 QQ 群与 B 站图标', () => {
    const src = read('src/review/ui/changelog-note.ts');
    expect(src).toContain('...(isChinesePurchase()');
    expect(src).toContain("if (!isChinesePurchase()) return '';");
  });

  it('解锁弹层的交流群按钮只在真简体渲染，且点击复制群号', () => {
    const src = read('src/review/ui/unlock-dialog.ts');
    expect(src).toContain('if (isChinesePurchase())');
    expect(src).toContain('copyReviewGroupId');
    expect(src).not.toContain('qm.qq.com/q/');
  });
});
