/**
 * 提示面状态（review/card-session.ts）
 *
 * 这一组测的是真机上踩到的一个死锁：抽认卡的提示面要不要向模型要一句问句，
 * 要完回来之后界面停在哪。原来的实现是「拿到了才重画」，于是没配模型、
 * 或者模型调用失败时——拿不到问句——界面永远停在「正在生成提示…」，
 * 整张卡复习不了（实测 30 秒不恢复、控制台无任何报错）。
 *
 * 所以这里把「这一帧该显示什么」抽成纯函数，断言的核心只有一条：
 * **只要问已经发起过，下一帧就必须有字，不能是空。**
 */
import { describe, expect, it } from 'vitest';
import { clozeContentUsable, promptOf, promptViewFor } from '../src/review/card-prompt';
import type { ReviewItem } from '../src/review/data';

function makeCard(text: string): ReviewItem {
  return {
    id: 'review_t',
    filePath: 'reader:book:h1',
    name: '书名',
    kind: 'card',
    card: { key: 'reader:book:h1', bookTitle: '书名', text },
  } as unknown as ReviewItem;
}

const CARD = makeCard('决定我们自身的不是过去的经历，而是我们自己赋予经历的意义。');

describe('提示面状态', () => {
  it('没缓存、还能问：这一帧空着（显示「正在生成提示…」），并真的去问', () => {
    const v = promptViewFor(CARD, { asked: false, canAsk: true });
    expect(v.text).toBe('');
    expect(v.ask).toBe(true);
  });

  it('问过但没拿到（没配模型 / 调用失败）：退回内置提示，绝不停在空白', () => {
    const v = promptViewFor(CARD, { asked: true, canAsk: true });
    expect(v.text).toBe(promptOf(CARD));
    expect(v.text.length).toBeGreaterThan(0);
    expect(v.ask).toBe(false);
  });

  it('拿到问句：直接显示问句', () => {
    const v = promptViewFor(CARD, { asked: true, canAsk: true, cached: '这段话在讲什么？' });
    expect(v.text).toBe('这段话在讲什么？');
    expect(v.ask).toBe(false);
  });

  it('根本没有问的能力：直接用内置提示', () => {
    const v = promptViewFor(CARD, { asked: false, canAsk: false });
    expect(v.text).toBe(promptOf(CARD));
    expect(v.ask).toBe(false);
  });

  it('问句是空串等同于没拿到（不能让空白占住提示面）', () => {
    const v = promptViewFor(CARD, { asked: true, canAsk: true, cached: '   ' });
    expect(v.text).toBe(promptOf(CARD));
  });

  it('内置提示永远不是空：空提示会让会话变成一张白卡', () => {
    expect(promptOf(CARD).length).toBeGreaterThan(0);
    expect(promptOf(makeCard(''))).toBe('');
  });
});

describe('填空内容可用性', () => {
  const card = (text: string, cloze?: { text: string; blanks: string[] }): any => ({ text, cloze });

  it('完整挖空句可用', () => {
    expect(
      clozeContentUsable(card('叶绿体里的色素吸收红光和蓝紫光', { text: '{{1}}里的色素吸收{{2}}', blanks: ['叶绿体', '红光和蓝紫光'] })),
    ).toBe(true);
  });

  it('AI 只回半句时不可用，宁可降级看原文也不让用户背半截', () => {
    expect(
      clozeContentUsable(card('叶绿体里的色素主要吸收红光和蓝紫光，而类胡萝卜素主要吸收蓝紫光。', { text: '{{1}}，而类胡萝卜素主要吸收蓝紫光。', blanks: ['叶绿体里的色素主要吸收红光和蓝紫光'] })),
    ).toBe(false);
  });

  it('没有占位、空答案都算没准备好', () => {
    expect(clozeContentUsable(card('原文', { text: '没有空的句子', blanks: ['答案'] }))).toBe(false);
    expect(clozeContentUsable(card('原文', { text: '{{1}}', blanks: [] }))).toBe(false);
    expect(clozeContentUsable(card('原文'))).toBe(false);
  });
});
