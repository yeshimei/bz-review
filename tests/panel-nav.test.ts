/**
 * 头栏图标导航语义（2026-11-20）
 *
 * 用户口径：点图标「直接打开对应页面」，不要之前那套 toggle（在某内置页点另一个
 * 图标会先回主列表、再点一次才打开，很奇怪）；点「复习」页签才回主列表。
 * 搜索（filter）图标点一下恒定展开搜索面板，连点不清掉已输入的条件。
 * 纯函数、无 obsidian 依赖。
 */
import { describe, expect, it } from 'vitest';
import { FILTER_CLICK_STATE, nextPanelPage, type PanelPage } from '../src/review/panel-nav';

describe('点头栏图标 = 直接打开对应页', () => {
  it('在主列表点任意图标，打开对应页', () => {
    for (const p of ['settings', 'stats', 'arch', 'trash'] as PanelPage[]) {
      expect(nextPanelPage(null, p)).toBe(p);
    }
  });

  it('在任意内置页点另一个图标，直接切到目标页（不再先回主列表）', () => {
    expect(nextPanelPage('stats', 'settings')).toBe('settings');
    expect(nextPanelPage('settings', 'stats')).toBe('stats');
    expect(nextPanelPage('arch', 'trash')).toBe('trash');
  });

  it('点当前所在的同一图标，仍停在该页（不 toggle 回主列表）', () => {
    expect(nextPanelPage('stats', 'stats')).toBe('stats');
  });

  it('点「复习」页签（home）回主列表', () => {
    expect(nextPanelPage('stats', 'home')).toBeNull();
    expect(nextPanelPage(null, 'home')).toBeNull();
  });
});

describe('点搜索图标 = 恒定展开搜索面板', () => {
  it('不管当前在哪页、搜索面板是否开着，点一下都回主列表并展开搜索', () => {
    expect(FILTER_CLICK_STATE).toEqual({ page: null, filterOpen: true });
  });
});
