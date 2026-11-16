/**
 * 阅读器门面的两项新能力（2026-11-17）：
 *   1. 做题的题目跟随卡片一起交过来，落到题库——不然 Review 会二次生成，
 *      用户在阅读器里删/补/重生成的题就白费了。
 *   2. 额度预知——阅读器在批量列表里要提前标「超出基础版上限」。
 * 这都是纯数据转换，不碰文件 IO，可直接在 node 里测。
 */
import { describe, expect, it } from 'vitest';
import {
  cardQuota,
  quizOf,
  toQuizQuestions,
  withoutPrepared,
  type QuizInput,
} from '../src/review/reader-input';

const Q: QuizInput = { q: '婚姻像什么？', options: ['城', '船', '桥'], correct: [0], explain: '原文比喻' };

describe('toQuizQuestions：阅读器的题 → Review 题库格式', () => {
  it('字段改名并补齐默认', () => {
    expect(toQuizQuestions([Q])).toEqual([
      { question: '婚姻像什么？', options: ['城', '船', '桥'], correctIndices: [0], explain: '原文比喻' },
    ]);
  });
  it('过滤缺字段、下标越界、重复的题', () => {
    const bad = { q: '坏题', options: ['A'], correct: [0] };
    const outOfRange = { q: '越界', options: ['A', 'B'], correct: [5] };
    const dup = { ...Q, q: '婚姻像什么？ ' };
    expect(toQuizQuestions([Q, bad, outOfRange, dup])).toHaveLength(1);
  });
  it('空列表返回空', () => {
    expect(toQuizQuestions([])).toEqual([]);
  });
});

describe('quizOf：只给真正入库的卡交题目', () => {
  const cards = [
    { key: 'k1', bookTitle: '书', text: '甲', mode: 'quiz' as const, questions: [Q] },
    { key: 'k2', bookTitle: '书', text: '乙', mode: 'flashcard' as const },
  ];
  it('只收 addedKeys 里的、带题目的卡', () => {
    const out = quizOf(cards, ['k1', 'k2']);
    expect(Object.keys(out)).toEqual(['k1']);
    expect(out['k1']).toHaveLength(1);
  });
  it('没入库的卡不交题目（避免题库里堆孤儿题）', () => {
    expect(quizOf(cards, ['k2'])).toEqual({});
  });
});

describe('withoutPrepared：已带题面/题目的卡不再排队二次生成', () => {
  it('qa 和 questions 都从待补队列里剔除', () => {
    const keys = ['qa-card', 'quiz-card', 'plain-card'];
    const cards = [
      { key: 'qa-card', bookTitle: '书', text: '甲', qa: { q: '问', a: '答' } },
      { key: 'quiz-card', bookTitle: '书', text: '乙', questions: [Q] },
      { key: 'plain-card', bookTitle: '书', text: '丙' },
    ];
    expect(withoutPrepared(keys, cards)).toEqual(['plain-card']);
  });
});

describe('cardQuota：额度预知', () => {
  it('基础版 50 条，报已用/上限/剩余', () => {
    const q = cardQuota({ notes: 3, cards: 47 });
    expect(q.used).toBe(47);
    expect(q.limit).toBe(50);
    expect(q.remaining).toBe(3);
    expect(q.full).toBe(false);
  });
  it('满了就是满了', () => {
    expect(cardQuota({ notes: 0, cards: 50 }).full).toBe(true);
    expect(cardQuota({ notes: 0, cards: 60 }).remaining).toBe(0);
  });
});
