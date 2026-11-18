/**
 * Reader → Review 联动字段（review/card-input.ts）
 *
 * 阅读器三选一制卡时已经决定了方式，并可能把题出好一起交过来。这两个字段
 * 只要在归一化层丢掉，复习那边就会：用全局默认方式重盖这张卡、把出好的题
 * 再生成一遍。真机上表现为「选了填空却在看原文」「选了做题却没题做」。
 */
import { describe, expect, it } from 'vitest';
import { normalizeCardInput, normalizeQuestions } from '../src/review/card-input';

describe('联动 · 复习方式跟着卡走', () => {
  const base = { key: 'reader:b:h1', bookTitle: '书', text: '划线原文' };

  it.each(['flashcard', 'quiz', 'cloze', 'context', 'plain'] as const)(
    'Reader 指定的方式 %s 原样落进卡里',
    (mode) => {
      expect(normalizeCardInput({ ...base, mode })?.mode).toBe(mode);
    },
  );

  it('没有指定方式时不写字段，交给盖章逻辑', () => {
    expect(normalizeCardInput(base)?.mode).toBeUndefined();
  });

  it('脏值不写进卡，不让复习时落到未知分支', () => {
    expect(normalizeCardInput({ ...base, mode: 'unknown' as never })?.mode).toBeUndefined();
  });

  it('已经出好题的卡：题面与方式同时保留', () => {
    const card = normalizeCardInput({
      ...base,
      mode: 'flashcard',
      qa: { q: '问句？', a: '答案' },
    });
    expect(card?.mode).toBe('flashcard');
    expect(card?.qa?.q).toBe('问句？');
  });
});

describe('联动 · Reader 出好的题转成题库', () => {
  it('字段改名到 Review 的题库格式', () => {
    expect(
      normalizeQuestions([{ q: '题干？', options: ['甲', '乙'], correct: [1], explain: '因为…' }]),
    ).toEqual([{ question: '题干？', options: ['甲', '乙'], correctIndices: [1], explain: '因为…' }]);
  });

  it('多选答案按顺序保留', () => {
    expect(normalizeQuestions([{ q: '多选？', options: ['甲', '乙', '丙'], correct: [0, 2] }])[0].correctIndices).toEqual([0, 2]);
  });

  it('缺题干或选项的残题直接丢掉', () => {
    expect(normalizeQuestions([{ q: '', options: ['甲'], correct: [] }, { q: '好题？', options: [], correct: [] }])).toEqual([]);
  });

  it('没传题就是空数组，不写空题库', () => {
    expect(normalizeQuestions(undefined)).toEqual([]);
  });
});
