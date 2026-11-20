/* ============================================================
 * bz · 统一制卡的数据形状（review/card-wizard-model.ts）
 *
 * 「选一种复习方式 → 出题面 → 确认 → 入库」是这一版唯一的制卡流程，
 * bz-reader 的书内入口与 bz-review 自己的笔记入口共用它。
 *
 * 这里只放纯数据：四种方式、草稿形状、草稿 → Review 入库载荷、状态标记。
 * 界面在 card-wizard.ts，AI 在 card-ai.ts，本文件零 DOM、零模型调用。
 * ============================================================ */
import type { CardMode } from './card-mode';
import type { ReviewCardInput } from './reader-api';
import type { QuizQuestion } from './quiz-core/manager';

/** 统一弹窗里可选的方式（其余方式老卡照常复习，但不再从这里新造） */
export type WizardMode = Extract<CardMode, 'plain' | 'flashcard' | 'quiz' | 'cloze'>;

/** 顺序＝界面上的卡片顺序 */
export const WIZARD_MODES: readonly WizardMode[] = ['plain', 'flashcard', 'quiz', 'cloze'];

export interface WizardModeMeta {
  value: WizardMode;
  label: string;
  hint: string;
}

export const WIZARD_MODE_META: readonly WizardModeMeta[] = [
  { value: 'plain', label: '全文回忆', hint: '不调 AI，直接展开原文自己回忆' },
  { value: 'flashcard', label: '抽认卡', hint: 'AI 出一句正面提醒，背面是完整原文' },
  { value: 'quiz', label: '做题', hint: 'AI 出几道选择题，可删、可补、可重出' },
  { value: 'cloze', label: '挖空', hint: '把关键短语挖掉，自己填回去' },
];

/** 这个方式要不要调模型 */
export function modeNeedsAI(mode: WizardMode): boolean {
  return mode !== 'plain';
}

/** 确认题面那屏的草稿（一张卡一份） */
export interface WizardDraft {
  key: string;
  bookTitle: string;
  chapterTitle?: string;
  text: string;
  comment?: string;
  backlink?: string;
  sourceNote?: { path: string; from: number; to: number };
  mode: WizardMode;
  /** 抽认卡的正面问句 */
  front: string;
  /** 做题卡的列表标题（用户可改） */
  title: string;
  questions: QuizQuestion[];
  /** 挖空卡：带 {{n}} 的文本 + 各空答案 */
  cloze: { text: string; blanks: string[] } | null;
}

/** 列表短标题：压掉换行与多余空白，超长截断 */
export function clipTitle(text: string, max = 40): string {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  const chars = Array.from(flat);
  if (chars.length <= max) return flat;
  return chars.slice(0, max).join('') + '…';
}

/** 草稿 → Review 的入库载荷（确认之后才调它） */
export function draftToInput(d: WizardDraft): ReviewCardInput {
  const p: ReviewCardInput = {
    key: d.key,
    bookTitle: d.bookTitle,
    text: d.text,
    mode: d.mode,
  };
  if (d.chapterTitle) p.chapterTitle = d.chapterTitle;
  if (d.comment) p.comment = d.comment;
  if (d.backlink) p.backlink = d.backlink;
  if (d.sourceNote) p.sourceNote = d.sourceNote;

  if (d.mode === 'flashcard') {
    const q = String(d.front ?? '').trim();
    if (q) p.qa = { q, a: d.text };
  }
  if (d.mode === 'quiz') {
    if (d.questions.length) {
      p.questions = d.questions.map((q) => {
        const out: NonNullable<ReviewCardInput['questions']>[number] = {
          q: q.question,
          options: [...q.options],
          correct: [...q.correctIndices],
        };
        if (q.explain) out.explain = q.explain;
        return out;
      });
    }
    const title = clipTitle(d.title || d.questions[0]?.question || '');
    if (title) p.displayTitle = title;
  }
  if (d.mode === 'cloze' && d.cloze) {
    p.cloze = { text: d.cloze.text, blanks: [...d.cloze.blanks] };
    /* 列表靠这个短标题认出是谁；空位在复习时才揭开，标题用去掉空位的文字 */
    const title = clipTitle(d.cloze.text.replace(/\{\{\d+\}\}/g, ''));
    if (title) p.displayTitle = title;
  }
  return p;
}

export type WizardState = 'new' | 'exists' | 'over';

/**
 * 确认题面时先标出「已在计划 / 超出上限」（增强 4）。
 *
 * 已在计划的不占额度；其余按剩余额度依次标新增，超出标超额。
 */
export function markWizardStates(
  keys: readonly string[],
  existing: ReadonlySet<string>,
  remaining: number,
): WizardState[] {
  let free = Math.max(0, remaining === Infinity ? Infinity : Math.round(remaining));
  return (Array.isArray(keys) ? keys : []).map((key) => {
    if (existing.has(key)) return 'exists';
    if (free > 0) {
      free -= 1;
      return 'new';
    }
    return 'over';
  });
}
