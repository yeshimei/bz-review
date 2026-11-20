/* ============================================================
 * bz · 从阅读器选内容（review/source-pick.ts）
 *
 * 2026-11-21 用户拍板：**复习相关的一切逻辑都归 Review**。bz-reader 只负责
 * 交内容（书、划线、章节正文），挑范围 / AI 挑重点 / 每章上限都在这里做。
 *
 * 三种来源，都归一成制卡窗口认的 `CardWizardSource[]`：
 *   marks       每条划线一张（不调 AI）
 *   marksKey    AI 判断哪些划线值得长期记
 *   chaptersKey AI 读正文自己挑句子（每句一张）
 *
 * 钥匙口径与 bz-reader 原实现一致（`reader:<书>:<划线>` / 书+章+句的短哈希），
 * 同一份内容无论从哪个入口加入，Review 那边都会认成同一张卡。
 *
 * 本文件零 DOM、零 obsidian 依赖，ask / chapterText 注入，单测直接跑。
 * ============================================================ */
import type { CardWizardSource } from './card-wizard';

/* ─────────── 数据形状（与 bz-reader 的 readerApi 对齐） ─────────── */

export interface PickMark {
  id: string;
  chapterIndex: number;
  chapterTitle: string;
  text: string;
  comment: string;
}

export interface PickChapter {
  index: number;
  title: string;
}

/** 一章的划线概况（「按划线」选择列表） */
export interface MarkChapterGroup {
  title: string;
  index: number;
  count: number;
  chars: number;
}

export type PickScope = 'marks' | 'marksKey' | 'chaptersKey';

/** 超过这个字数给严重警告（用户可能没意识到在烧钱） */
export const PICK_WARN_CHARS = 20000;
/** 超过这个字数直接拦住，不让发 */
export const PICK_BLOCK_CHARS = 50000;

/** 解析来源需要的全部外部能力（测试里注入假的就行） */
export interface PickDeps {
  bookId: string;
  bookTitle: string;
  marks: readonly PickMark[];
  chapters: readonly PickChapter[];
  ask: (prompt: string) => Promise<string>;
  chapterText: (index: number) => Promise<string>;
}

/* ─────────── 划线分组与统计 ─────────── */

/**
 * 把一本书的划线按章分组。
 *
 * 用划线自带的章节字段而不是书的目录：用户可能只划了三章，目录里却有三十章，
 * 按目录列会摆出二十七个「0 条」的空行。同名章节按 index 分开。
 */
export function markChapterGroups(marks: readonly PickMark[]): MarkChapterGroup[] {
  const order: string[] = [];
  const at = new Map<string, MarkChapterGroup>();
  for (const m of marks) {
    const index = Number.isFinite(m.chapterIndex) ? m.chapterIndex : 0;
    const title = String(m.chapterTitle || '').trim();
    const key = `${index}\u0001${title}`;
    let g = at.get(key);
    if (!g) {
      g = { title, index, count: 0, chars: 0 };
      at.set(key, g);
      order.push(key);
    }
    g.count += 1;
    g.chars += Array.from(String(m.text || '')).length + Array.from(String(m.comment || '')).length;
  }
  return order.map((k) => at.get(k)!);
}

/** 选中的章节里一共有多少条划线 / 多少字 */
export function pickedMarkStats(marks: readonly PickMark[], picked: readonly string[]): { count: number; chars: number } {
  const set = new Set(picked);
  let count = 0;
  let chars = 0;
  for (const m of marks) {
    const index = Number.isFinite(m.chapterIndex) ? m.chapterIndex : 0;
    if (!set.has(`${index}\u0001${String(m.chapterTitle || '').trim()}`)) continue;
    count += 1;
    chars += Array.from(String(m.text || '')).length + Array.from(String(m.comment || '')).length;
  }
  return { count, chars };
}

/** 选中章节的划线（保持原顺序） */
export function pickedMarks(marks: readonly PickMark[], picked: readonly string[]): PickMark[] {
  const set = new Set(picked);
  return marks.filter((m) => {
    const index = Number.isFinite(m.chapterIndex) ? m.chapterIndex : 0;
    return set.has(`${index}\u0001${String(m.chapterTitle || '').trim()}`);
  });
}

/** 按章节模式：从全书章节里挑出用户勾选的那些，保持原书顺序 */
export function pickedChapters(chapters: readonly PickChapter[], picked: ReadonlySet<number>): PickChapter[] {
  return (chapters ?? []).filter((c) => picked.has(c.index));
}

/* ─────────── 钥匙（与 bz-reader 的既有权口径一致） ─────────── */

/** 划线卡的钥匙：`reader:<bookId>:<highlightId>` */
export function markCardKey(bookId: string, markId: string): string {
  return `reader:${String(bookId || '').trim()}:${String(markId || '').trim()}`;
}

/**
 * 正文卡的钥匙：书 + 章节 + 句子算一个稳定短哈希。
 *
 * 同一句话无论挑几次、从哪个入口进来，钥匙都一样，重复加入会被 Review
 * 当成已存在。只用 32 位 FNV-1a——钥匙只需要「同一库里不撞」，不需要抗碰撞。
 */
export function aiCardKey(bookId: string, chapterTitle: string, text: string): string {
  const raw = `${String(bookId || '')}\u0001${String(chapterTitle || '')}\u0001${String(text || '').replace(/\s+/g, '')}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i += 1) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `reader:${String(bookId || '').trim()}:ai:${(h >>> 0).toString(36)}`;
}

/* ─────────── 「按划线挑」的提示词 ─────────── */

export interface PickCandidate {
  id: string;
  text: string;
  comment?: string;
}

/**
 * 「按划线挑」的提示词。
 *
 * 为什么强调「别为了凑比例硬删」：模型很容易把「挑重点」理解成「删掉一半」，
 * 于是一本划得很克制的书也被砍掉一半——用户划的时候已经筛过一遍了。
 */
export function buildMarkPickPrompt(bookTitle: string, chapterTitle: string, candidates: readonly PickCandidate[]): string {
  const where = chapterTitle ? `《${bookTitle}》${chapterTitle}` : `《${bookTitle}》`;
  const lines = candidates
    .map((c, i) => {
      const idea = String(c.comment ?? '').trim();
      return `${i + 1}. [id=${c.id}] ${String(c.text ?? '').trim()}${idea ? `\n   我的想法：${idea}` : ''}`;
    })
    .join('\n');
  return [
    `下面是${where}的读书划线，一共 ${candidates.length} 条。请判断哪些值得长期记住、反复复习。`,
    '',
    '判断标准：',
    '1. 有观点、讲因果、给方法、能独立成问的——值得记；',
    '2. 纯景物描写、纯过渡、纯抒情，读了也考不出东西的——不值得；',
    '3. 同一件事划了好几条的，只留信息量最大的一条。',
    '',
    '重要：用户划线时已经筛过一遍了，所以**不要为了凑比例硬删**。',
    '如果这一批都值得记，就全部保留；宁可少删，也不要删掉真正有观点的句子。',
    '',
    '只输出一个 JSON 对象，不要解释、不要代码块：',
    '{"keep": ["id1", "id2"]}',
    '',
    '划线：',
    lines,
  ].join('\n');
}

/**
 * 从回复里取保留的 id。
 *
 * 宽容解析（模型爱包一层代码块或前言），但只认输入里真实存在的 id。
 * 返回 null = 解析不出来（调用方保底全留）；[] = 模型明确说一条都不留。
 */
export function parsePickedIds(reply: string, validIds: readonly string[]): string[] | null {
  const text = String(reply ?? '');
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first < 0 || last <= first) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(first, last + 1));
  } catch {
    return null;
  }
  const raw = (parsed as { keep?: unknown })?.keep;
  if (!Array.isArray(raw)) return null;
  const valid = new Set(validIds.map((x) => String(x)));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const id = String(item ?? '').trim();
    if (!id || seen.has(id) || !valid.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/* ─────────── 「按章节挑」的提示词 ─────────── */

/**
 * 「按章节挑」的提示词。
 *
 * `limit` 为 0 表示不限制（默认）：让模型按这一章的长度自己定张数。
 * 给了上限才在末尾补一句，而且用的是「最多」——不是「必须出够」。
 */
export function buildChapterCardPrompt(bookTitle: string, chapterTitle: string, body: string, limit = 0): string {
  const where = chapterTitle ? `《${bookTitle}》${chapterTitle}` : `《${bookTitle}》`;
  const cap = Math.max(0, Math.round(Number(limit) || 0));
  const countRule = cap
    ? `4. 最多出 ${cap} 张，按这一章的信息密度自己决定实际出几张，不够就不出满。`
    : '4. 张数由这一章的长度和信息密度决定：短章 3~5 张，中等 5~8 张，长章 8~12 张。宁可少而精，不要凑数。';
  return [
    `下面是${where}的正文。请从中挑出值得长期记住的内容，做成问答卡。`,
    '',
    '要求：',
    '1. 每张卡一个知识点：text 是原文里的那句话（原样摘录，不改写、不概括）；',
    '2. q 是一个不能照抄原文的问句，要能独立读懂；a 是简短答案，可以引用原文；',
    '3. 不要出「这段出自哪本书」「作者是谁」「这章标题是什么」这类靠元信息就能猜的题；',
    countRule,
    '',
    '只输出一个 JSON 对象，不要解释、不要代码块：',
    '{"cards": [{"text": "原文那句", "q": "问题", "a": "答案"}]}',
    '',
    '正文：',
    String(body ?? ''),
  ].join('\n');
}

export interface PickedCard {
  text: string;
  q: string;
  a: string;
}

/**
 * 解析「按章节挑」的回复。
 *
 * 三道校验：text 和 q 都得有；text 必须是正文里真实出现过的片段；同一条原文只留第一张。
 */
export function parseChapterCards(reply: string, body = ''): PickedCard[] {
  const text = String(reply ?? '');
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first < 0 || last <= first) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(first, last + 1));
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') return [];
  const raw = (parsed as { cards?: unknown }).cards;
  if (!Array.isArray(raw)) return [];
  const asText = (v: unknown): string => {
    if (typeof v === 'string') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    return '';
  };
  const flat = (s: unknown): string => asText(s).replace(/\s+/g, '');
  const source = flat(body);
  const seen = new Set<string>();
  const out: PickedCard[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const it = item as Record<string, unknown>;
    const t = asText(it.text).replace(/\s+/g, ' ').trim();
    const q = asText(it.q).trim();
    if (!t || !q) continue;
    if (source && !source.includes(flat(t))) continue;
    if (seen.has(flat(t))) continue;
    seen.add(flat(t));
    const a = asText(it.a).trim();
    out.push({ text: t, q, a });
  }
  return out;
}

/* ─────────── 解析来源 → 待制卡内容 ─────────── */

/** 划线 → 制卡来源（钥匙带划线 id，稳定判重） */
function markSource(bookId: string, bookTitle: string, m: PickMark): CardWizardSource {
  const src: CardWizardSource = {
    key: markCardKey(bookId, m.id),
    bookTitle,
    text: m.text,
  };
  if (m.chapterTitle) src.chapterTitle = m.chapterTitle;
  if (m.comment) src.comment = m.comment;
  return src;
}

/**
 * 解析范围 → 待制卡的原文列表。
 *
 * AI 出错的口径：挑重点解析不出来就保底全留；正文挑句子按章逐批处理，
 * 空正文跳过、原文校验不过的句子丢掉。
 */
export async function resolvePick(scope: PickScope, deps: PickDeps): Promise<CardWizardSource[]> {
  const { bookId, bookTitle, marks, chapters, ask, chapterText } = deps;
  const out: CardWizardSource[] = [];

  if (scope === 'marks') {
    for (const m of marks) out.push(markSource(bookId, bookTitle, m));
    return out;
  }

  if (scope === 'marksKey') {
    const byChapter = new Map<string, PickMark[]>();
    for (const m of marks) {
      const k = `${m.chapterIndex ?? 0}\u0001${m.chapterTitle ?? ''}`;
      const arr = byChapter.get(k) ?? [];
      arr.push(m);
      byChapter.set(k, arr);
    }
    for (const [, list] of byChapter) {
      const candidates = list.map((m) => ({ id: m.id, text: m.text, comment: m.comment }));
      const reply = await ask(buildMarkPickPrompt(bookTitle, list[0]?.chapterTitle ?? '', candidates));
      const ids = parsePickedIds(reply, list.map((m) => m.id));
      const keep = new Set(ids === null ? list.map((m) => m.id) : ids);
      for (const m of list) if (keep.has(m.id)) out.push(markSource(bookId, bookTitle, m));
    }
    return out;
  }

  /* chaptersKey：逐章读正文、按段落交给 AI 挑句子 */
  for (const c of chapters) {
    const body = String((await chapterText(c.index)) ?? '').trim();
    if (!body) continue;
    const picked = parseChapterCards(await ask(buildChapterCardPrompt(bookTitle, c.title, body)), body);
    for (const p of picked) {
      out.push({
        key: aiCardKey(bookId, c.title, p.text),
        bookTitle,
        chapterTitle: c.title,
        text: p.text,
      });
    }
  }
  return out;
}

/**
 * 每章最多几张：按 chapterTitle 分组，保留每组前 limit 条。
 *
 * 统一制卡契约里没有「每章上限」这个概念，所以由 Review 在交出去之前先截掉。
 * 0 / 负数 = 不限制；空章节名的自成一章。
 */
export function capSourcesPerChapter(sources: readonly CardWizardSource[], limit: number): CardWizardSource[] {
  const cap = Math.max(0, Math.round(Number(limit) || 0));
  if (cap <= 0) return Array.from(sources);
  const seen = new Map<string, number>();
  const out: CardWizardSource[] = [];
  for (const s of sources) {
    const key = s.chapterTitle ?? '';
    const n = seen.get(key) ?? 0;
    if (n >= cap) continue;
    seen.set(key, n + 1);
    out.push(s);
  }
  return out;
}
