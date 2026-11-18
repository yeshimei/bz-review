/**
 * 跳回原文的兜底拼装（纯函数，零 DOM，node 直测）
 *
 * Reader 推卡时本应带上 backlink，但老版本没写；卡片 key 里本来就藏着 bookId，
 * 所以这里补一条兜底链。真正的协议拼装仍由 core/reader-link.readerJumpUrl 负责，
 * 通过参数注入进来，避免纯层 import obsidian。
 *
 * 注意：协议只能按原文片段定位到那一句，不能按高亮 id 还原高亮色——
 * 界面文案用「回到原文」，不要说成「高亮定位」。
 */

const KEY_PREFIX = 'reader:';
const SNIPPET = 20;

export function bookIdOfCardKey(key: unknown): string | null {
  const raw = String(key ?? '').trim();
  if (!raw.startsWith(KEY_PREFIX)) return null;
  const rest = raw.slice(KEY_PREFIX.length);
  const cut = rest.indexOf(':');
  if (cut <= 0) return null;
  const id = rest.slice(0, cut).trim();
  return id || null;
}

export interface JumpCardLike {
  key?: string;
  text?: string;
  chapterTitle?: string;
  backlink?: string;
}

export type JumpUrlBuilder = (
  bookId: string,
  target: { text?: string; chapter?: string }
) => string;

/** 已有 backlink 优先；没有就用 key 兜底；都不是就不显示按钮 */
export function backlinkOfCard(card: JumpCardLike, buildUrl: JumpUrlBuilder): string {
  const existing = String(card?.backlink ?? '').trim();
  if (existing) return existing;
  const bookId = bookIdOfCardKey(card?.key);
  if (!bookId) return '';
  return buildUrl(bookId, {
    text: String(card?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, SNIPPET),
    chapter: card?.chapterTitle,
  });
}
