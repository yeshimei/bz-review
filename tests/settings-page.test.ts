// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { aboutBarHtml, groupColumns, GROUP_SUBTITLES } from '../src/review/ui/settings-page-pure';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

describe('复习设置页 · 两列骨架与关于条', () => {
  it('关于条五个出口齐全（GitHub / 视频 / 群 / 支持作者 / 更新日志）', () => {
    const html = aboutBarHtml('1.0.0', false, '');
    for (const act of ['aboutgithub', 'aboutvideo', 'copygroup', 'support', 'changelog']) {
      expect(html).toContain(`data-act="${act}"`);
    }
  });

  it('关于条带品牌、版本号与身份徽章', () => {
    const html = aboutBarHtml('1.0.0', false, '');
    expect(html).not.toContain('bzs-brand"');
    expect(html).toContain('>Review<');
    expect(html).toContain('v1.0.0');
    expect(html).toContain('基础版');
  });

  it('关于条不挂悬停气泡属性（仓库禁令）', () => {
    const html = aboutBarHtml('1.0.0', true, '面包');
    expect(html).not.toContain('title=');
    expect(html).not.toContain('aria-label=');
    expect(html).toContain('bzs-sr-only');
  });

  it('两列分组按原型排布：左五组右六组，朗读不丢', () => {
    const names = ['授权', '数据', '界面', '检查提醒', '划线卡', '做题家', '复习节奏', '记忆算法', '自动化', 'AI', '朗读'];
    const [left, right] = groupColumns(names);
    expect(left).toEqual(['授权', '数据', '界面', '检查提醒', '划线卡']);
    expect(right).toEqual(['做题家', '复习节奏', '记忆算法', '自动化', 'AI', '朗读']);
    expect(left.length + right.length).toBe(names.length);
  });

  it('每个分组都有原型里的英文副标题', () => {
    const names = ['授权', '数据', '界面', '检查提醒', '划线卡', '做题家', '复习节奏', '记忆算法', '自动化', 'AI', '朗读'];
    for (const name of names) expect(GROUP_SUBTITLES[name]).toBeTruthy();
  });

  it('设置页入口接上新渲染器，五个出口接上真功能', () => {
    const ui = read('src/review/ui.ts');
    expect(ui).toContain('renderReviewSettingsPage');
    const page = read('src/review/ui/settings-page.ts');
    expect(page).toContain('openReviewChangelog');
    expect(page).toContain('openReviewSupportDialog');
    expect(page).toContain('copyReviewGroupId');
  });
});
