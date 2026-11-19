// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { allocZAbove } from '../src/core/z-order';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

describe('复习插件 · 照搬 reader 的更新日志 / 支持作者', () => {
  it('二次确认层能取到严格高于主窗的 z 号', () => {
    const below = document.createElement('div');
    below.style.zIndex = '250000';
    expect(allocZAbove(below)).toBeGreaterThan(250000);
  });

  it('更新日志保留版本时间轴、三页签与页脚支持作者', () => {
    const src = read('src/review/ui/changelog-note.ts');
    expect(src).toContain('bzs-chgn-rail');
    expect(src).toContain('bzs-chgn-toolbar');
    expect(src).toContain('data-view-btn');
    expect(src).toContain('roadmapTab');
    expect(src).toContain('fbBug');
    expect(src).toContain('chgnsupport');
  });

  it('支持作者弹窗沿用 reader DOM 与本地赞赏码', () => {
    const src = read('src/review/ui/support-dialog.ts');
    expect(src).toContain('bzs-sup-code-box');
    expect(src).toContain('bzs-sup-names');
    expect(src).toContain('reward-code.png');
  });

  it('在线数据与名单来自 bz 主仓，双通道并发', () => {
    const data = read('src/review/ui/bzr-data.ts');
    expect(data).toContain('raw.githubusercontent.com/yeshimei/bz/master/docs/bzr-data.json');
    expect(data).toContain('gitee.com/ntbl/bz/raw/master/docs/bzr-data.json');
    const patrons = read('src/review/ui/patrons.ts');
    expect(patrons).toContain('docs/patrons.json');
  });

  it('三份弹窗样式已进构建源清单', () => {
    const build = read('scripts/build-css.mjs');
    for (const name of ['changelog.css', 'changelog-roadmap.css', 'support.css']) {
      expect(build).toContain(name);
    }
  });
});
