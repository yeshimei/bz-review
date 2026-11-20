/**
 * 外部交来的卡片（review/card-input.ts 的 normalizeCardInput）
 *
 * 2026-11-16 起，阅读器那边可以「把题也出好」再交过来。三条口径要钉住：
 *   1. 带了 qa 的卡，题面原样保留，只补生成时间
 *   2. 空问句当作没给（走原来的生成路径），空答案退回原文（背面不能空着）
 *   3. 空钥匙 / 空原文一律不收
 */
import { describe, expect, it } from 'vitest';
import { keysWithQa, normalizeCardInput } from '../src/review/card-input';
import { withoutPrepared } from '../src/review/reader-input';

describe('normalizeCardInput：外部交来的卡片', () => {
  it('qa 原样保留，并补上生成时间', () => {
    const card = normalizeCardInput(
      {
        key: 'reader:book1:h1',
        bookTitle: '围城',
        chapterTitle: '第一章',
        text: '红海早过了，船在印度洋面上开驶着。',
        qa: { q: '故事开始时，船正开到哪片洋面？', a: '印度洋。' },
      },
      1700000000000,
    );
    expect(card).not.toBeNull();
    expect(card!.qa).toEqual({ q: '故事开始时，船正开到哪片洋面？', a: '印度洋。', at: 1700000000000 });
    expect(card!.chapterTitle).toBe('第一章');
    expect(card!.bookTitle).toBe('围城');
  });

  it('没带 qa 的卡就没有 qa 字段（走原来的生成路径）', () => {
    const card = normalizeCardInput({ key: 'reader:b:h1', bookTitle: '书', text: '甲' });
    expect(card!.qa).toBeUndefined();
  });

  it('空问句当作没给', () => {
    const card = normalizeCardInput({ key: 'reader:b:h1', bookTitle: '书', text: '甲', qa: { q: '   ', a: '甲' } });
    expect(card!.qa).toBeUndefined();
  });

  it('答案为空时退回原文，不留空背面', () => {
    const card = normalizeCardInput({ key: 'reader:b:h1', bookTitle: '书', text: '原文在这', qa: { q: '问题一是什么？', a: '  ' } });
    expect(card!.qa!.a).toBe('原文在这');
  });

  it('自带挖空空位：原样收下（用户手工挖的不能被后台重生成覆盖）', () => {
    const card = normalizeCardInput({
      key: 'reader:b:h1',
      bookTitle: '书',
      text: '婚姻像一座城。',
      mode: 'cloze',
      cloze: { text: '婚姻像{{1}}城。', blanks: ['一座'] },
    }, 1700000000000);
    expect(card!.cloze).toEqual({ text: '婚姻像{{1}}城。', blanks: ['一座'], at: 1700000000000 });
  });

  it('挖空标记不合法就不收，退回后台生成（宁可从原文重出，也不存坏卡）', () => {
    const card = normalizeCardInput({
      key: 'reader:b:h1',
      bookTitle: '书',
      text: '婚姻像一座城。',
      mode: 'cloze',
      cloze: { text: '婚姻像{{2}}城。', blanks: ['一座'] },
    });
    expect(card!.cloze).toBeUndefined();
  });

  it('带着挖空的卡不进后台补题队列', () => {
    const cards = [{
      key: 'reader:b:h1',
      text: '婚姻像一座城。',
      cloze: { text: '婚姻像{{1}}城。', blanks: ['一座'] },
    }];
    expect(withoutPrepared(['reader:b:h1'], cards)).toEqual([]);
  });

  it('空钥匙或空原文一律不收', () => {
    expect(normalizeCardInput({ key: '', bookTitle: '书', text: '甲' })).toBeNull();
    expect(normalizeCardInput({ key: 'reader:b:h1', bookTitle: '书', text: '   ' })).toBeNull();
    expect(normalizeCardInput(null as any)).toBeNull();
  });

  it('想法、回链、上下文原样带过去', () => {
    const card = normalizeCardInput({
      key: 'reader:b:h1',
      bookTitle: '书',
      text: '甲',
      comment: '我当时的想法',
      backlink: 'obsidian://bz-reader?book=b&cfi=x',
      context: { before: '前文', after: '后文' },
    });
    expect(card!.comment).toBe('我当时的想法');
    expect(card!.backlink).toBe('obsidian://bz-reader?book=b&cfi=x');
    expect(card!.context).toEqual({ before: '前文', after: '后文' });
  });
});

describe('keysWithQa：哪些卡不用再排队生成', () => {
  it('只挑出带 qa 的钥匙', () => {
    const cards = [
      normalizeCardInput({ key: 'a', bookTitle: '书', text: '甲', qa: { q: '问题一是什么？', a: '甲' } }),
      normalizeCardInput({ key: 'b', bookTitle: '书', text: '乙' }),
    ].filter((c): c is NonNullable<typeof c> => c !== null);
    expect(Array.from(keysWithQa(cards))).toEqual(['a']);
  });
});
