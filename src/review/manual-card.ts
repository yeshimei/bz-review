/* ============================================================
 * 手动创建卡牌的纯逻辑（review/manual-card.ts）
 *
 * 「更多 · 复习操作 · 创建卡牌」让用户直接写一段文字做成卡。手输内容没有文件路径
 * 当钥匙，也没有「回到原文」的出处，两件事必须在这里钉住：
 *   1. 同一段文字 → 同一个稳定钥匙（FNV-1a），重复创建能被查重拦住，不会每次都像新卡；
 *   2. 空白内容一律不收（面板上有字数提示，这里是最后一道），超长按字符截断。
 *
 * 零 DOM、零 IO，单测直接跑。
 * ============================================================ */

/** 手输正文上限（字符，按 Unicode 码点算，和面板字数提示同源） */
export const MANUAL_TEXT_LIMIT = 2000;

/** 手搓卡的固定来源名（不指向任何文件；复习列表里据此知道这张卡从哪来） */
export const MANUAL_BOOK_TITLE = '手动创建';

/**
 * 稳定钥匙：去首尾空白后按 FNV-1a 散列，带 manual: 前缀。
 *
 * 不用时间戳/随机数——那样同一段文字每次都算新卡，查重形同虚设。
 */
export function manualCardKey(text: string): string {
  const raw = String(text ?? '').trim();
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i += 1) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `manual:${h.toString(16).padStart(8, '0')}`;
}

export interface ManualTextResult {
  text: string;
  clipped: boolean;
  error?: string;
}

/** 归一面板里输入的文字：空白拒绝，超长截断 */
export function normalizeManualText(raw: string): ManualTextResult {
  const text = String(raw ?? '').trim();
  if (!text) return { text: '', clipped: false, error: '先写点要复习的内容' };
  const chars = Array.from(text);
  if (chars.length <= MANUAL_TEXT_LIMIT) return { text, clipped: false };
  return { text: chars.slice(0, MANUAL_TEXT_LIMIT).join(''), clipped: true };
}
