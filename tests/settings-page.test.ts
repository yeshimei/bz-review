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
    expect(html).not.toContain('tagline');
  });

  it('关于条不挂悬停气泡属性（仓库禁令）', () => {
    const html = aboutBarHtml('1.0.0', true, '面包');
    expect(html).not.toContain('title=');
    expect(html).not.toContain('aria-label=');
    expect(html).toContain('bzs-sr-only');
  });

  it('两列按体量均衡：重的组不会都堆在一列', () => {
    const names = ['A', 'B', 'C', 'D', 'E'];
    const weights = [5, 1, 5, 1, 1];
    const [left, right] = groupColumns(names, weights);
    const sum = (col: string[]) => col.reduce((n, name) => n + weights[names.indexOf(name)], 0);
    expect(Math.abs(sum(left) - sum(right))).toBeLessThanOrEqual(Math.max(...weights));
    expect([...left, ...right].sort()).toEqual([...names].sort());
  });

  it('同组不拆、列内保持原顺序', () => {
    const names = ['授权', '数据', '界面', '检查提醒', '划线卡', '做题家', '复习节奏', '记忆算法', '自动化', 'AI', '朗读'];
    const weights = [5, 5, 5, 4, 6, 7, 12, 5, 4, 4, 7];
    const [left, right] = groupColumns(names, weights);
    const indexIn = (col: string[]) => col.map((name) => names.indexOf(name));
    const ascending = (xs: number[]) => xs.every((x, i) => i === 0 || x > xs[i - 1]);
    expect(ascending(indexIn(left))).toBe(true);
    expect(ascending(indexIn(right))).toBe(true);
    expect(left.length + right.length).toBe(names.length);
    expect(new Set([...left, ...right]).size).toBe(names.length);
  });

  it('不传权重时按组数均分（11 组 → 6/5）', () => {
    const names = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'];
    const [left, right] = groupColumns(names);
    expect(left.length).toBe(6);
    expect(right.length).toBe(5);
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

  it('授权组有高级功能对照弹窗入口', () => {
    const schema = read('src/review/settings-schema.ts');
    expect(schema).toContain("name: '高级版功能'");
    expect(schema).toContain('openReviewUnlockDialog');
    const build = read('scripts/build-css.mjs');
    expect(build).toContain('unlock.css');
  });
});
