/**
 * 设置入口分流（review/settings-entry.ts）：Reader 开了内嵌复习页时，设置页要落在
 * 内嵌面板上；没开就直接开独立面板；内嵌页签迟迟没渲染好则超时兜底按独立开。
 */
import { describe, expect, it, vi } from 'vitest';
import { openSettingsFromHost, type SettingsEntryDeps } from '../src/review/settings-entry';

describe('设置入口分流 · 没有内嵌（独立面板）', () => {
  it('route 为 null：直接开设置，不碰 reader 页签', async () => {
    const tab = { openReviewTab: vi.fn() };
    const openSettings = vi.fn();
    const d: SettingsEntryDeps = {
      route: null,
      embeddedReady: () => false,
      openSettings,
      now: Date.now,
      sleep: () => Promise.resolve(),
    };

    const route = await openSettingsFromHost(d);

    expect(route).toBe('standalone');
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(tab.openReviewTab).not.toHaveBeenCalled();
  });
});

describe('设置入口分流 · Reader 内嵌页', () => {
  it('亮出复习页签，等面板嵌进去后再开设置（走内嵌路）', async () => {
    const tab = { openReviewTab: vi.fn() };
    const openSettings = vi.fn();
    let ready = false;
    let clock = 0;
    const d: SettingsEntryDeps = {
      route: tab,
      embeddedReady: () => ready,
      openSettings: () => {
        // 开设置时面板必须已经嵌好
        expect(ready).toBe(true);
        openSettings();
      },
      now: () => clock,
      sleep: async () => {
        clock += 40;
        ready = true; // reader 渲染完，面板挂进宿主
      },
      maxWaitMs: 1000,
    };

    const route = await openSettingsFromHost(d);

    expect(route).toBe('embedded');
    expect(tab.openReviewTab).toHaveBeenCalledTimes(1);
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it('页签迟迟没渲染：最多等一秒，超时照开设置（不让人点了没反应）', async () => {
    const tab = { openReviewTab: vi.fn() };
    const openSettings = vi.fn();
    let clock = 0;
    let sleepCount = 0;
    const d: SettingsEntryDeps = {
      route: tab,
      embeddedReady: () => false, // 一直没嵌进去
      openSettings,
      now: () => clock,
      sleep: async () => {
        sleepCount += 1;
        clock += 40;
      },
      maxWaitMs: 1000,
    };

    const route = await openSettingsFromHost(d);

    expect(route).toBe('standalone');
    expect(tab.openReviewTab).toHaveBeenCalledTimes(1);
    expect(openSettings).toHaveBeenCalledTimes(1);
    /* 40ms 一拍，1000ms 封顶：25 拍后停（不多等，也不提前放弃） */
    expect(sleepCount).toBe(25);
  });

  it('面板本来就嵌着：亮页签后立刻开设置，不用等', async () => {
    const tab = { openReviewTab: vi.fn() };
    const openSettings = vi.fn();
    const sleep = vi.fn(async () => undefined);
    const d: SettingsEntryDeps = {
      route: tab,
      embeddedReady: () => true,
      openSettings,
      now: Date.now,
      sleep,
      maxWaitMs: 1000,
    };

    const route = await openSettingsFromHost(d);

    expect(route).toBe('embedded');
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
