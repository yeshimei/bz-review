/* ============================================================
 * bz · 卡片提示面（review/card-prompt.ts）
 *
 * 纯函数：不知道有没有模型、不碰 DOM、不碰 obsidian——只回答一件事，
 * 「这一帧提示面上该显示什么」。
 *
 * 拆出来的原因是一次真机事故：抽认卡的提示面向模型要一句问句，原来的写法是
 * 「拿到了才重画」。可没配模型时永远拿不到，于是界面就停在「正在生成提示…」
 * 上不动了——整张卡复习不了，控制台还一句错都不报。状态机和副作用分开之后，
 * 「问过就必须有字」这件事才能在 node 里直接断言。
 * ============================================================ */
import type { ReviewItem } from './data';

/** 提示面：长划线给开头，短划线只给几个字（否则等于把答案念出来） */
export function promptOf(item: ReviewItem): string {
  const text = String(item.card?.text ?? '').trim();
  const chars = Array.from(text);
  if (!chars.length) return '';
  if (chars.length > 24) return `${chars.slice(0, 18).join('')}…`;
  return `${chars.slice(0, 4).join('')}…`;
}

/** 这一帧的输入：有没有问过、能不能问、已经拿到了什么 */
export interface PromptViewState {
  /** 已经对这张卡发起过请求（失败也算问过——不重试，免得每帧重画都在打模型） */
  asked: boolean;
  /** 本次会话有没有「问模型」这个能力 */
  canAsk: boolean;
  /** 本会话已经拿到的问句 */
  cached?: string;
}

export interface PromptView {
  /** 这一帧显示什么；空串表示还在等，界面显示「正在生成提示…」 */
  text: string;
  /** 这一帧要不要发起请求 */
  ask: boolean;
}

/**
 * 提示面状态机。
 *
 * 唯一的硬约束：**只要 `asked` 为真，`text` 就必须有字**。否则界面会一直
 * 停在「正在生成提示…」，而用户没有任何办法把它推走。
 */
export function promptViewFor(item: ReviewItem, state: PromptViewState): PromptView {
  const cached = String(state.cached ?? '').trim();
  if (cached) return { text: cached, ask: false };
  if (!state.canAsk || state.asked) return { text: promptOf(item), ask: false };
  return { text: '', ask: true };
}
