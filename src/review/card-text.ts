/* ============================================================
 * bz · 给模型看的那份正文（review/card-text.ts）
 *
 * 卡片上的 `text` 是**复习时给人看的原文**，可能很长（整篇笔记）；
 * 提示词里塞不下也没必要全塞。`aiText` 是同一张卡「只给模型看」的节选，
 * 缺省与 `text` 相同。
 *
 * 单独一个文件的原因：出抽认卡 / 挖空 / 做题三条提示词都要用同一条口径，
 * 散在三个文件里各写一遍，早晚有一处忘了改。
 * ========================================================== */
export function aiTextOf(card: { text?: unknown; aiText?: unknown } | null | undefined): string {
  const brief = typeof card?.aiText === 'string' ? card.aiText.trim() : '';
  if (brief) return brief;
  return typeof card?.text === 'string' ? card.text : '';
}
