/**
 * 卡片列表短标题（2026-11-20）：同章十几张卡要分得清谁是谁。
 * 抽认卡取问句、做题卡取回填的题干、全文回忆取全文截断；长文本统一收口。
 */
import { describe, expect, it } from 'vitest';
import { cardTitleOf } from '../src/review/card-title';
import type { ReviewCard } from '../src/review/data';

function card(patch: Partial<ReviewCard> = {}): ReviewCard {
  return { key: 'reader:b1:h1', bookTitle: '围城', chapterTitle: '第一章', text: '婚姻是一座城', ...patch };
}

describe('cardTitleOf：按方式取短标题', () => {
  it('抽认卡用问句，不用书名·章节', () => {
    expect(cardTitleOf(card({ mode: 'flashcard', qa: { q: '方鸿渐是谁？', a: '主角', at: 1 } }))).toBe('方鸿渐是谁？');
  });

  it('做题卡用回填的第一题题干（题目在独立题库、卡上只读 displayTitle）', () => {
    expect(cardTitleOf(card({ mode: 'quiz', displayTitle: '关于孙柔嘉，正确的是？' }))).toBe('关于孙柔嘉，正确的是？');
  });

  it('全文回忆用全文截断，不带书名·章节', () => {
    const long = '城外的人想进去'.repeat(10);
    const got = cardTitleOf(card({ mode: 'plain', text: long }));
    expect(got).not.toContain('围城');
    expect(got.length).toBeLessThanOrEqual(41);
    expect(got.endsWith('…')).toBe(true);
  });

  it('长问句截断并补省略号，压掉多余空白', () => {
    const q = '这是一句很长很长的问句'.repeat(5);
    const got = cardTitleOf(card({ mode: 'flashcard', qa: { q, a: 'x', at: 1 } }));
    expect(got.length).toBeLessThanOrEqual(41);
    expect(got.endsWith('…')).toBe(true);
    expect(got).not.toContain('  ');
  });

  it('标题放宽到 40 字：三十来字的标题完整显示，不再被砍成 22 字', () => {
    const title = '关于孙柔嘉与方鸿渐的婚姻观，下列哪一项最符合作者的原意？';
    expect(title.length).toBeGreaterThan(22);
    expect(cardTitleOf(card({ mode: 'quiz', displayTitle: title }))).toBe(title);
  });

  it('老卡（无 qa / 无 displayTitle）回落到书名·章节', () => {
    expect(cardTitleOf(card())).toBe('围城 · 第一章');
  });

  it('缺书名时回落全文截断', () => {
    expect(cardTitleOf(card({ bookTitle: '', chapterTitle: '' }))).toBe('婚姻是一座城');
  });
});
