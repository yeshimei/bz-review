/**
 * AI 可用性与「按需补内容」的判定（本轮真机验证的产物）
 *
 * 两个真机事故：
 *
 * 1. 设置里把服务商选成「不启用」，复习时模型**照样被调用**——`getAIProvider` 用
 *    `s.aiProvider || 'deepseek'` 兜底，空串被当成「没设置」而不是「关掉」。用户以为
 *    关了就省钱，实际每一张卡都在烧钱。
 * 2. 复习方式从抽认卡改成填空 / 做题之后，**已经加进计划的卡不会补内容**：内容只在
 *    「加入那一刻」生成过一次。于是整轮复习每张卡都退化成「这张卡还没准备好填空，
 *    先看原文」——选了填空，看到的还是原文。
 *
 * 第二条的修法是把「这一帧该显示什么」也抽成状态机：没内容、没试过 → 去补（显示
 * 准备中）；补过还没有 → 才降级。和抽认卡的提示面同一个口径。
 */
import { describe, expect, it } from 'vitest';
import { clozeSlotWidth, clozeViewOf, quizViewOf } from '../src/review/card-prompt';
import { resolveProviderId } from '../src/core/ai-provider-id';

describe('服务商开关', () => {
  it('没设过（undefined）：用缺省服务商', () => {
    expect(resolveProviderId(undefined)).toBe('deepseek');
  });

  it('显式「不启用」（空串）：保持空，不许被兜底成 deepseek', () => {
    expect(resolveProviderId('')).toBe('');
  });

  it('只有空白也算「不启用」', () => {
    expect(resolveProviderId('   ')).toBe('');
  });

  it('选了服务商就原样返回', () => {
    expect(resolveProviderId('ollama')).toBe('ollama');
  });
});

describe('填空面状态', () => {
  it('有内容：直接显示填空', () => {
    expect(clozeViewOf(true, false)).toBe('ready');
    expect(clozeViewOf(true, true)).toBe('ready');
  });

  it('没内容、还没试过：显示「正在准备填空」并去补', () => {
    expect(clozeViewOf(false, false)).toBe('pending');
  });

  it('补过仍然没有：才降级成看原文', () => {
    expect(clozeViewOf(false, true)).toBe('fallback');
  });
});

describe('做题面状态', () => {
  it('有题：直接显示题目', () => {
    expect(quizViewOf(3, false)).toBe('ready');
  });

  it('没题、还没试过：显示「正在准备题目」并去补', () => {
    expect(quizViewOf(0, false)).toBe('pending');
  });

  it('补过仍然没题：降级成看原文', () => {
    expect(quizViewOf(0, true)).toBe('fallback');
  });
});

describe('填空空格宽度', () => {
  it('所有空统一按最长的那个算——逐个按答案长度给宽等于把答案字数印在题面上', () => {
    const w = clozeSlotWidth(['过去的经历', '赋予经历的意义']);
    expect(w).toBe(clozeSlotWidth(['赋予经历的意义', '过去的经历']));
  });

  it('短答案也留出可输入的余量', () => {
    expect(clozeSlotWidth(['好'])).toBeGreaterThanOrEqual(6);
  });

  it('长答案封顶，不把一行撑爆', () => {
    expect(clozeSlotWidth(['一二三四五六七八九十一二三四五六七八九十'])).toBeLessThanOrEqual(20);
  });

  it('没有空时给一个可用的默认宽度', () => {
    expect(clozeSlotWidth([])).toBeGreaterThanOrEqual(6);
  });
});
