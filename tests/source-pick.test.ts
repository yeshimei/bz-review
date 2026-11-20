/**
 * 从阅读器选内容 · 纯逻辑（review/source-pick.ts）
 *
 * 搬的是原来 bz-reader 的「挑范围」：按划线全收 / AI 挑划线重点 /
 * AI 读章节挑句子，外加每章上限截断。ask 与 chapterText 注入，纯逻辑可测。
 */
import { describe, expect, it } from 'vitest';
import {
  aiCardKey,
  buildChapterCardPrompt,
  buildMarkPickPrompt,
  capSourcesPerChapter,
  markCardKey,
  markChapterGroups,
  parseChapterCards,
  parsePickedIds,
  pickedMarkStats,
  pickedMarks,
  resolvePick,
  type PickChapter,
  type PickMark,
} from '../src/review/source-pick';

const MARKS: PickMark[] = [
  { id: 'm1', chapterIndex: 0, chapterTitle: '一', text: '婚姻像城', comment: '钱钟书' },
  { id: 'm2', chapterIndex: 0, chapterTitle: '一', text: '城外想进去', comment: '' },
  { id: 'm3', chapterIndex: 1, chapterTitle: '二', text: '风景描写', comment: '' },
];
const CHAPTERS: PickChapter[] = [
  { index: 0, title: '一' },
  { index: 1, title: '二' },
];

describe('划线分组与统计', () => {
  it('按章分组：条数与字数（含想法）', () => {
    const groups = markChapterGroups(MARKS);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ index: 0, title: '一', count: 2 });
    expect(groups[0]!.chars).toBe(4 + 3 + 5);
  });

  it('选中章节的字数：只算勾中的组', () => {
    expect(pickedMarkStats(MARKS, ['0\u0001一'])).toEqual({ count: 2, chars: 12 });
  });

  it('选中章节的划线：保持原顺序', () => {
    expect(pickedMarks(MARKS, ['1\u0001二']).map((m) => m.id)).toEqual(['m3']);
  });
});

describe('按划线挑：提示词与解析', () => {
  it('提示词带上书名、章节、条数与想法', () => {
    const p = buildMarkPickPrompt('围城', '一', MARKS.slice(0, 2));
    expect(p).toContain('《围城》一');
    expect(p).toContain('一共 2 条');
    expect(p).toContain('我的想法：钱钟书');
    expect(p).toContain('{"keep": ["id1", "id2"]}');
  });

  it('解析：只认输入里存在的 id，编的丢掉', () => {
    expect(parsePickedIds('```json\n{"keep": ["m1", "m9", "m1"]}\n```', ['m1', 'm2'])).toEqual(['m1']);
  });

  it('解析不出来 = null（调用方保底全留）；明确空数组 = []', () => {
    expect(parsePickedIds('乱码', ['m1'])).toBeNull();
    expect(parsePickedIds('{"keep": []}', ['m1'])).toEqual([]);
  });
});

describe('按章节挑：提示词与解析', () => {
  it('limit=0 用区间建议；给了上限用「最多」', () => {
    expect(buildChapterCardPrompt('围城', '一', '正文')).toContain('短章 3~5 张');
    expect(buildChapterCardPrompt('围城', '一', '正文', 3)).toContain('最多出 3 张');
  });

  it('解析：text 与 q 必填、原文校验、同句只留一张', () => {
    const body = '第一句原文。\n\n第二句原文。';
    const reply = JSON.stringify({ cards: [
      { text: '第一句原文。', q: '问一', a: '答一' },
      { text: '第一句原文。', q: '问二', a: '答二' },
      { text: '编的句子。', q: '问三', a: '答三' },
      { text: '第二句原文。', q: '', a: '答四' },
    ] });
    expect(parseChapterCards(reply, body)).toEqual([{ text: '第一句原文。', q: '问一', a: '答一' }]);
  });
});

describe('resolvePick：内容来源 → 制卡来源', () => {
  it('按划线全收：钥匙带划线 id，书名与章节跟着走', async () => {
    const out = await resolvePick('marks', {
      bookId: 'b', bookTitle: '围城', marks: MARKS, chapters: CHAPTERS,
      ask: async () => '', chapterText: async () => '',
    });
    expect(out).toHaveLength(3);
    expect(out[0]!.key).toBe(markCardKey('b', 'm1'));
    expect(out[0]!.text).toBe('婚姻像城');
    expect(out[0]!.chapterTitle).toBe('一');
    expect(out[0]!.comment).toBe('钱钟书');
  });

  it('划线重点：AI 说保留哪些，只收这些', async () => {
    const out = await resolvePick('marksKey', {
      bookId: 'b', bookTitle: '围城', marks: MARKS, chapters: CHAPTERS,
      ask: async () => JSON.stringify({ keep: ['m1'] }), chapterText: async () => '',
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.key).toBe(markCardKey('b', 'm1'));
  });

  it('划线重点：AI 解析失败保底全留', async () => {
    const out = await resolvePick('marksKey', {
      bookId: 'b', bookTitle: '围城', marks: MARKS, chapters: CHAPTERS,
      ask: async () => '乱码', chapterText: async () => '',
    });
    expect(out).toHaveLength(3);
  });

  it('按章节挑：逐章读正文，每句一张，钥匙按书+章+句', async () => {
    const out = await resolvePick('chaptersKey', {
      bookId: 'b', bookTitle: '围城', marks: [], chapters: CHAPTERS,
      ask: async () => JSON.stringify({ cards: [{ text: '城里的句子', q: '问', a: '答' }] }),
      chapterText: async (i) => (i === 0 ? '城里的句子和别的正文' : ''),
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.key).toBe(aiCardKey('b', '一', '城里的句子'));
    expect(out[0]!.chapterTitle).toBe('一');
  });

  it('按章节挑：空正文章节跳过，不影响其他章节', async () => {
    const out = await resolvePick('chaptersKey', {
      bookId: 'b', bookTitle: '围城', marks: [], chapters: CHAPTERS,
      ask: async () => JSON.stringify({ cards: [] }), chapterText: async () => '',
    });
    expect(out).toHaveLength(0);
  });

  it('按章节挑：AI 编的原文（正文里没有）不收', async () => {
    const out = await resolvePick('chaptersKey', {
      bookId: 'b', bookTitle: '围城', marks: [], chapters: [CHAPTERS[0]!],
      ask: async () => JSON.stringify({ cards: [{ text: '编的句子', q: '问', a: '答' }] }),
      chapterText: async () => '正文里根本没有这句',
    });
    expect(out).toHaveLength(0);
  });
});

describe('capSourcesPerChapter：每章上限', () => {
  const SOURCES = [
    { key: 'a', text: 'a', bookTitle: '书', chapterTitle: '一' },
    { key: 'b', text: 'b', bookTitle: '书', chapterTitle: '一' },
    { key: 'c', text: 'c', bookTitle: '书', chapterTitle: '一' },
    { key: 'd', text: 'd', bookTitle: '书', chapterTitle: '二' },
  ];

  it('limit=0 不截断', () => {
    expect(capSourcesPerChapter(SOURCES, 0)).toHaveLength(4);
  });

  it('limit=2 每章留前 2 条', () => {
    expect(capSourcesPerChapter(SOURCES, 2).map((s) => s.key)).toEqual(['a', 'b', 'd']);
  });

  it('没章节名的自成一章', () => {
    const mixed = [
      { key: 'x', text: 'x', bookTitle: '书' },
      { key: 'y', text: 'y', bookTitle: '书' },
      { key: 'z', text: 'z', bookTitle: '书', chapterTitle: '一' },
    ];
    expect(capSourcesPerChapter(mixed, 1).map((s) => s.key)).toEqual(['x', 'z']);
  });

  it('负数按不限制处理，不改输入数组', () => {
    const copy = [...SOURCES];
    expect(capSourcesPerChapter(SOURCES, -1)).toHaveLength(4);
    expect(SOURCES).toEqual(copy);
  });
});
