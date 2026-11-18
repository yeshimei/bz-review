/**
 * 跳回原文的兜底：Reader 老版本推来的卡没有 backlink，
 * 用卡片 key（reader:<bookId>:<highlightId>）现造一条跳书链接，不让按钮消失。
 */
import { describe, expect, it } from 'vitest';
import { backlinkOfCard, bookIdOfCardKey } from '../src/review/reader-jump';

describe('Reader 卡片 key 解析', () => {
  it('从 reader:<bookId>:<highlightId> 取出书 id', () => {
    expect(bookIdOfCardKey('reader:book-test-1:h3/h4/h5')).toBe('book-test-1');
  });

  it('不是 Reader 卡就不硬猜', () => {
    expect(bookIdOfCardKey('CONFIG/读书笔记.md')).toBeNull();
    expect(bookIdOfCardKey('reader:book-test-1')).toBeNull();
    expect(bookIdOfCardKey('')).toBeNull();
  });
});

describe('跳回原文链接兜底', () => {
  const build = (id: string, target: { text?: string; chapter?: string }) =>
    `obsidian://bz-reader?book=${id}&t=${target.text ?? ''}&c=${target.chapter ?? ''}`;

  it('卡上已有 backlink 就原样用，不重新拼', () => {
    expect(backlinkOfCard({ key: 'reader:b:h', backlink: 'obsidian://custom' }, build)).toBe('obsidian://custom');
  });

  it('没有 backlink 时用 key 兜底，并把原文片段截到 20 字', () => {
    const text = '这是一段很长很长的原文'.repeat(5);
    const url = backlinkOfCard(
      { key: 'reader:book-1:h1', text, chapterTitle: '第二章' },
      build,
    );
    expect(url).toContain('book=book-1');
    expect(url).toContain('c=第二章');
    expect(url.split('&t=')[1].split('&')[0].length).toBeLessThanOrEqual(20);
  });

  it('既没 backlink 也不是 Reader 卡，返回空串让按钮不显示', () => {
    expect(backlinkOfCard({ key: 'CONFIG/note.md', text: '原文' }, build)).toBe('');
  });
});
