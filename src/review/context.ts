/* ============================================================
 * bz · 上下文卡（review/context.ts）
 *
 * 第四种复习方式：不给你问题，给你**前后文**，让你想起中间那句。
 *
 * 为什么单独做一种：抽认卡考的是「这句话说了什么」，上下文卡考的是「这句话
 * 在哪儿、跟着什么来的」。后者只有阅读器能提供——它知道划线前后各是什么。
 *
 * 没有前后文时（独立使用、老卡片、别的来源）退化成「出处回忆」：给书名和
 * 章节，让你回忆这一章里划过什么。退化版不假装是完整功能，界面会说明。
 * ============================================================ */
import type { ReviewCard } from './data';

/** 上下文最多取多少字：太长就变成重读整段，没有回忆压力 */
const MAX_SIDE = 160;

export interface ContextSides {
  before: string;
  after: string;
}

/** 把一段文本压到上限内，按字数（不是 UTF-16 长度）截 */
/** unknown → 安全字符串（typeof 守卫，避免对象默认 stringification） */
function textOf(v: unknown): string {
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  return '';
}

function clampSide(text: unknown, fromEnd = false): string {
  const chars = Array.from(textOf(text).replace(/\s+/g, ' ').trim());
  if (chars.length <= MAX_SIDE) return chars.join('');
  return fromEnd ? `…${chars.slice(-MAX_SIDE).join('')}` : `${chars.slice(0, MAX_SIDE).join('')}…`;
}

/** 这张卡有没有真前后文（有才能走完整的上下文模式） */
export function hasRealContext(card: ReviewCard | null | undefined): boolean {
  const c = card?.context;
  if (!c) return false;
  return Boolean(String(c.before ?? '').trim() || String(c.after ?? '').trim());
}

/** 取修剪过的前后文；没有就返回 null */
export function contextOf(card: ReviewCard | null | undefined): ContextSides | null {
  if (!hasRealContext(card)) return null;
  return {
    before: clampSide(card?.context?.before, true),
    after: clampSide(card?.context?.after),
  };
}

/** 出处那行：书名 · 章节 */
export function whereOf(card: ReviewCard | null | undefined): string {
  const book = String(card?.bookTitle ?? '').trim();
  const chapter = String(card?.chapterTitle ?? '').trim();
  if (book && chapter) return `${book} · ${chapter}`;
  return book || chapter || '';
}

export interface ContextPrompt {
  /** 走的是完整上下文模式，还是退化的出处回忆 */
  real: boolean;
  /** 提示面顶上的引导句 */
  lead: string;
  /** 划线之前的上下文（常为空） */
  before: string;
  /** 划线之后的上下文（常为空） */
  after: string;
  /** 出处；退化模式下它就是唯一的提示 */
  where: string;
  /**
   * 退化模式下额外给的一点线索：用户当时写的想法。
   * 有想法时用它当问题面——自己写的话最能勾出原文。
   */
  hint: string;
}

/**
 * 组一张上下文卡的提示面。
 *
 * 三种情形：
 *   1. 有前后文 → 真上下文，把划线藏起来；
 *   2. 没有前后文但有想法 → 用想法当提示（「你当时在这句旁边写了 …」）；
 *   3. 什么都没有 → 只有出处，纯回忆。
 */
export function contextPromptOf(card: ReviewCard | null | undefined): ContextPrompt {
  const where = whereOf(card);
  const sides = contextOf(card);
  const comment = String(card?.comment ?? '').trim();

  if (sides) {
    return {
      real: true,
      lead: '这句话夹在下面两段之间——你还记得它说了什么吗？',
      before: sides.before,
      after: sides.after,
      where,
      hint: '',
    };
  }

  if (comment) {
    return {
      real: false,
      lead: '这是你当时在这句话旁边写的想法——它还让你想起原句吗？',
      before: '',
      after: '',
      where,
      hint: comment,
    };
  }

  return {
    real: false,
    lead: '凭出处回忆：这一章里，你划过的是哪句话？',
    before: '',
    after: '',
    where,
    hint: '',
  };
}

/** 上下文卡不判对错——它考的是「想起来没有」，交给用户自评 */
export const CONTEXT_NEEDS_SELF_RATING = true;
