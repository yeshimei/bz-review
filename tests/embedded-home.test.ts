/**
 * 嵌入 bz-reader 时点宿主「复习」页签回主列表（需求 1）
 *
 * 独立 Review 的顶部「复习」页签走 bindPanelHead 的 home 分支回三列卡牌队列；
 * 嵌入态那颗页签由宿主画，得单独接一行。这里钉住接法：找对页签、点击触发回主列表、
 * 收场时能解绑（否则离开复习页后点别处的同名元素会误触发）。
 */
import { describe, expect, it, vi } from 'vitest';
import { bindStudyReviewTab, REVIEW_STUDY_TAB_SELECTOR } from '../src/review/embedded-home';

describe('嵌入态 · 宿主复习页签回主列表', () => {
  it('在宿主头栏找到复习页签，点击触发回主列表', () => {
    const listeners: Record<string, Array<() => void>> = {};
    const tab = {
      addEventListener: (t: string, fn: () => void): void => { (listeners[t] ??= []).push(fn); },
      removeEventListener: (t: string, fn: () => void): void => { listeners[t] = (listeners[t] ?? []).filter((f) => f !== fn); },
    };
    let selector = '';
    const host = {
      parentElement: {
        querySelector: (s: string): unknown => { selector = s; return tab; },
      },
    } as unknown as HTMLElement;
    const onHome = vi.fn();

    const cleanup = bindStudyReviewTab(host, onHome);
    expect(selector).toBe(REVIEW_STUDY_TAB_SELECTOR);
    for (const fn of listeners.click ?? []) fn();
    expect(onHome).toHaveBeenCalledTimes(1);

    cleanup();
    for (const fn of listeners.click ?? []) fn();
    expect(onHome).toHaveBeenCalledTimes(1);
  });

  it('宿主没有复习页签时安全返回空清理函数', () => {
    const host = { parentElement: { querySelector: () => null } } as unknown as HTMLElement;
    expect(() => bindStudyReviewTab(host, () => {})()).not.toThrow();
  });
});
