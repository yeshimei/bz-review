/* ============================================================
 * bz · 挖空编辑器的手工区间模型（review/cloze-edit.ts）
 *
 * 挖空卡的题面存成「带 {{n}} 标记的文本 + 答案数组」，复习时靠它挖空。
 * 但用户在确认题面那屏要像选中文字一样手工挖 / 还原，所以界面层需要一个
 * 「纯文本 + 空位区间」的模型：拖选得到两个字符下标，落到区间上；渲染时
 * 再把区间画成紫色空位。
 *
 * 这个文件只做纯数据换算：不碰 DOM、不碰 AI、不碰设置。所有边界口径都能
 * 在 tests/cloze-edit.test.ts 里钉住——挖空是这一版最容易写错的地方。
 *
 * 口径（与原型一致）：
 *   · 拖选含空白只裁首尾，中间的空格保留；
 *   · 跨段（换行）拖选自动按段切成多个空位；
 *   · 选中范围只要碰到已有空位，就当成「还原」，不再新建；
 *   · 一个空位最多 30 字，挖完剩下的可见文字至少 4 字（否则就成猜谜）。
 * ============================================================ */

/** 一个空位在纯文本里的区间（左闭右开，UTF-16 下标） */
export interface ClozeSpan {
  start: number;
  end: number;
}

/** 纯文本 + 空位区间 */
export interface ClozeRanges {
  plain: string;
  spans: ClozeSpan[];
}

/** 一个空位最多挖掉多少字 */
export const MAX_SPAN = 30;
/** 挖完之后至少要留下多少可见字 */
export const MIN_VISIBLE = 4;

const SLOT_RE = /\{\{(\d+)\}\}/g;

/** 标记按 1 起连续编号，答案数组与之一一对应 */
function slotNumbers(text: string): number[] {
  const out: number[] = [];
  const re = new RegExp(SLOT_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(Number(m[1]));
  return out;
}

/**
 * 挖空文本 + 答案 → 纯文本 + 区间。
 *
 * 标记不合法（跳号、数量对不上、答案为空）时**不猜**：原样去掉标记、返回
 * 空区间，让用户重新挖——猜错了会把答案错位种到别的字上，比没有更糟。
 */
export function clozeToRanges(text: string, blanks: readonly string[]): ClozeRanges {
  const src = String(text ?? '');
  const list = (Array.isArray(blanks) ? blanks : []).map((b) => String(b ?? ''));
  const nums = slotNumbers(src);
  const valid = nums.length > 0
    && nums.length === list.length
    && nums.every((n, i) => n === i + 1)
    && list.every((b) => b.length > 0);
  if (!valid) return { plain: src.replace(SLOT_RE, ''), spans: [] };

  const re = new RegExp(SLOT_RE.source, 'g');
  let plain = '';
  let last = 0;
  let m: RegExpExecArray | null;
  const spans: ClozeSpan[] = [];
  let i = 0;
  while ((m = re.exec(src))) {
    plain += src.slice(last, m.index);
    const answer = list[i];
    spans.push({ start: plain.length, end: plain.length + answer.length });
    plain += answer;
    last = m.index + m[0].length;
    i += 1;
  }
  plain += src.slice(last);
  return { plain, spans };
}

/** 区间规范化：裁到文本内、丢掉空区间、排序、去掉重叠（先到先得） */
export function normalizeSpans(plain: string, spans: readonly ClozeSpan[]): ClozeSpan[] {
  const len = String(plain ?? '').length;
  const raw = spans
    .map((s) => ({
      start: Math.max(0, Math.min(len, Math.round(Number(s.start) || 0))),
      end: Math.max(0, Math.min(len, Math.round(Number(s.end) || 0))),
    }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start);
  const out: ClozeSpan[] = [];
  let last = 0;
  for (const s of raw) {
    if (s.start < last) continue;
    out.push(s);
    last = s.end;
  }
  return out;
}

/**
 * 把紧挨着的区间并成一个。
 *
 * 触屏是「点词」而不是「拖选」：连点两个相邻的词，用户想的是一个空位，
 * 不该变成两个各答一半的空。只在真正首尾相接（next.start === last.end）
 * 时合并；中间隔着空格或标点的保持两个空，语义更清楚。
 */
export function mergeAdjacentSpans(plain: string, spans: readonly ClozeSpan[]): ClozeSpan[] {
  const list = normalizeSpans(plain, spans);
  const out: ClozeSpan[] = [];
  for (const s of list) {
    const last = out[out.length - 1];
    if (last && s.start === last.end) last.end = s.end;
    else out.push({ start: s.start, end: s.end });
  }
  return out;
}

/** 纯文本 + 区间 → 挖空文本 + 答案（编号从 1 起连续） */
export function rangesToCloze(plain: string, spans: readonly ClozeSpan[]): { text: string; blanks: string[] } {
  const p = String(plain ?? '');
  const list = normalizeSpans(p, spans);
  let out = '';
  let last = 0;
  const blanks: string[] = [];
  for (const s of list) {
    out += p.slice(last, s.start);
    blanks.push(p.slice(s.start, s.end));
    out += `{{${blanks.length}}}`;
    last = s.end;
  }
  out += p.slice(last);
  return { text: out, blanks };
}

/** 挖完之后还剩多少可见字 */
export function visibleLength(plain: string, spans: readonly ClozeSpan[]): number {
  const p = String(plain ?? '');
  return normalizeSpans(p, spans).reduce((n, s) => n - (s.end - s.start), p.length);
}

export type AddSpanReason = 'empty' | 'tooLong' | 'visible';

export interface AddSpanResult {
  action: 'added' | 'removed' | 'rejected';
  spans: ClozeSpan[];
  /** action='removed' 时还原了几处 */
  count?: number;
  reason?: AddSpanReason;
}

/** 裁掉首尾空白（不碰换行，换行交给按段切分处理） */
function trimSpace(text: string, s: number, e: number): { start: number; end: number } {
  let a = s;
  let b = e;
  while (a < b && /[ \t\u3000]/.test(text[a])) a += 1;
  while (b > a && /[ \t\u3000]/.test(text[b - 1])) b -= 1;
  return { start: a, end: b };
}

/** 按换行把一个选区切成若干段内区间 */
function splitByLine(plain: string, s: number, e: number): ClozeSpan[] {
  const out: ClozeSpan[] = [];
  let cur = s;
  for (let i = s; i < e; i += 1) {
    if (plain[i] !== '\n') continue;
    const piece = trimSpace(plain, cur, i);
    if (piece.end > piece.start) out.push(piece);
    cur = i + 1;
  }
  const tail = trimSpace(plain, cur, e);
  if (tail.end > tail.start) out.push(tail);
  return out;
}

/**
 * 拖选一段 → 加空位；碰到已有空位 → 还原。
 *
 * 这是编辑器的核心动作，界面层只负责把 DOM 选区换算成两个下标。
 */
export function addSpan(
  plain: string,
  spans: readonly ClozeSpan[],
  start: number,
  end: number,
): AddSpanResult {
  const p = String(plain ?? '');
  const list = normalizeSpans(p, spans);
  let s = Math.min(start, end);
  let e = Math.max(start, end);
  s = Math.max(0, Math.min(p.length, s));
  e = Math.max(0, Math.min(p.length, e));

  const trimmed = trimSpace(p, s, e);
  if (trimmed.end <= trimmed.start) return { action: 'rejected', spans: list, reason: 'empty' };
  s = trimmed.start;
  e = trimmed.end;

  /* 与已有空位相交：用户想的是「把这块去掉」——按还原处理 */
  const hits = list.filter((b) => b.start < e && b.end > s);
  if (hits.length) {
    return { action: 'removed', spans: list.filter((b) => !hits.includes(b)), count: hits.length };
  }

  const pieces = splitByLine(p, s, e);
  if (!pieces.length) return { action: 'rejected', spans: list, reason: 'empty' };
  if (pieces.some((piece) => piece.end - piece.start > MAX_SPAN)) {
    return { action: 'rejected', spans: list, reason: 'tooLong' };
  }

  const next = mergeAdjacentSpans(p, [...list, ...pieces]);
  if (visibleLength(p, next) < MIN_VISIBLE) {
    return { action: 'rejected', spans: list, reason: 'visible' };
  }
  return { action: 'added', spans: next };
}

/** 点中一个空位 → 还原 */
export function removeSpan(spans: readonly ClozeSpan[], start: number, end: number): ClozeSpan[] {
  return spans.filter((s) => !(s.start === start && s.end === end));
}

/**
 * 从已有空位里精确去掉一小段（触屏点词取消用）。
 *
 * 相邻词会合并成一个空位，此时用户点其中一个词想取消的只是那个词：
 * 把区间切开，左边和右边各自保留，中间那段回原文。
 */
export function removeRangeFromSpans(
  spans: readonly ClozeSpan[],
  start: number,
  end: number,
): ClozeSpan[] {
  const out: ClozeSpan[] = [];
  for (const s of spans) {
    if (s.end <= start || s.start >= end) {
      out.push({ start: s.start, end: s.end });
      continue;
    }
    if (s.start < start) out.push({ start: s.start, end: start });
    if (s.end > end) out.push({ start: end, end: s.end });
  }
  return out;
}
