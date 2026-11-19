/* ============================================================
 * bz · 划线卡的列表短标题（review/card-title.ts）
 *
 * 同章十几张卡原来都写「围城 · 第一章」，用户在复习列表里分不清谁是谁。
 * 这里按制卡方式给每张卡取一句短标题——纯函数、不碰 obsidian，可被单测钉住。
 * 规则和字段语义见 ReviewCard.displayTitle 的注释（review/data.ts）。
 * ============================================================ */
import type { ReviewCard } from './data';

/** 列表标题的截断长度：一行放得下、又能区分同章的十几张卡 */
const CARD_TITLE_MAX = 22;

/** 把一行文本收成短标题：压空白、截断、补省略号 */
function shortTitle(s: string): string {
  const clean = String(s ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > CARD_TITLE_MAX ? `${clean.slice(0, CARD_TITLE_MAX)}…` : clean;
}

/**
 * 卡片在复习列表里显示的那行字（2026-11-20）。
 *
 *   · 抽认卡 → 问句（qa.q 就是身份，不依赖 mode 是否盖章——md 导入的问答卡没 mode）；
 *   · 做题卡 → displayTitle（题目在独立题库、卡上拿不到，生成后回填第一题题干）；
 *   · 全文回忆 → 划线全文截断（没有 AI 内容，只能拿原文当身份）；
 *   · 老卡/其它 → 回落到书名·章节，最后才用全文截断。
 */
export function cardTitleOf(card: ReviewCard): string {
  const mode = card?.mode;
  const q = card.qa?.q ?? '';
  if (q.trim()) return shortTitle(q);
  const explicit = shortTitle(card?.displayTitle ?? '');
  if (explicit) return explicit;
  const book = String(card?.bookTitle ?? '').trim();
  const chapter = String(card?.chapterTitle ?? '').trim();
  const source = book && chapter ? `${book} · ${chapter}` : book;
  if (source && mode !== 'plain') return shortTitle(source);
  return shortTitle(card?.text ?? '') || '划线卡';
}
