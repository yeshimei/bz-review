/**
 * 卡片管理器的挂起 / 埋藏（纯函数）
 *
 * 语义：挂起 = 不进本轮队列，但不改 FSRS 排期；埋藏 = 到某时刻自动恢复。
 * 两个字段必须持久化，且只在 queue.ts 的 active() 一处拦，
 * 否则会出现「逾期列显示、本轮又不带」的口径分叉。
 */
import { describe, expect, it } from 'vitest';
import {
  buryItem,
  isHiddenFromQueue,
  setSuspended,
  unsuspendAndUnbury,
} from '../src/review/card-manager';
import type { ReviewItem } from '../src/review/data';

const NOW = new Date('2026-11-18T12:00:00.000Z');

function item(opts: Partial<ReviewItem> = {}): ReviewItem {
  return {
    id: 'a',
    filePath: 'CONFIG/note.md',
    name: '笔记',
    nextReviewDate: '2026-11-20T00:00:00.000Z',
    stability: 10,
    difficulty: 4,
    stage: 9,
    reviewHistory: [],
    ...opts,
  } as unknown as ReviewItem;
}

describe('卡片管理器 · 可见性判定', () => {
  it('默认卡片照常进队列', () => {
    expect(isHiddenFromQueue(item(), { now: NOW })).toBe(false);
  });

  it('挂起的卡片不进队列', () => {
    expect(isHiddenFromQueue(item({ suspended: true }), { now: NOW })).toBe(true);
  });

  it('埋藏未到期不进队列，到期后自动回来', () => {
    const future = item({ buriedUntil: '2026-11-19T00:00:00.000Z' });
    const past = item({ buriedUntil: '2026-11-17T00:00:00.000Z' });
    expect(isHiddenFromQueue(future, { now: NOW })).toBe(true);
    expect(isHiddenFromQueue(past, { now: NOW })).toBe(false);
  });

  it('坏日期当没埋藏，不让一张卡永久消失', () => {
    expect(isHiddenFromQueue(item({ buriedUntil: '不是日期' }), { now: NOW })).toBe(false);
  });
});

describe('卡片管理器 · 状态变更不动排期', () => {
  it('挂起只写 suspended，排期四个字段原样', () => {
    const before = item();
    const after = setSuspended(before, true);
    expect(after.suspended).toBe(true);
    expect(after.nextReviewDate).toBe(before.nextReviewDate);
    expect(after.stability).toBe(before.stability);
    expect(after.difficulty).toBe(before.difficulty);
    expect(after.stage).toBe(before.stage);
    expect(before.suspended).toBeUndefined();
  });

  it('埋藏只写到期时间，不碰 nextReviewDate', () => {
    const before = item();
    const after = buryItem(before, 1, { now: NOW });
    expect(after.buriedUntil).toBe('2026-11-19T12:00:00.000Z');
    expect(after.nextReviewDate).toBe(before.nextReviewDate);
  });

  it('恢复同时清掉两个标记，但仍不动排期', () => {
    const buried = buryItem(setSuspended(item(), true), 3, { now: NOW });
    const restored = unsuspendAndUnbury(buried);
    expect(restored.suspended).toBeUndefined();
    expect(restored.buriedUntil).toBeUndefined();
    expect(restored.nextReviewDate).toBe(buried.nextReviewDate);
  });
});
