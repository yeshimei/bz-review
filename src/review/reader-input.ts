/* ============================================================
 * 阅读器交来的卡片的纯口径（review/reader-input.ts）
 *
 * bz Reader 三选一制卡：全文回忆 / 抽认卡 / 做题。
 * 抽认卡的 qa 已经由 card-input.ts 处理；这里补另外两件事：
 *   1. 做题的题目：阅读器出好题交过来，转成 Review 题库格式，避免二次生成；
 *   2. 额度预知：阅读器批量列表要提前标「超出基础版上限」。
 *
 * 全是纯数据转换，不碰 DOM、不碰文件 IO——IO 在门面（main.ts）里做。
 * ============================================================ */
import { quotaInfo, type PlanCounts, type QuotaInfo } from '../data/entitlement';

/** 阅读器交来的一道题（q/correct 简写，与 reader 的 DraftQuestion 对齐） */
export interface QuizInput {
  q: string;
  options: string[];
  correct: number[];
  explain?: string;
}

/** Review 题库里的一道题（quiz-core/manager.ts 的 QuizQuestion） */
export interface QuizQuestionOut {
  question: string;
  options: string[];
  correctIndices: number[];
  explain?: string;
}

/** 阅读器的题 → Review 题库格式。过滤缺字段/下标越界/重复题。 */
/** unknown → 安全字符串（typeof 守卫，避免对象默认 stringification） */
function textOf(v: unknown): string {
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  return '';
}

export function toQuizQuestions(items: readonly QuizInput[]): QuizQuestionOut[] {
  const out: QuizQuestionOut[] = [];
  const seen = new Set<string>();
  const list: readonly QuizInput[] = Array.isArray(items) ? items : [];
  for (const raw of list) {
    const q = textOf(raw?.q).trim();
    const options = Array.isArray(raw?.options)
      ? raw.options.map((o: unknown) => textOf(o).trim()).filter(Boolean)
      : [];
    const correct: number[] = Array.isArray(raw?.correct)
      ? raw.correct.map((c: number) => Number(c)).filter((n: number) => Number.isInteger(n))
      : [];
    if (!q || options.length < 2 || !correct.length) continue;
    if (correct.some((i) => i < 0 || i >= options.length)) continue;
    const key = q.replace(/\s+/g, '');
    if (seen.has(key)) continue;
    seen.add(key);
    const item: QuizQuestionOut = {
      question: q,
      options,
      correctIndices: [...new Set(correct)].sort((a, b) => a - b),
    };
    const explain = textOf(raw?.explain).trim();
    if (explain) item.explain = explain;
    out.push(item);
  }
  return out;
}

/** 一张外部输入卡（只用到这里需要的字段；读者侧结构的子集） */
export interface InputCardLike {
  key?: unknown;
  questions?: unknown;
  qa?: unknown;
  cloze?: unknown;
}

/**
 * 只给「真正入库」的卡交题目。
 *
 * addedKeys 是 addCards 返回的、这次新进来的钥匙；没入库的卡不交题目，
 * 免得题库里堆一堆没有主人的孤儿题。
 */
export function quizOf(
  cards: readonly InputCardLike[],
  addedKeys: readonly string[],
): Record<string, QuizQuestionOut[]> {
  const ok = new Set((Array.isArray(addedKeys) ? addedKeys : []).map((k) => String(k ?? '').trim()));
  const out: Record<string, QuizQuestionOut[]> = {};
  const list: readonly InputCardLike[] = Array.isArray(cards) ? cards : [];
  for (const c of list) {
    const key = textOf(c?.key).trim();
    if (!ok.has(key)) continue;
    const qs = (c as { questions?: unknown })?.questions;
    if (!Array.isArray(qs) || !qs.length) continue;
    const list = toQuizQuestions(qs as QuizInput[]);
    if (list.length) out[key] = list;
  }
  return out;
}

/** 已经自带题面（qa）/ 题目（questions）/ 挖空空位（cloze）的卡，不需要后台再生成。 */
export function withoutPrepared(
  keys: readonly string[],
  cards: readonly InputCardLike[],
): string[] {
  const prepared = new Set<string>();
  const list: readonly InputCardLike[] = Array.isArray(cards) ? cards : [];
  for (const c of list) {
    const key = textOf(c?.key).trim();
    if (!key) continue;
    const hasQa = !!(c as { qa?: unknown })?.qa && typeof (c as { qa: { q?: unknown } }).qa.q === 'string'
      && String((c as { qa: { q?: unknown } }).qa.q).trim();
    const hasQs = Array.isArray((c as { questions?: unknown })?.questions)
      && ((c as { questions: unknown[] }).questions.length > 0);
    const cloze = (c as { cloze?: { text?: unknown; blanks?: unknown } })?.cloze;
    const hasCloze = !!cloze && typeof cloze.text === 'string'
      && Array.isArray(cloze.blanks) && cloze.blanks.length > 0;
    if (hasQa || hasQs || hasCloze) prepared.add(key);
  }
  return (Array.isArray(keys) ? keys : [])
    .map((k) => String(k ?? '').trim())
    .filter((k) => k && !prepared.has(k));
}

/** 复习条目合计额度（笔记 + 划线；额度逻辑只在 entitlement 里有一份，这里转个口） */
export function cardQuota(counts: PlanCounts): QuotaInfo {
  return quotaInfo(counts);
}
