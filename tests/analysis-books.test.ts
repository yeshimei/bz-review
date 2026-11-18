/**
 * 按书档案 + 卡片管理器的功能接线测试。
 *
 * 纯层（book-summary / card-manager）另有单测；这里盯的是接线：
 * 渲染视图的字段与按钮、queue.active() 的隐藏口径、deck 的 hidden 筛选、
 * 高级档入口门控，以及新字段不会被 store-format 剥掉。
 */
import { describe, expect, it } from 'vitest';
import { bookSummariesOf } from '../src/review/book-summary';
import { booksViewHtml, managerViewHtml } from '../src/review/render';
import { DEFAULT_R_THRESHOLD, forecastLoad, partitionQueue, roundQueue } from '../src/review/queue';
import { applyFilter, matchesQuery } from '../src/review/deck';
import { stripRuntime } from '../src/review/store-format';
import { DEFAULT_W } from '../src/review/fsrs';
import { canUseCapability, capabilityBlock } from '../src/data/entitlement';
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
    nextReviewDate: '2026-11-20T00:00:00.000Z',
    reviewHistory: [],
    ...opts,
  } as unknown as ReviewItem;
}

describe('按书档案视图', () => {
  it('列出书名、张数、章节数、留存率、忘了率、逾期与最容易忘 / 记得最牢', () => {
    const rows = bookSummariesOf(
      [
        card('a', '围城', '第一章', { reviewHistory: [{ rating: 'again', timestamp: '' }, { rating: 'good', timestamp: '' }] }),
        card('b', '围城', '第二章'),
      ],
      { now: NOW }
    );
    const html = booksViewHtml(rows, { now: NOW.getTime() });
    expect(html).toContain('围城');
    expect(html).toContain('张卡');
    expect(html).toContain('章节');
    expect(html).toContain('平均留存率');
    expect(html).toContain('忘了率');
    expect(html).toContain('逾期');
    expect(html).toContain('最容易忘');
    expect(html).toContain('记得最牢');
    expect(html).not.toMatch(/undefined|NaN/);
  });

  it('中文书名排序走 Collator(zh-CN)：阿Q < 活着 < 围城', () => {
    const rows = bookSummariesOf(
      [card('a', '围城', '章'), card('b', '活着', '章'), card('c', '阿Q正传', '章')],
      { now: NOW }
    );
    const html = booksViewHtml(rows, { now: NOW.getTime() });
    expect(html.indexOf('阿Q正传')).toBeLessThan(html.indexOf('活着'));
    expect(html.indexOf('活着')).toBeLessThan(html.indexOf('围城'));
  });

  it('空库给空态文案，不渲染只有表头的空表', () => {
    const html = booksViewHtml([], { now: NOW.getTime() });
    expect(html).toContain('还没有复习数据');
    expect(html).not.toContain('bzrv-book-group');
  });
});

describe('卡片管理器视图', () => {
  const items = [card('a', '围城', '第一章'), { ...card('n', '', '', {}), kind: 'note', filePath: '课程/笔记.md', card: undefined } as unknown as ReviewItem];

  it('搜索框 + 按书/类型/状态筛选 + 每行五个动作齐全', () => {
    const html = managerViewHtml(items, { now: NOW.getTime(), decks: ['围城', '课程'] });
    for (const fld of ['mgr-q', 'mgr-kind', 'mgr-deck', 'mgr-status']) {
      expect(html).toContain(`data-fld="${fld}"`);
    }
    for (const act of ['mgr-suspend', 'mgr-bury', 'mgr-restore', 'mgr-schedule', 'mgr-delete']) {
      expect(html).toContain(`data-act="${act}"`);
    }
    expect(html).toContain('围城');
    expect(html).toContain('课程');
  });

  it('纯图标控件用 bzrv-sr-only 藏名字，不挂悬停气泡属性', () => {
    const html = managerViewHtml(items, { now: NOW.getTime() });
    expect(html).toContain('bzrv-sr-only');
    expect(html).not.toMatch(/aria-label|setTooltip|\stitle=/);
  });

  it('挂起 / 埋藏状态在行上标出来；空库与筛空各有空态', () => {
    const suspended = card('s', '围城', '章', { suspended: true });
    const html = managerViewHtml([suspended], { now: NOW.getTime() });
    expect(html).toContain('已挂起');
    expect(html).toContain('is-suspended');
    expect(managerViewHtml([], { now: NOW.getTime() })).toContain('还没有卡片或笔记');
    expect(managerViewHtml(items, { now: NOW.getTime(), filter: { query: '不存在' } })).toContain('没有符合筛选');
  });
});

describe('隐藏口径统一（三区列 / 本轮队列 / 负荷预测）', () => {
  const hidden = card('h', '围城', '章', {
    suspended: true,
    nextReviewDate: '2026-11-01T00:00:00.000Z',
    isOverdue: true,
  });
  const buried = card('b', '围城', '章', {
    buriedUntil: '2099-01-01T00:00:00.000Z',
    nextReviewDate: '2026-11-01T00:00:00.000Z',
    isOverdue: true,
  });
  const normal = card('n', '围城', '章', {
    nextReviewDate: '2026-11-01T00:00:00.000Z',
    isOverdue: true,
  });
  const all = [hidden, buried, normal];

  it('挂起 / 埋藏不进逾期列，落 done 桶', () => {
    const cols = partitionQueue(all, DEFAULT_R_THRESHOLD, DEFAULT_W);
    expect(cols.overdue.map((i) => i.id)).toEqual(['n']);
    expect(cols.done.map((i) => i.id)).toEqual(['h', 'b']);
  });

  it('本轮队列与负荷预测一次性同口径', () => {
    expect(roundQueue(all, DEFAULT_R_THRESHOLD, DEFAULT_W).map((i) => i.id)).toEqual(['n']);
    const load = forecastLoad(all, 30, new Date('2026-11-01T00:00:00.000Z'));
    expect(load.reduce((s, p) => s + p.count, 0)).toBe(1);
  });

  it('状态筛新增 hidden：只看隐藏，且隐藏项不混进逾期', () => {
    expect(applyFilter(all, { status: 'hidden' }).map((i) => i.id)).toEqual(['h', 'b']);
    expect(applyFilter(all, { status: 'overdue' }).map((i) => i.id)).toEqual(['n']);
  });

  it('搜索函数已导出，短语命中书名、乱串不命中', () => {
    expect(matchesQuery(normal, '围城')).toBe(true);
    expect(matchesQuery(normal, '不存在的书')).toBe(false);
  });
});

describe('新字段持久化与高级档门控', () => {
  it('suspended / buriedUntil 不在运行时字段表里，写盘不会被剥掉', () => {
    const it = {
      id: 'a',
      filePath: 'a.md',
      name: 'a',
      suspended: true,
      buriedUntil: '2099-01-01T00:00:00.000Z',
      isOverdue: true,
    };
    const out = stripRuntime(it) as Record<string, any>;
    expect(out.suspended).toBe(true);
    expect(out.buriedUntil).toBe('2099-01-01T00:00:00.000Z');
    expect(out.isOverdue).toBeUndefined();
  });

  it('bookReport / cardManager 全部放开，基础版也能用', () => {
    expect(canUseCapability('bookReport')).toBe(true);
    expect(canUseCapability('cardManager')).toBe(true);
    expect(capabilityBlock('bookReport').ok).toBe(true);
    expect(capabilityBlock('cardManager').ok).toBe(true);
  });
});
