/* ============================================================
 * bz · 卡片方式的界面元数据（review/card-mode-meta.ts）
 *
 * 制卡界面（card-flow）、复习工作台（review-flow）两处都要显示同一套名字与
 * 图标，以前名字写在 card-flow 里，工作台要显示就得 import 那个带 obsidian
 * 依赖的模块。这里把纯数据单独放出来，两边共用一份，避免「同一个方式两种叫法」。
 * ============================================================ */
import type { CardMode } from './card-mode';

export interface CardModeMeta {
  value: CardMode;
  label: string;
  hint: string;
  /** 工作台徽标用的单字符图标 */
  icon: string;
  /** 工作台色档（对应 CSS 的 [data-tone]） */
  tone: string;
  /**
   * 暂不提供给用户：从「可选入口」里摘掉，但实现与数据结构全部保留。
   * 只影响 CARD_MODE_LABELS（制卡/重新生成的选择框）；CARD_MODE_META 仍是全量，
   * 老卡按原模式照常复习，modeMetaOf / cardModeLabel 仍能查到名字与图标。
   */
  hidden?: boolean;
}

/** 全量元数据（含暂不对外展示的三种）：老卡复习与名字查询都走它 */
export const CARD_MODE_META: readonly CardModeMeta[] = [
  { value: 'flashcard', label: 'AI 抽认卡', hint: '先给一句不能照抄原文的问句，想不起来再看原文', icon: '◆', tone: 'purple' },
  { value: 'quiz', label: 'AI 做题', hint: '按内容生成四选一，每轮只抽其中一部分', icon: '◇', tone: 'orange' },
  { value: 'cloze', label: 'AI 填空', hint: '把关键短语挖掉，自己填回去', icon: '▣', tone: 'blue', hidden: true },
  { value: 'context', label: '上下文', hint: '只给前后几句，回忆被藏起来的那段', icon: '▤', tone: 'green', hidden: true },
  { value: 'plain', label: '展开全文', hint: '不调用 AI，直接摆出原文，自己评难度', icon: '▬', tone: 'gray', hidden: true },
];

/**
 * 制卡界面/设置里可选的入口：过滤掉 hidden 的三种（填空 / 上下文 / 展开全文）。
 * 2026-11-20 用户拍板：界面暂时不提供这三种，代码与老卡行为全部保留。
 */
export const CARD_MODE_LABELS: ReadonlyArray<{ value: CardMode; label: string; hint: string }> =
  CARD_MODE_META.filter((m) => !m.hidden).map(({ value, label, hint }) => ({ value, label, hint }));

/** 一句人话的名字：设置页、提示、工作台徽标都用它 */
export function cardModeLabel(mode: CardMode): string {
  return CARD_MODE_META.find((m) => m.value === mode)?.label ?? mode;
}

/** 工作台徽标整套元数据；没写 mode 的老卡按抽认卡显示 */
export function modeMetaOf(mode: CardMode | null | undefined): CardModeMeta {
  return CARD_MODE_META.find((m) => m.value === mode) ?? CARD_MODE_META[0];
}
