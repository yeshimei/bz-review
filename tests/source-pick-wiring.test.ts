import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * 从阅读器加入复习：这条链路最容易在后续重构里被悄悄改回「Reader 自己出题」。
 * 这里用源码接线断言钉住三条口径：
 *   · 按划线 / 按章节都走 Review 自己的 resolvePick；
 *   · 结果交给统一制卡窗口，不自己入库；
 *   · 每章上限只在按章节时截，命令与门面版本都挂上。
 */
const ui = readFileSync(new URL('../src/review/source-pick-ui.ts', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

describe('从阅读器加入复习 · 接线', () => {
  it('两个 tab 分别走 marksKey / chaptersKey', () => {
    expect(ui).toContain("resolvePick(tab === 'marks' ? 'marksKey' : 'chaptersKey'");
  });

  it('按章节按每章上限截断，按划线不截', () => {
    expect(ui).toContain('capSourcesPerChapter(sources, limit)');
  });

  it('交给统一制卡窗口，不自己出题', () => {
    expect(ui).toContain('openWizard(this.app');
    expect(ui).toContain('openCardWizard(app');
    expect(ui).not.toContain('runReviewAdd');
  });

  it('来源补「回到原文」链接', () => {
    expect(ui).toContain('readerJumpUrl(bookId, { text: s.text, chapter: s.chapterTitle })');
    expect(ui).toContain('withBacklink(bookId, capped)');
  });

  it('命令与门面版本都挂上', () => {
    expect(main).toContain("id: 'review-add-reader'");
    expect(main).toContain('openReaderFlow');
    expect(main).toContain('version: 6');
  });

  it('Reader 缺席时送到设置插件组，不只是甩一句提示', () => {
    /* 2026-11-21 用户要求：没装 / 没启用 → 直接跳设置里的「插件」组引导安装或启用 */
    expect(ui).toContain('readReaderInstall');
    expect(ui).toContain("openSettings('插件')");
    expect(ui).toContain('community-plugins');
  });
});
