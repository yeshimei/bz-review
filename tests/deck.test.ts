import { describe, expect, it } from 'vitest';
import { applyFilter, collectFacets, deckOf, describeFilter, isEmptyFilter } from '../src/review/deck';

const note = (path: string, extra: Record<string, unknown> = {}) => ({
  id: path,
  filePath: path,
  name: path.split('/').pop()?.replace(/\.md$/, '') ?? path,
  stage: 1,
  phase: 'ladder' as const,
  reviewHistory: [],
  reviewStart: '2026-11-01T00:00:00.000Z',
  totalReviews: 2,
  ...extra,
});

const card = (key: string, book: string, text: string) => ({
  ...note(key),
  kind: 'card' as const,
  card: { key, bookTitle: book, text },
});

describe('牌组', () => {
  it('笔记按文件夹分，划线卡按书名分（不新造一套分组表）', () => {
    expect(deckOf(note('课程/数学/第一章.md') as any)).toBe('课程/数学');
    expect(deckOf(note('零散笔记.md') as any)).toBe('根目录');
    expect(deckOf(card('reader:b:1', '围城', '句子') as any)).toBe('围城');
  });

  it('汇总出牌组与标签，按条数从多到少', () => {
    const items = [note('A/1.md'), note('A/2.md'), note('B/1.md'), card('reader:a:b', '某书', 'x')] as any[];
    const tags = new Map([['A/1.md', ['数学']], ['A/2.md', ['数学']]]);
    const f = collectFacets(items, tags);
    expect(f.decks[0]).toBe('A');
    expect(f.decks).toContain('B');
    expect(f.decks).toContain('某书');
    expect(f.tags[0]).toBe('#数学');
  });
});

describe('筛选', () => {
  const items = [
    note('课程/数学/笔记.md'),
    note('课程/英语/笔记.md'),
    card('reader:b:1', '围城', '这一句是关于方鸿渐的'),
  ] as any[];

  it('按关键字匹配标题、路径、卡片原文（大小写不敏感）', () => {
    expect(applyFilter(items, { query: '方鸿渐' }).map((i) => i.id)).toEqual(['reader:b:1']);
    expect(applyFilter(items, { query: '数学' })).toHaveLength(1);
  });

  it('按类型、按牌组过滤', () => {
    expect(applyFilter(items, { kind: 'card' })).toHaveLength(1);
    expect(applyFilter(items, { kind: 'note' })).toHaveLength(2);
    expect(applyFilter(items, { deck: '课程/英语' })).toHaveLength(1);
  });

  it('空筛选等于不筛（不能把「没填」当成「匹配不到」）', () => {
    expect(applyFilter(items, {})).toHaveLength(3);
    expect(applyFilter(items, { query: '   ', kind: 'all', deck: '' })).toHaveLength(3);
  });

  it('空筛选判定与描述一致，状态条上不会出现「筛选中：」后面什么都没有', () => {
    expect(isEmptyFilter({})).toBe(true);
    expect(isEmptyFilter({ query: 'a' })).toBe(false);
    expect(describeFilter({ deck: '课程/数学', kind: 'card', query: '极限' })).toBe('课程/数学 · 只看划线 · 含「极限」');
    expect(describeFilter({})).toBe('');
  });
});
