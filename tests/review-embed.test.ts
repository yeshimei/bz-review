/**
 * bz-reader 嵌入门面的纯契约（2026-11-19 起，2026-11-20 改「更多」菜单形态）。
 *
 * 嵌入时 Review 面板的品牌/标题头行让位给 bz-reader 自己的「复习」页签，入口图标
 * 改渲染进宿主的动作栏。按钮 HTML 与高亮口径必须和面板内那套一致，否则同一个功能
 * 会在两个位置长出两套文案、两套高亮规则。这里先把口径钉住，再接 DOM 与嵌入门面。
 *
 * 2026-11-20：头行从 7 颗瘦到 4 颗（filter/data/more/settings），arch/trash/books/manager
 * 收进 more 下拉菜单（MORE_MENU_ACTS）。菜单项与头行图标共用 panelActIsOn 高亮口径，
 * 四个入口都是基础版功能（entitlement 恒放行），没有门控文案。
 */
import { describe, expect, it } from 'vitest';
import {
  PANEL_HEAD_ACTS, MORE_MENU_ACTS, panelActIsOn, panelHeadBtnsHtml, panelMoreMenuHtml, queueViewHtml,
} from '../src/review/render';

/** 从生成的 HTML 里挑按钮身份（保留模板顺序，顺序漂移也算漂移） */
function actsOf(html: string): string[] {
  return [...html.matchAll(/data-act="([^"]+)"/g)].map((m) => m[1]);
}

/** 从生成的 HTML 里挑出带 is-on 的那几颗（头行图标是 data-act 在前、菜单项是 class 在前，故按 button 块整体取） */
function onActsOf(html: string): string[] {
  return [...html.matchAll(/<button\b[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => /\bis-on\b/.test(tag))
    .map((tag) => tag.match(/data-act="([^"]+)"/)?.[1])
    .filter((a): a is string => !!a);
}

describe('嵌入动作栏 · 头行图标 HTML', () => {
  it('头行 4 颗身份固定，顺序不漂移', () => {
    expect([...PANEL_HEAD_ACTS]).toEqual(['filter', 'data', 'more', 'settings']);
  });

  it('头行按钮 + 菜单项合起来覆盖全部入口，顺序固定', () => {
    expect(actsOf(panelHeadBtnsHtml())).toEqual([
      'filter', 'data', 'more',
      'batch', 'achv', 'arch', 'trash', 'books', 'manager', 'filter', 'data', 'settings',
      'settings',
    ]);
    expect([...MORE_MENU_ACTS]).toEqual([
      'batch', 'achv', 'arch', 'trash', 'books', 'manager', 'filter', 'data', 'settings',
    ]);
  });

  it('成就与批量选择只留在更多菜单（桌面+移动同一份），底栏不再画这两颗', () => {
    const menu = panelMoreMenuHtml();
    for (const act of ['batch', 'achv', 'filter', 'data', 'settings']) {
      expect(menu, act).toContain(`data-act="${act}"`);
    }
    expect(menu).toContain('批量选择');
    expect(menu).toContain('成就');
    const html = queueViewHtml([], {});
    const footer = html.slice(html.indexOf('bzrv-q-footer'));
    expect(footer).not.toContain('data-act="batch"');
    expect(footer).not.toContain('data-act="achv"');
  });

  it('头行图标有 sr-only 可读名，菜单项用真实文本，都不挂悬停气泡属性', () => {
    const html = panelHeadBtnsHtml();
    // 头行 4 颗各有 sr-only；菜单项靠真实标题文本而非 sr-only
    expect((html.match(/bzrv-sr-only/g) ?? []).length).toBe(PANEL_HEAD_ACTS.length);
    expect((html.match(/data-lucide=/g) ?? []).length).toBe(PANEL_HEAD_ACTS.length + MORE_MENU_ACTS.length);
    expect(html).not.toMatch(/aria-label|setTooltip|\btitle\s*=/);
  });

  it('菜单默认隐藏，四项各有标题与说明', () => {
    const menu = panelMoreMenuHtml();
    expect(menu).toContain('class="bzrv-more-menu" hidden');
    for (const text of ['已完成', '已移出', '按书档案', '卡片管理器', '复习记录', '数据洞察']) {
      expect(menu).toContain(text);
    }
  });

  it('传入 activePage 时 HTML 自带高亮，和纯函数口径一致', () => {
    for (const page of [null, 'arch', 'trash', 'stats', 'books', 'manager', 'settings']) {
      const expected = [...PANEL_HEAD_ACTS, ...MORE_MENU_ACTS].filter((a) => panelActIsOn(a, page));
      expect(onActsOf(panelHeadBtnsHtml(page))).toEqual(expected);
    }
  });
});

describe('嵌入动作栏 · 高亮计算', () => {
  it('arch / trash / stats / books / manager / settings 各自只落在对应入口，filter/more 从不参与', () => {
    expect(panelActIsOn('filter', 'arch')).toBe(false);
    expect(panelActIsOn('more', 'arch')).toBe(false);
    expect(panelActIsOn('arch', 'arch')).toBe(true);
    expect(panelActIsOn('trash', 'trash')).toBe(true);
    expect(panelActIsOn('data', 'stats')).toBe(true);
    expect(panelActIsOn('books', 'books')).toBe(true);
    expect(panelActIsOn('manager', 'manager')).toBe(true);
    expect(panelActIsOn('settings', 'settings')).toBe(true);
  });

  it('null 与其它内置页（achv 等）所有入口都不亮', () => {
    for (const page of [null, undefined, 'achv']) {
      expect([...PANEL_HEAD_ACTS, ...MORE_MENU_ACTS].filter((a) => panelActIsOn(a, page))).toEqual([]);
    }
  });
});
