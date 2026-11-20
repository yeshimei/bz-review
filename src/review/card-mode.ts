/* ============================================================
 * bz · 卡片复习方式的口径（review/card-mode.ts）
 *
 * 2026-11-15 用户拍板：复习方式**跟着卡走**，不再是设置里一个全局开关。
 * 方式在「制卡那一刻」定下来，存进 `ReviewCard.mode`，之后这张卡复习就按它走；
 * 同一份计划里抽认卡、填空题、做题卡可以并存。
 *
 * 这个文件单独存在的原因很实际：`card-ai.ts` 为了生成内容要 import 模型服务
 * （`core/ai` → obsidian），而这里的判定是纯的——不把它拆出来，这几条口径就
 * 只能靠真机验证，回归时没人拦得住。
 * ============================================================ */
import type { ReviewCard } from './data';
import type BzSettings from '../settings';
import { tryGetSettings } from '../core/settings-provider';

/** 只需要这两个旧全局字段；tryGetSettings() 返回的就是同一份 Partial<BzSettings> */
type ModeSettings = Partial<Pick<BzSettings, 'reviewCardMode' | 'reviewCardDefaultMethod'>>;

/**
 * 划线卡的复习方式（外加 plain：不生成任何内容，直接展开全文）。
 *
 *   flashcard 抽认卡：正面问句，背面原文
 *   cloze     填空：挖掉一两处，凭上下文补回来
 *   quiz      做题：AI 出选择题
 *   context   上下文：给前后文，回忆中间那句（不需要预先生成内容）
 *   media     媒体卡：图片 / 音频直接嵌在卡上，复习时显示或播放
 *   occlusion 图片遮挡：图片上盖几块区域，点开揭示被遮的内容
 */
export type CardMode = 'flashcard' | 'cloze' | 'quiz' | 'context' | 'plain' | 'media' | 'occlusion';

/** 全部合法方式（顺序＝制卡界面里的推荐顺序） */
export const CARD_MODES: readonly CardMode[] = ['flashcard', 'quiz', 'cloze', 'media', 'occlusion', 'context', 'plain'];

/** 这个字符串是不是一个合法的方式值 */
export function isCardMode(v: unknown): v is CardMode {
  return typeof v === 'string' && (CARD_MODES as readonly string[]).includes(v);
}

/**
 * 旧的**全局**方式：只在两种地方还有意义——老卡片没有 `mode` 时的回落值，
 * 以及批量加卡（阅读器划线）没有逐张选择机会时的取值。
 */
export function cardModeOf(settings?: ModeSettings): CardMode {
  const raw = (settings ?? tryGetSettings())?.reviewCardMode;
  return isCardMode(raw) ? raw : 'flashcard';
}

/**
 * 一张卡自己的复习方式。
 *
 * 卡上存了就用卡上的；老卡片没有 `mode` 才回落到全局旧值，保证升级后存量卡
 * 不会因为「没字段」整批失灵。
 */
export function modeOfCard(card: ReviewCard | null | undefined, settings?: ModeSettings): CardMode {
  if (isCardMode(card?.mode)) return card.mode;
  return cardModeOf(settings);
}

/**
 * 加入计划时该用哪种方式：
 *   · 「新卡默认方式」是 manual（默认）→ 返回 null，调用方弹选择界面；
 *   · 选了具体方式 → 直接返回它，不再打扰用户。
 */
export function defaultCardMethod(settings?: ModeSettings): CardMode | null {
  const raw = (settings ?? tryGetSettings())?.reviewCardDefaultMethod;
  return isCardMode(raw) ? raw : null;
}

/**
 * 批量落库前把方式补齐。
 *
 * 阅读器一次推几十条划线，不可能逐张弹选择框，所以这里统一盖一个章：用户设了
 * 「新卡默认方式」就用它，仍是「每次问我」则回落到旧的全局值。**已经有方式的不动**
 * ——调用方显式给过就说明它知道自己在做什么。
 *
 * 为什么必须盖章：同一条计划里如果一半卡有 `mode`、一半没有，复习时的行为就分叉
 * 成「新卡按新口径、老卡按旧设置」，用户完全看不出规律。
 */
export function stampCardModes(cards: readonly ReviewCard[], settings?: ModeSettings): ReviewCard[] {
  const fallback = defaultCardMethod(settings) ?? cardModeOf(settings);
  const src: readonly ReviewCard[] = Array.isArray(cards) ? (cards as ReviewCard[]) : [];
  return src.map((c) => (isCardMode(c?.mode) ? c : { ...c, mode: fallback }));
}
