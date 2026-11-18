/**
 * 制卡方式跟着卡走（2026-11-15）
 *
 * 用户口径：「复习方式和制卡时选择的方式有关，不再从设置中选择整体的复习方式」。
 * 一句话拆成三件可测的事：
 *
 *   1. 卡上存了方式 → 用它；没有（老卡片）→ 才回落到全局旧值；
 *   2. 设置里的「新卡默认方式」是「手动」时返回 null（调用方据此弹选择框）；
 *   3. 批量加卡（阅读器划线）没给方式时，落库那一刻补上同一个默认值——
 *      否则同一份计划里一半卡有方式、一半卡没有，复习时行为分叉。
 */
import { describe, expect, it } from 'vitest';
import { cardModeOf, defaultCardMethod, isCardMode, modeOfCard, stampCardModes } from '../src/review/card-mode';
import type { ReviewCard } from '../src/review/data';

function card(over: Partial<ReviewCard> = {}): ReviewCard {
  return { key: 'sel:a.md:1', bookTitle: 'A', text: '一段原文', ...over };
}

describe('卡片自己的复习方式', () => {
  it('卡上写了方式就用卡上的，不被全局设置覆盖', () => {
    const c = card({ mode: 'cloze' });
    expect(modeOfCard(c, { reviewCardMode: 'quiz' })).toBe('cloze');
  });

  it('老卡片没有方式字段：回落到全局旧值', () => {
    expect(modeOfCard(card(), { reviewCardMode: 'quiz' })).toBe('quiz');
  });

  it('全局值也是脏的：按抽认卡', () => {
    expect(modeOfCard(card(), { reviewCardMode: 'nonsense' as any })).toBe('flashcard');
    expect(cardModeOf({ reviewCardMode: 'nonsense' as any })).toBe('flashcard');
  });

  it('卡上的脏值不认，照样回落', () => {
    expect(modeOfCard(card({ mode: 'flashcardd' as any }), { reviewCardMode: 'context' })).toBe('context');
  });

  it('isCardMode 只认五个合法值', () => {
    for (const v of ['flashcard', 'cloze', 'quiz', 'context', 'plain']) expect(isCardMode(v)).toBe(true);
    for (const v of ['', 'Flashcard', 'manual', null, undefined, 1]) expect(isCardMode(v)).toBe(false);
  });
});

describe('新卡默认方式', () => {
  it('没设过 → null（每次都问）', () => {
    expect(defaultCardMethod({})).toBeNull();
  });

  it('设成「手动」→ null（每次都问）', () => {
    expect(defaultCardMethod({ reviewCardDefaultMethod: 'manual' })).toBeNull();
  });

  it('选了具体方式 → 直接返回，不再弹选择框', () => {
    expect(defaultCardMethod({ reviewCardDefaultMethod: 'quiz' })).toBe('quiz');
  });

  it('脏值 → null，宁可多问一句也不要按错方式制卡', () => {
    expect(defaultCardMethod({ reviewCardDefaultMethod: 'auto' as any })).toBeNull();
  });
});

describe('批量落库前补默认方式', () => {
  it('没给方式（阅读器划线）时补上，保证每张卡方式都定在自己身上', () => {
    const out = stampCardModes([card({ key: 'sel:a.md:1' }), card({ key: 'sel:a.md:2' })], {
      reviewCardDefaultMethod: 'cloze',
    });
    expect(out.map((c) => c.mode)).toEqual(['cloze', 'cloze']);
  });

  it('「每次问我」时回落旧全局值，不会留下没方式的卡', () => {
    const out = stampCardModes([card()], { reviewCardDefaultMethod: 'manual', reviewCardMode: 'quiz' });
    expect(out[0].mode).toBe('quiz');
  });

  it('调用方已经给了方式就不覆盖', () => {
    const out = stampCardModes([card({ key: 'sel:a.md:3', mode: 'cloze' })], {
      reviewCardDefaultMethod: 'quiz',
    });
    expect(out[0].mode).toBe('cloze');
  });

  it('不改原数组里的对象（批量路径是纯的）', () => {
    const src = card();
    stampCardModes([src], { reviewCardDefaultMethod: 'quiz' });
    expect(src.mode).toBeUndefined();
  });
});
