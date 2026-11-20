import { describe, expect, it } from 'vitest';
import { dedupeSiblings, roundQueue } from '../src/review/queue';
import type { ReviewItem } from '../src/review/data';

const item = (id: string, groupId?: string): ReviewItem =>
  ({
    id,
    filePath: id,
    name: id,
    reviewStart: '2026-11-01T00:00:00.000Z',
    stage: 1,
    phase: 'fsrs',
    stability: 5,
    difficulty: 5,
    reviewHistory: [],
    totalReviews: 1,
    averageConfidence: 0,
    nextReviewDate: '2026-11-01T00:00:00.000Z',
    lastReviewed: '2026-11-01T00:00:00.000Z',
    lastDifficulty: 'good',
    completed: false,
    isOverdue: true,
    card: groupId
      ? { key: id, bookTitle: 'B', text: id, mode: 'flashcard', groupId }
      : undefined,
  }) as ReviewItem;

describe('兄弟卡不扎堆', () => {
  it('同组只留第一张，无组的照常全留', () => {
    const got = dedupeSiblings([item('a', 'g1'), item('b', 'g1'), item('c'), item('d')]);
    expect(got.map((i) => i.id)).toEqual(['a', 'c', 'd']);
  });

  it('不同组的各自留一张', () => {
    const got = dedupeSiblings([item('a', 'g1'), item('b', 'g2'), item('c', 'g1')]);
    expect(got.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('roundQueue 默认去重，传 false 时保留全部（设置可关）', () => {
    const items = [item('a', 'g1'), item('b', 'g1')];
    expect(roundQueue(items, 0.9, [0.40255, 1.2938, 5.1971, 4.3145, 0.8, 0.9, 0.95, 0.9]).map((i) => i.id)).toEqual(['a']);
    expect(roundQueue(items, 0.9, [0.40255, 1.2938, 5.1971, 4.3145, 0.8, 0.9, 0.95, 0.9], false).map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('没有 groupId 的老卡不受影响', () => {
    const got = dedupeSiblings([item('a'), item('b')]);
    expect(got).toHaveLength(2);
  });
});
