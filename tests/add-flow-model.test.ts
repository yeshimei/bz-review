import { describe, expect, it } from 'vitest';
import {
  AI_TEXT_LIMIT,
  addHappened,
  addSummaryText,
  clipForAI,
  folderNotePaths,
  noteSourceOf,
  noteWholeKey,
  silentModeOf,
} from '../src/review/add-flow-model';

/**
 * 「加入复习」统一流程的纯口径（2026-11-21 用户拍板：任何入口都走同一条流程）。
 * 这里只守不依赖宿主的部分：钥匙稳定、正文截断、文件夹候选、静默判定、话术统一。
 */
describe('整篇笔记的钥匙', () => {
  it('只认路径，带 note: 前缀', () => {
    expect(noteWholeKey('notes/读书.md')).toBe('note:notes/读书.md');
  });

  it('正文改了钥匙也不变（不能因为字数变了算成另一条）', () => {
    expect(noteWholeKey('notes/读书.md')).toBe(noteWholeKey('notes/读书.md'));
  });

  it('空路径不给钥匙', () => {
    expect(noteWholeKey('')).toBe('');
    expect(noteWholeKey('   ')).toBe('');
  });
});

describe('一篇笔记 → 一条来源', () => {
  it('整篇正文进卡，出处记成全文范围', () => {
    const src = noteSourceOf('notes/读书.md', '读书', '第一段\n第二段');
    expect(src?.key).toBe('note:notes/读书.md');
    expect(src?.bookTitle).toBe('读书');
    expect(src?.text).toBe('第一段\n第二段');
    expect(src?.sourceNote).toEqual({ path: 'notes/读书.md', from: 0, to: '第一段\n第二段'.length });
  });

  it('空笔记不造卡', () => {
    expect(noteSourceOf('notes/空.md', '空', '')).toBeNull();
    expect(noteSourceOf('notes/空白.md', '空白', '  \n\t ')).toBeNull();
  });

  it('超长正文只截断给模型看的那份，卡上仍是全文', () => {
    const long = '字'.repeat(AI_TEXT_LIMIT + 500);
    const src = noteSourceOf('notes/长.md', '长', long);
    expect(src?.text).toBe(long);
    expect(Array.from(src?.aiText ?? '').length).toBe(AI_TEXT_LIMIT);
  });

  it('没超长就不带 aiText（与 text 同源，别多存一份）', () => {
    const src = noteSourceOf('notes/短.md', '短', '一句');
    expect(src?.aiText).toBeUndefined();
  });

  it('标题缺省时用文件名兜底', () => {
    const src = noteSourceOf('notes/无名.md', '', '正文');
    expect(src?.bookTitle).toBe('无名.md');
  });

  it('frontmatter 不算正文：卡上去掉，跳转范围跳过它', () => {
    const raw = '---\ntags: [读书]\nstatus: 在读\n---\n第一段';
    const src = noteSourceOf('notes/带元数据.md', '带元数据', raw);
    expect(src?.text).toBe('第一段');
    expect(src?.sourceNote?.from).toBe(raw.length - '第一段'.length);
    expect(src?.sourceNote?.to).toBe(raw.length);
  });

  it('只有 frontmatter 的空笔记不造卡', () => {
    expect(noteSourceOf('notes/空.md', '空', '---\ntags: []\n---\n')).toBeNull();
  });
});

describe('给模型看的截断', () => {
  it('短文本原样返回', () => {
    expect(clipForAI('一二三', 5)).toEqual({ text: '一二三', clipped: false });
  });

  it('长文本截到上限并标记', () => {
    const out = clipForAI('一二三四五六', 4);
    expect(out).toEqual({ text: '一二三四', clipped: true });
  });

  it('按字符算，不把 emoji 劈成半个', () => {
    const out = clipForAI('😀😀😀😀', 2);
    expect(out.text).toBe('😀😀');
  });
});

describe('文件夹里的候选笔记', () => {
  const paths = ['notes/a.md', 'notes/b.md', 'notes/sub/c.md', 'notes/img.png', 'notes2/d.md'];

  it('递归收子目录，只认 .md', () => {
    expect(folderNotePaths(paths, 'notes')).toEqual(['notes/a.md', 'notes/b.md', 'notes/sub/c.md']);
  });

  it('前缀边界不能把 notes2 收进来', () => {
    expect(folderNotePaths(paths, 'notes').includes('notes2/d.md')).toBe(false);
  });

  it('库根（空 folder）收全部 md', () => {
    expect(folderNotePaths(paths, '')).toEqual(['notes/a.md', 'notes/b.md', 'notes/sub/c.md', 'notes2/d.md']);
  });

  it('大小写不敏感', () => {
    expect(folderNotePaths(['notes/a.MD'], 'notes')).toEqual(['notes/a.MD']);
  });
});

describe('「不用每次询问」的判据', () => {
  it('每次问我 → null，必须走界面', () => {
    expect(silentModeOf(null)).toBeNull();
  });

  it('设了具体方式 → 直接用那个方式，不再问', () => {
    expect(silentModeOf('flashcard')).toBe('flashcard');
    expect(silentModeOf('plain')).toBe('plain');
  });
});

describe('入库结果话术', () => {
  it('有新增时说加了几条', () => {
    expect(addSummaryText({ added: 3, exists: 0, notFound: 0 })).toBe('已加入 3 条');
  });

  it('全都在计划里时说明白，而不是「加了 0 条」', () => {
    expect(addSummaryText({ added: 0, exists: 2, notFound: 0 })).toBe('这 2 条已经在复习计划里了');
  });

  it('混合结果一条话说清', () => {
    expect(addSummaryText({ added: 2, exists: 1, notFound: 1 })).toBe('已加入 2 条，1 条本来就在计划里，1 条找不到');
  });

  it('超额单独说，不混进「找不到」', () => {
    expect(addSummaryText({ added: 0, exists: 0, notFound: 0, rejected: 4 })).toBe('4 条超出基础版上限');
  });

  it('什么都没有时不拼空话', () => {
    expect(addSummaryText({ added: 0, exists: 0, notFound: 0 })).toBe('没有可加入的内容');
  });

  it('通知是否用成功色只看真的加进去没有', () => {
    expect(addHappened({ added: 1, exists: 0, notFound: 0 })).toBe(true);
    expect(addHappened({ added: 0, exists: 3, notFound: 0 })).toBe(false);
  });
});
