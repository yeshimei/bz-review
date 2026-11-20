/* ============================================================
 * 笔记选段的出处（review/note-source.ts）
 *
 * 「选中笔记里一段文字 → 加入复习」跟划线卡最大的不同：它的原文不在卡上，
 * 而在库里那篇笔记中。所以要记下笔记路径与选区的字符范围（from/to），
 * 复习点「回到原文」时才能既打开文件、又把那一段选中给人看。
 *
 * 这里只放纯数据与归一：钥匙、backlink、脏值收窄；不碰 DOM、不碰 IO。
 * 真正「打开文件 + 设选区」在 note-jump.ts（注入 App）。
 * ============================================================ */

/** 一条笔记里的文字范围（字符偏移，非负且 from < to） */
export interface NoteSource {
  path: string;
  from: number;
  to: number;
}

/** 选段卡的钥匙前缀：与 reader:/sel: 区分开，且不会是真实路径 */
export const NOTE_KEY_PREFIX = 'note:';

/** 选段卡的稳定钥匙：同一篇同一段重复加入不排两次 */
export function noteCardKey(src: NoteSource): string {
  return `${NOTE_KEY_PREFIX}${src.path}:${src.from}:${src.to}`;
}

/** 回到原文的 Obsidian 链接：只到文件，具体段落由 note-jump 按范围选中 */
export function noteBacklink(path: string): string {
  return `obsidian://open?path=${encodeURIComponent(path)}`;
}

/** unknown → 合法出处；范围非法 / 路径为空 / 脏对象一律不收 */
export function noteSourceOf(raw: unknown): NoteSource | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as { path?: unknown; from?: unknown; to?: unknown };
  const path = typeof r.path === 'string' ? r.path.trim() : '';
  const from = typeof r.from === 'number' && Number.isFinite(r.from) ? r.from : -1;
  const to = typeof r.to === 'number' && Number.isFinite(r.to) ? r.to : -1;
  if (!path || from < 0 || to <= from) return null;
  return { path, from, to };
}

/** 编辑器鸭子类型（Obsidian Editor 的选区三件套） */
interface SelectionEditor {
  getSelection(): string;
  getCursor(which: 'from' | 'to'): unknown;
  posToOffset(pos: unknown): number;
}

/**
 * 从编辑器读当前选区的字符范围；没选内容 / 接口不全 / 范围非法都返回 null。
 * 用字符偏移而不是 line/ch：笔记被编辑后行号会变，偏移更稳（且跳回时能直接
 * offsetToPos 还原）。getCursor + posToOffset 是 Obsidian Editor 的公开 API。
 */
export function selectionRange(editor: unknown): { from: number; to: number } | null {
  if (!editor || typeof editor !== 'object') return null;
  const e = editor as Partial<SelectionEditor>;
  if (typeof e.getSelection !== 'function' || typeof e.getCursor !== 'function' || typeof e.posToOffset !== 'function') {
    return null;
  }
  if (!String(e.getSelection!() ?? '').trim()) return null;
  try {
    const from = e.posToOffset!(e.getCursor!('from'));
    const to = e.posToOffset!(e.getCursor!('to'));
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from) return null;
    return { from, to };
  } catch {
    return null;
  }
}
