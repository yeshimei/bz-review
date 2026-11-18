/**
 * 按书/章节复习档案（纯层契约）。
 *
 * 现状的 analysis 只有全局视图；这里在已有 R/S/D 与评级分布之上加一层分组，
 * 不动任何调度逻辑。卡片按书名分组，笔记按所在文件夹分组，两类不混。
 */
import { describe, expect, it } from 'vitest';
import { bookReportMarkdown, bookSummariesOf } from '../src/review/book-summary';
import type { ReviewItem } from '../src/review/data';

const NOW = new Date('2026-11-18T12:00:00.000Z');

function card(key: string, book: string, chapter: string, opts: Partial<ReviewItem> = {}): ReviewItem {
  return {
    id: key,
    filePath: `reader:${book}:${key}`,
    name: key,
    kind: 'card',
    card: { key, bookTitle: book, chapterTitle: chapter, text: `${key} 原文` },
    phase: 'fsrs',
    stability: 10,
    difficulty: 4,
    lastReviewed: '2026-11-01T00:00:00.000Z',
    reviewHistory: [],
    ...opts,
  } as unknown as ReviewItem;
}

function note(key: string, folder: string, opts: Partial<ReviewItem> = {}): ReviewItem {
  return {
    id: key,
    filePath: `${folder}/${key}.md`,
    name: key,
    kind: 'note',
    phase: 'fsrs',
    stability: 5,
    difficulty: 5,
    lastReviewed: '2026-11-01T00:00:00.000Z',
    reviewHistory: [],
    ...opts,
  } as unknown as ReviewItem;
}

describe('按书复习档案 · 分组', () => {
  it('划线卡按书名分组，章节数只算不同的', () => {
    const rows = bookSummariesOf([
      card('a', '围城', '第一章'),
      card('b', '围城', '第一章'),
      card('c', '围城', '第二章'),
      card('d', '活着', '第一章'),
    ], { now: NOW });
    expect(rows.map((r) => [r.book, r.total, r.chapters])).toEqual([
      ['围城', 3, 2],
      ['活着', 1, 1],
    ]);
  });

  it('笔记按所在文件夹分组，且不与同名书混在一起', () => {
    const rows = bookSummariesOf([
      card('a', '读书笔记', '第一章'),
      note('n', '读书笔记'),
    ], { now: NOW });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.kind).sort()).toEqual(['book', 'notes']);
  });

  it('缺书名的卡片和根目录笔记都有归属，不丢条目', () => {
    const rows = bookSummariesOf([
      card('a', '', ''),
      note('n', ''),
    ], { now: NOW });
    expect(rows.reduce((n, r) => n + r.total, 0)).toBe(2);
    expect(rows.every((r) => r.book.length > 0)).toBe(true);
  });

  it('空输入给空数组，不抛错', () => {
    expect(bookSummariesOf([], { now: NOW })).toEqual([]);
  });
});

describe('按书复习档案 · 派生口径', () => {
  it('平均留存率只统计能算的条目，算不出给 null 而不是 0', () => {
    const rows = bookSummariesOf([
      card('a', '书', '章', { phase: 'ladder', lastReviewed: null }),
      card('b', '书', '章', { phase: 'ladder', lastReviewed: null }),
    ], { now: NOW });
    expect(rows[0].avgR).toBeNull();
  });

  it('忘了率按评级口径算，四档评级各计一次', () => {
    const rows = bookSummariesOf([
      card('a', '书', '章', { reviewHistory: [{ rating: 'again', timestamp: '' }, { rating: 'good', timestamp: '' }] }),
      card('b', '书', '章', { reviewHistory: [{ rating: 'again', timestamp: '' }, { rating: 'easy', timestamp: '' }] }),
    ], { now: NOW });
    expect(rows[0].reviews).toBe(4);
    expect(rows[0].againRate).toBeCloseTo(0.5);
  });

  it('最容易忘的排在前面，给的是卡片名和留存率', () => {
    const rows = bookSummariesOf([
      card('牢的', '书', '章', { stability: 100, difficulty: 1 }),
      card('弱的', '书', '章', { stability: 1, difficulty: 9 }),
    ], { now: NOW });
    expect(rows[0].weak[0].name).toBe('弱的');
    expect(rows[0].strong[0].name).toBe('牢的');
  });

  it('已完成和挂起的条目仍在册，但不算在复习中', () => {
    const rows = bookSummariesOf([
      card('a', '书', '章'),
      card('b', '书', '章', { completed: true }),
    ], { now: NOW });
    expect(rows[0].total).toBe(2);
    expect(rows[0].active).toBe(1);
    expect(rows[0].done).toBe(1);
  });
});

describe('按书复习档案 · 报告导出', () => {
  it('Markdown 含分组名与三项关键指标，不出现 undefined/NaN', () => {
    const rows = bookSummariesOf([card('a', '围城', '第一章')], { now: NOW });
    const md = bookReportMarkdown(rows, { now: NOW });
    expect(md).toContain('围城');
    expect(md).toContain('留存率');
    expect(md).toContain('忘了率');
    expect(md).not.toMatch(/undefined|NaN/);
  });

  it('空档案也导出一句人话，不给空白文件', () => {
    expect(bookReportMarkdown([], { now: NOW })).toContain('还没有复习数据');
  });
});
