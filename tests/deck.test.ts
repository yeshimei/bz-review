import { describe, expect, it } from 'vitest';
import { applyFilter, collectFacets, deckOf, describeFilter, isEmptyFilter, tagsOf } from '../src/review/deck';

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

const card = (key: string, book: string, text: string, extra: Record<string, unknown> = {}) => ({
  ...note(key),
  kind: 'card' as const,
  card: { key, bookTitle: book, text },
  ...extra,
});

describe('牌组', () => {
  it('笔记按文件夹分，划线卡按书名分（不新造一套分组表）', () => {
    expect(deckOf(note('课程/数学/第一章.md') as any)).toBe('课程/数学');
    expect(deckOf(note('零散笔记.md') as any)).toBe('根目录');
    expect(deckOf(card('reader:b:1', '围城', '句子') as any)).toBe('围城');
  });

  it('自建牌组优先于自动推导；没填才按文件夹/书名', () => {
    expect(deckOf(note('课程/数学/第一章.md', { deck: '高考冲刺' }) as any)).toBe('高考冲刺');
    expect(deckOf(card('reader:b:1', '围城', '句子', { deck: '现代文学' }) as any)).toBe('现代文学');
    expect(deckOf(note('课程/数学/第一章.md') as any)).toBe('课程/数学');
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

  it('按 #标签筛选：自建 tags 与 Obsidian 元数据标签都能命中（旧代码这里全过滤光）', () => {
    const tagged = [
      note('a.md', { tags: ['数学', '重点'] }),
      note('b.md', { metaTags: ['数学'] }),
      note('c.md', { tags: ['英语'] }),
    ] as any[];
    expect(applyFilter(tagged, { deck: '#数学' }).map((i) => i.id)).toEqual(['a.md', 'b.md']);
    expect(applyFilter(tagged, { deck: '#英语' }).map((i) => i.id)).toEqual(['c.md']);
    expect(applyFilter(tagged, { deck: '#不存在' })).toHaveLength(0);
  });

  it('关键字也能搜到标签', () => {
    expect(applyFilter([note('a.md', { tags: ['冷门标签'] })] as any[], { query: '冷门标签' })).toHaveLength(1);
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

  /* 「状态」下拉以前是空转的：能选、能显示，但 applyFilter 不看它 —— 用户选完
     列表一点变化都没有。这里按三区列同一套口径钉住三种状态。 */
  it('按状态筛：走三区列的口径，逾期 / 今天 / 未来各取各的', () => {
    const now = Date.now();
    const day = 86400000;
    const items = [
      note('逾期.md', { nextReviewDate: new Date(now - 2 * day).toISOString() }),
      note('今天.md', { nextReviewDate: new Date(now + 60_000).toISOString() }),
      note('未来.md', { nextReviewDate: new Date(now + 5 * day).toISOString() }),
    ] as any[];
    expect(applyFilter(items, { status: 'overdue' }).map((i) => i.name)).toEqual(['逾期']);
    expect(applyFilter(items, { status: 'today' }).map((i) => i.name)).toEqual(['今天']);
    expect(applyFilter(items, { status: 'future' }).map((i) => i.name)).toEqual(['未来']);
    expect(applyFilter(items, { status: 'all' })).toHaveLength(3);
  });

  it('自建 tags 与运行时 metaTags 合并去重，去掉 #', () => {
    expect(tagsOf(note('a.md', { tags: ['数学', '#重点'], metaTags: ['重点', '英语'] }) as any)).toEqual([
      '数学',
      '重点',
      '英语',
    ]);
  });

  it('collectFacets 把条目自建标签也算进候选', () => {
    const f = collectFacets([note('a.md', { tags: ['数学'] }), note('b.md', { tags: ['数学', '英语'] })] as any[]);
    expect(f.tags).toContain('#数学');
    expect(f.tags[0]).toBe('#数学');
  });

  it('状态与关键字叠加：先按关键字挑，再按状态挑', () => {
    const now = Date.now();
    const day = 86400000;
    const items = [
      note('课程/数学/逾期.md', { nextReviewDate: new Date(now - day).toISOString() }),
      note('课程/数学/未来.md', { nextReviewDate: new Date(now + 3 * day).toISOString() }),
      note('课程/英语/逾期.md', { nextReviewDate: new Date(now - day).toISOString() }),
    ] as any[];
    expect(applyFilter(items, { query: '数学', status: 'overdue' }).map((i) => i.name)).toEqual(['逾期']);
  });
});
