// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { aboutBarHtml, groupColumns, GROUP_ORDER, GROUP_SUBTITLES, GROUP_WEIGHTS, orderGroups } from '../src/review/ui/settings-page-pure';

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
    const names = ['授权', '数据', '界面', '检查提醒', '划线卡', '做题家', '复习节奏', '记忆算法', '自动化', 'AI', '探索'];
    const weights = [5, 5, 5, 4, 6, 7, 12, 5, 4, 4, 7];
    const [left, right] = groupColumns(names, weights);
    const indexIn = (col: string[]) => col.map((name) => names.indexOf(name));
    const ascending = (xs: number[]) => xs.every((x, i) => i === 0 || x > xs[i - 1]);
    expect(ascending(indexIn(left))).toBe(true);
    expect(ascending(indexIn(right))).toBe(true);
    expect(left.length + right.length).toBe(names.length);
    expect(new Set([...left, ...right]).size).toBe(names.length);
  });

  it('阅读顺序：自动收编紧跟数据，实验功能沉到最后', () => {
    expect(GROUP_ORDER.indexOf('自动化')).toBeLessThan(GROUP_ORDER.indexOf('检查提醒'));
    expect(GROUP_ORDER.indexOf('检查提醒')).toBeLessThan(GROUP_ORDER.indexOf('划线卡'));
    expect(GROUP_ORDER[GROUP_ORDER.length - 1]).toBe('探索');
  });

  it('切一刀配平：复习核心组不跨列拆散，两列高度接近', () => {
    const names = [...GROUP_ORDER];
    const weights = names.map((n) => GROUP_WEIGHTS[n]);
    const [left, right] = groupColumns(names, weights);
    expect(left[left.length - 1]).toBe('做题家');
    expect(right[0]).toBe('复习节奏');
    const sum = (col: string[]) => col.reduce((n, name) => n + GROUP_WEIGHTS[name], 0);
    expect(Math.abs(sum(left) - sum(right))).toBeLessThan(120);
    expect([...left, ...right]).toEqual(names);
  });

  it('orderGroups 按阅读顺序排，未知组追加末尾且不改入参', () => {
    const input = [{ name: '探索' }, { name: '新组' }, { name: '数据' }];
    const out = orderGroups(input);
    expect(out.map((g) => g.name)).toEqual(['数据', '探索', '新组']);
    expect(input.map((g) => g.name)).toEqual(['探索', '新组', '数据']);
  });

  it('不传权重时按组数均分（11 组 → 6/5）', () => {
    const names = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'];
    const [left, right] = groupColumns(names);
    expect(left.length).toBe(6);
    expect(right.length).toBe(5);
  });

  it('每个分组都有原型里的英文副标题', () => {
    const names = ['授权', '数据', '界面', '检查提醒', '划线卡', '做题家', '复习节奏', '记忆算法', '自动化', 'AI', '探索'];
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

  it('数据目录行是 Reader 同款选择钮，不是 chips / 手输框', () => {
    const schema = read('src/review/settings-schema.ts');
    const at = schema.indexOf("name: '数据目录'");
    const dataRow = schema.slice(Math.max(0, at - 120), at + 1800);
    expect(dataRow).toContain("type: 'custom'");
    expect(dataRow).toContain('bzs-pickdir');
    expect(dataRow).toContain('pickFolderNative');
    expect(dataRow).not.toContain("type: 'path'");
    expect(schema).toContain('getSettings().storagePath = next');
    expect(schema).toContain('await saveSettings()');
    const css = read('src/review/ui/styles/settings-page.css');
    expect(css).toContain('.bzs-pickdir-path');
  });

  it('合计满 50 条弹同一份对照窗，只引导购买，激活码统一在授权组填', () => {
    const app = read('src/review/app.ts');
    expect(app).toContain('openQuotaUpgradeDialog()');
    expect(app).not.toContain("msg.includes('基础版最多')");
    const dlg = read('src/review/ui/unlock-dialog.ts');
    expect(dlg).not.toContain('unlockactivate');
    expect(dlg).not.toContain('bzs-unlock-code');
    expect(dlg).toContain("buy.dataset.act = 'unlockbuy'");
    expect(dlg).toContain('条额度（笔记 + 划线合计）已用完');
    expect(dlg).not.toContain('篇复习笔记已用完');
    expect(dlg).toContain('已有数据不会被删');
  });
});
