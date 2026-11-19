/**
 * bz-reader 嵌入门面的纯契约（2026-11-19）。
 *
 * 嵌入时 Review 面板的品牌/标题头行让位给 bz-reader 自己的「复习」页签，入口图标
 * 改渲染进宿主的动作栏。按钮 HTML 与高亮口径必须和面板内那套一致，否则同一个功能
 * 会在两个位置长出两套文案、两套高亮规则。这里先把口径钉住，再接 DOM 与嵌入门面。
 *
 * 2026-11-19：头行加第 5 颗「已移出」（trash），排在与它同源的 arch 后面——
 * 都是「另一份名单」的入口，别被后面的排序改动拆散。
 */
import { describe, expect, it } from 'vitest';
import { PANEL_HEAD_ACTS, panelActIsOn, panelHeadBtnsHtml } from '../src/review/render';

/** 从生成的 HTML 里挑按钮身份（保留模板顺序，顺序漂移也算漂移） */
function actsOf(html: string): string[] {
  return [...html.matchAll(/data-act="([^"]+)"/g)].map((m) => m[1]);
}

/** 从生成的 HTML 里挑出带 is-on 的那几颗 */
function onActsOf(html: string): string[] {
  return [...html.matchAll(/<button\s+data-act="([^"]+)"\s+class="([^"]*)"/g)]
    .filter((m) => /\bis-on\b/.test(m[2]))
    .map((m) => m[1]);
}

describe('嵌入动作栏 · 头行图标 HTML', () => {
  it('data-act 集合与面板头一致，顺序不漂移', () => {
    expect([...PANEL_HEAD_ACTS]).toEqual(['filter', 'arch', 'trash', 'data', 'settings']);
    expect(actsOf(panelHeadBtnsHtml())).toEqual([...PANEL_HEAD_ACTS]);
  });

  it('每颗都有 sr-only 可读名与图标占位，且不挂悬停气泡属性', () => {
    const html = panelHeadBtnsHtml();
    expect((html.match(/bzrv-sr-only/g) ?? []).length).toBe(PANEL_HEAD_ACTS.length);
    expect((html.match(/data-lucide=/g) ?? []).length).toBe(PANEL_HEAD_ACTS.length);
    expect(html).not.toMatch(/aria-label|setTooltip|\btitle\s*=/);
  });

  it('传入 activePage 时 HTML 自带高亮，和纯函数口径一致', () => {
    for (const page of [null, 'arch', 'trash', 'stats', 'settings']) {
      expect(onActsOf(panelHeadBtnsHtml(page))).toEqual(PANEL_HEAD_ACTS.filter((a) => panelActIsOn(a, page)));
    }
  });
});

describe('嵌入动作栏 · 高亮计算', () => {
  it('arch / trash / stats / settings 各自只落在对应那颗，filter 从不参与', () => {
    expect(panelActIsOn('filter', 'arch')).toBe(false);
    expect(panelActIsOn('arch', 'arch')).toBe(true);
    expect(panelActIsOn('trash', 'trash')).toBe(true);
    expect(panelActIsOn('data', 'stats')).toBe(true);
    expect(panelActIsOn('settings', 'settings')).toBe(true);
  });

  it('null 与其它内置页（books / manager）所有入口都不亮', () => {
    for (const page of [null, undefined, 'books', 'manager']) {
      expect(PANEL_HEAD_ACTS.filter((a) => panelActIsOn(a, page))).toEqual([]);
    }
  });
});
