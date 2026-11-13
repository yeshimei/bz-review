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

/* ---------------- 填空 / 做题：内容缺失时该补还是该降级 ----------------
 *
 * 同一个事故的另一半：内容只在「加入计划那一刻」生成过一次，用户在设置里
 * 把复习方式从抽认卡改成填空 / 做题之后，已经加进计划的卡一张都不会补。
 * 于是整轮复习每张卡都是「这张卡还没准备好填空，先看原文」——选了填空，
 * 拿到的还是原文。
 *
 * 修法与提示面一致：缺内容且**这一轮还没试过**就去补（界面显示「正在准备…」），
 * 补过仍然没有才降级。`attempted` 是防止每次重画都打一遍模型。
 */

/** 填空面：ready 正常答题 / pending 正在补 / fallback 补不到，看原文 */
export type ClozeView = 'ready' | 'pending' | 'fallback';

export function clozeViewOf(ready: boolean, attempted: boolean): ClozeView {
  if (ready) return 'ready';
  return attempted ? 'fallback' : 'pending';
}

/** 做题面：同上（题目数量为 0 视为没内容） */
export type QuizView = 'ready' | 'pending' | 'fallback';

export function quizViewOf(count: number, attempted: boolean): QuizView {
  if (count > 0) return 'ready';
  return attempted ? 'fallback' : 'pending';
}

/**
 * 填空空位的统一宽度（ch）。
 *
 * 原实现按**每个空自己的答案长度**给宽度（答案 5 字给 11ch、7 字给 15ch），
 * 等于把「这个空几个字」印在题面上——填空本来就靠回忆，长度一给就少了一半难度。
 * 现在整张卡取最长那个，只泄漏「最长的空有这么长」，每个空之间无从区分。
 *
 * 下界 6ch 保证再短的答案也点得进去（下划线本来就要留出可点的宽度），
 * 上界 20ch 防长答案把整行撑出容器。
 */
export function clozeSlotWidth(blanks: readonly string[]): number {
  let widest = 0;
  for (const blank of blanks ?? []) {
    let w = 0;
    for (const ch of Array.from(String(blank ?? ''))) {
      // 全角（汉字、中文标点）按两格算，其余按一格
      w += /[\u3000-\u9fff\uff01-\uff60]/.test(ch) ? 2 : 1;
    }
    if (w > widest) widest = w;
  }
  return Math.min(20, Math.max(6, widest + 1));
}
