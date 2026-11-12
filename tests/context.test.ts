import { describe, expect, it } from 'vitest';
import { contextOf, contextPromptOf, hasRealContext, whereOf } from '../src/review/context';
import type { ReviewCard } from '../src/review/data';

const base = (patch: Partial<ReviewCard> = {}): ReviewCard => ({
  key: 'reader:book:hl',
  bookTitle: '平凡的世界',
  chapterTitle: '第一章',
  text: '他蹲在矿井口，看着天一点点亮起来。',
  ...patch,
});

describe('上下文卡：有没有真上下文', () => {
  it('有前文就算有', () => {
    expect(hasRealContext(base({ context: { before: '前一天夜里下了雨。' } }))).toBe(true);
  });

  it('有后文也算有', () => {
    expect(hasRealContext(base({ context: { after: '井架上的灯还亮着。' } }))).toBe(true);
  });

  it('前后都是空串不算', () => {
    expect(hasRealContext(base({ context: { before: '  ', after: '' } }))).toBe(false);
  });

  it('老卡片没有 context 字段不算', () => {
    expect(hasRealContext(base())).toBe(false);
  });
});

describe('上下文卡：取前后文', () => {
  it('原样取出并去掉多余空白', () => {
    const c = contextOf(base({ context: { before: '前一天   夜里下了雨。', after: '井架上的灯还亮着。' } }));
    expect(c?.before).toBe('前一天 夜里下了雨。');
    expect(c?.after).toBe('井架上的灯还亮着。');
  });

  it('过长时前文留结尾、后文留开头', () => {
    const long = '甲'.repeat(300);
    const c = contextOf(base({ context: { before: long, after: long } }));
    expect(c?.before.startsWith('…')).toBe(true);
    expect(c?.before.endsWith('甲')).toBe(true);
    expect(c?.after.endsWith('…')).toBe(true);
    expect(Array.from(c?.after ?? '').length).toBeLessThanOrEqual(161);
  });

  it('没有上下文返回 null', () => {
    expect(contextOf(base())).toBeNull();
  });
});

describe('上下文卡：提示面', () => {
  it('有前后文时走真上下文，划线不出现在提示面', () => {
    const p = contextPromptOf(
      base({ context: { before: '前一天夜里下了雨。', after: '井架上的灯还亮着。' } })
    );
    expect(p.real).toBe(true);
    expect(p.before).toBe('前一天夜里下了雨。');
    expect(p.after).toBe('井架上的灯还亮着。');
    expect(p.lead).not.toContain('矿井口');
  });

  it('没有前后文但有想法时，用想法当提示', () => {
    const p = contextPromptOf(base({ comment: '这里像在写黎明前的等待。' }));
    expect(p.real).toBe(false);
    expect(p.hint).toBe('这里像在写黎明前的等待。');
    expect(p.where).toBe('平凡的世界 · 第一章');
  });

  it('什么都没有时只剩出处', () => {
    const p = contextPromptOf(base());
    expect(p.real).toBe(false);
    expect(p.hint).toBe('');
    expect(p.where).toContain('平凡的世界');
  });

  it('没有章节时出处只有书名', () => {
    expect(whereOf(base({ chapterTitle: undefined }))).toBe('平凡的世界');
  });

  it('提示面里不能出现划线原文（否则等于把答案念出来）', () => {
    const text = '他蹲在矿井口，看着天一点点亮起来。';
    for (const card of [
      base({ context: { before: '前一天夜里下了雨。' } }),
      base({ comment: '想起海明威' }),
      base(),
    ]) {
      const p = contextPromptOf(card);
      const shown = [p.lead, p.before, p.after, p.where, p.hint].join('');
      expect(shown).not.toContain('矿井口');
      expect(shown).not.toContain('一点点亮起来');
    }
  });
});
