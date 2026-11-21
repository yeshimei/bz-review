/* ============================================================
 * bz · 填空卡（review/cloze.ts）
 *
 * 第二种复习方式：把划线里最关键的一两处挖掉，让人凭上下文把词补回来。
 * 比抽认卡轻——不用回忆整段，只要认出「这个词该是什么」。
 *
 * 两条路线：
 *   · 有 AI：让模型挑「挖掉之后其余部分仍能独立读懂」的位置；
 *   · 没 AI：规则挖空——书名号、引号、数字、英文词优先，都没有就挖最长分句。
 *
 * 硬约束（和抽认卡同一条道理）：**不能把整句挖空**。提示面必须留下足够的
 * 上下文，否则复习就退化成猜谜。
 * ============================================================ */
import type { AIService } from '../core/ai';
import type { ReviewCard } from './data';
import { aiTextOf } from './card-text';
import { parseLooseJson } from './loose-json';
import { locale } from '../i18n/strings';

/** 挖空占位：`{{1}}`、`{{2}}`…。用双花括号是因为正文里几乎不会出现 */
export const CLOZE_SLOT_RE = /\{\{(\d+)\}\}/g;

export interface ClozeCard {
  /** 挖空后的句子，空位写成 `{{n}}` */
  text: string;
  /** 各空位的答案，下标 0 对应 `{{1}}` */
  blanks: string[];
  /** 生成时间（ms） */
  at: number;
}

/** 短于这个长度不挖：本来就没多少字，挖完等于没提示 */
const MIN_SOURCE = 4;
/** 一个空最多挖掉多少字（太长就变成背整句） */
const MAX_BLANK_LEN = 20;

/** 优先挖的候选：书名号/引号里的内容、数字、英文词 */
const CANDIDATE_RE = /《([^》]{1,20})》|「([^」]{1,20})」|“([^”]{1,20})”|\d+(?:\.\d+)?%?|[A-Za-z][A-Za-z-]{2,}/g;

interface Span {
  start: number;
  end: number;
}

/** 收集候选位置（按出现顺序） */
function collectSpans(text: string): Span[] {
  const out: Span[] = [];
  for (const m of text.matchAll(CANDIDATE_RE)) {
    const start0 = m.index ?? 0;
    // 书名号/引号只挖里面的字，符号留着——符号本身也是提示
    const inner = m[1] ?? m[2] ?? m[3];
    if (inner) {
      const at = m[0].indexOf(inner);
      out.push({ start: start0 + at, end: start0 + at + inner.length });
    } else {
      out.push({ start: start0, end: start0 + m[0].length });
    }
  }
  return out.filter((s) => s.end - s.start >= 1 && s.end - s.start <= MAX_BLANK_LEN);
}

/** 规则挖空：不用 AI 时的兜底 */
export function ruleCloze(source: string, maxBlanks = 2): ClozeCard {
  const text = String(source ?? '');
  const at = Date.now();
  if (Array.from(text).length < MIN_SOURCE) return { text, blanks: [], at };

  let spans = collectSpans(text).slice(0, Math.max(1, maxBlanks));

  // 一个候选都没有：挖最长的那一个分句
  if (!spans.length) {
    const pieces: Span[] = [];
    let segStart = 0;
    const splitAt = (from: number, to: number): void => {
      const core = text.slice(from, to).replace(/[，。；：、！？!?;:\n\s]+$/g, '');
      if (core.length >= 2) pieces.push({ start: from, end: from + core.length });
    };
    for (let i = 0; i < text.length; i++) {
      if (!/[，。；：、！？!?;:\n]/.test(text[i])) continue;
      splitAt(segStart, i + 1);
      segStart = i + 1;
    }
    splitAt(segStart, text.length);
    if (!pieces.length) return { text, blanks: [], at };
    pieces.sort((a, b) => b.end - b.start - (a.end - a.start));
    spans = [pieces[0]];
  }

  // 从后往前替换，避免前面的替换把后面的下标顶偏
  const ordered = [...spans].sort((a, b) => a.start - b.start);
  const blanks: string[] = [];
  let out = text;
  for (let i = ordered.length - 1; i >= 0; i--) {
    const s = ordered[i];
    out = `${out.slice(0, s.start)}{{${i + 1}}}${out.slice(s.end)}`;
  }
  for (const s of ordered) blanks.push(text.slice(s.start, s.end));

  return { text: out, blanks, at };
}

/** 去掉空位后的「可见文字」 */
function visibleOf(text: string): string {
  return String(text ?? '').replace(CLOZE_SLOT_RE, '');
}

/**
 * 挖空后的提示面还像不像原文。
 *
 * 判断用二字片段命中率：模型偶尔会把原文改写得面目全非，那种卡复习时
 * 对不上原文，宁可退回规则挖空。
 */
function resembles(visible: string, source: string): boolean {
  const v = visible.replace(/\s+/g, '');
  const s = String(source ?? '').replace(/\s+/g, '');
  if (!v) return false;
  if (Array.from(v).length < 4) return s.includes(v);
  const chars = Array.from(v);
  let hit = 0;
  let total = 0;
  for (let i = 0; i + 2 <= chars.length; i++) {
    total++;
    if (s.includes(chars.slice(i, i + 2).join(''))) hit++;
  }
  return total > 0 && hit / total >= 0.5;
}

/** 校验并归一一张填空卡；不合格返回 null */
/** unknown → 安全字符串（typeof 守卫，避免对象默认 stringification） */
function textOf(v: unknown): string {
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  return '';
}

export function validateCloze(raw: { text?: unknown; blanks?: unknown }, source: string): ClozeCard | null {
  const text = textOf(raw?.text).trim();
  const blanks = Array.isArray(raw?.blanks) ? raw.blanks.map((b) => String(b ?? '').trim()) : [];
  if (!text || !blanks.length) return null;
  if (blanks.some((b) => !b)) return null;

  // 占位符必须从 1 开始连续，数量与答案一一对应
  const nums = [...text.matchAll(CLOZE_SLOT_RE)].map((m) => Number(m[1]));
  if (!nums.length || nums.length !== blanks.length) return null;
  if (nums.some((n, i) => n !== i + 1)) return null;

  // 整句挖空 = 没有提示
  const visible = visibleOf(text);
  if (Array.from(visible.trim()).length < 4) return null;
  if (!resembles(visible, source)) return null;

  // 答案不能跟整段原文一样（模型偷懒时会出现）
  const src = String(source ?? '').replace(/\s+/g, '');
  if (blanks.some((b) => b.replace(/\s+/g, '') === src)) return null;

  return { text, blanks, at: Date.now() };
}

/** 解析模型回复 */
export function parseCloze(reply: string, source: string): ClozeCard | null {
  const text = String(reply ?? '');
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first < 0 || last <= first) return null;
  const parsed: unknown = parseLooseJson(text.slice(first, last + 1));
  if (!parsed) return null;
  return validateCloze(parsed, source);
}

/** 拼提示词 */
export function buildClozePrompt(card: ReviewCard): string {
  const book = String(card.bookTitle ?? '').trim();
  const chapter = String(card.chapterTitle ?? '').trim();
  if (locale() !== 'zh') {
    const enWhere = chapter ? `"${book}" ${chapter}` : `"${book}"`;
    return [
      'You are a memory-card designer. Below is a reading highlight; turn it into a fill-in-the-blank exercise.',
      '',
      'Requirements:',
      '1. Blank out 1-3 key spots; each blank holds a word or short phrase (2-12 characters), never a whole sentence.',
      '2. The remaining text must read on its own while **still pointing to this sentence** \u2014 it must not become a guessing game.',
      '3. Mark blanks as {{1}} {{2}} {{3}}, numbered consecutively from 1.',
      '4. The answers array follows blank order, copied verbatim from the source; no rewriting or added punctuation.',
      '5. Prefer numbers, proper nouns and key verbs; do not blank function words like "the" or "of".',
      '',
      'Output only one JSON object, no explanation, no code block:',
      '{"text": "the sentence with blanks written as {{1}}", "blanks": ["answer1", "answer2"]}',
      '',
      `Source: ${enWhere}`,
      `Highlight: ${aiTextOf(card)}`,
    ].join('\n');
  }
  const where = chapter ? `《${book}》${chapter}` : `《${book}》`;
  return [
    '你是记忆卡片设计助手。下面是一条读书划线，请把它做成填空题。',
    '',
    '要求：',
    '1. 挖 1~3 个关键处，每个空一个词语或短语（2~12 个字），不要挖整句；',
    '2. 挖掉之后剩下的文字必须能独立读懂，并且**仍然指向这句话**——不能变成猜谜；',
    `3. 空位用 {{1}} {{2}} {{3}} 标记，编号从 1 开始连续；`,
    '4. 答案数组按空位顺序给出，逐字照抄原文，不要改写、不要加标点；',
    '5. 优先挖掉数字、专有名词、关键动词；不要挖「的」「了」这类虚词。',
    '',
    '只输出一个 JSON 对象，不要解释、不要代码块：',
    '{"text": "挖空后的句子，空位写成 {{1}}", "blanks": ["答案1", "答案2"]}',
    '',
    `出处：${where}`,
    `划线原文：${aiTextOf(card)}`,
  ].join('\n');
}

/**
 * 让模型挖一次空。任何失败返回 null，调用方退回 ruleCloze。
 * 复习进行中不打日志、不弹窗——用户不需要知道模型怎么了。
 */
export async function generateCloze(
  card: ReviewCard,
  makeAI: () => AIService | null,
  isCancelled?: () => boolean
): Promise<ClozeCard | null> {
  let ai: AIService | null = null;
  try {
    ai = makeAI();
  } catch {
    return null;
  }
  if (!ai) return null;
  try {
    const reply = await ai.json(buildClozePrompt(card));
    if (isCancelled?.()) return null;
    return parseCloze(String(reply ?? ''), String(card.text ?? ''));
  } catch {
    return null;
  }
}

/** 答案归一：全角转半角、去空白、去标点、英文小写 */
export function normalizeAnswer(input: string): string {
  return String(input ?? '')
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
    .replace(/[\s\u00a0]+/g, '')
    .replace(/[，。；：、！？,.;:!?'"“”‘’（）()《》〈〉「」[\]【】—–\-_·…]/g, '')
    .toLowerCase();
}

/** 逐空判分；空位没填一律算错 */
export function checkBlanks(
  card: Pick<ClozeCard, 'blanks'>,
  answers: readonly string[]
): { ok: boolean; results: boolean[] } {
  const results = card.blanks.map((want, i) => {
    const got = String(answers?.[i] ?? '');
    if (!got.trim()) return false;
    return normalizeAnswer(got) === normalizeAnswer(want);
  });
  return { ok: results.length > 0 && results.every(Boolean), results };
}

export type ClozePart = { kind: 'text'; value: string } | { kind: 'slot'; index: number };

/** 把挖空文本拆成「文字 / 空位」交替的片段，供渲染层逐段生成 DOM */
export function renderClozeHtmlParts(text: string): ClozePart[] {
  const parts: ClozePart[] = [];
  const src = String(text ?? '');
  let last = 0;
  for (const m of src.matchAll(CLOZE_SLOT_RE)) {
    const before = src.slice(last, m.index);
    if (before) parts.push({ kind: 'text', value: before });
    parts.push({ kind: 'slot', index: Number(m[1]) });
    last = (m.index ?? 0) + m[0].length;
  }
  const tail = src.slice(last);
  if (tail) parts.push({ kind: 'text', value: tail });
  return parts;
}
