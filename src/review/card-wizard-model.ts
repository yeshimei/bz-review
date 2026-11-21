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
import { t as tr, type MsgKey } from '../i18n/strings';

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

/** 方式名与说明的文案 key（WIZARD_MODE_META 是中文基准，渲染取这里） */
const WIZARD_MODE_KEYS: Record<WizardMode, { label: MsgKey; hint: MsgKey }> = {
  plain: { label: 'cwm.label.plain', hint: 'cwm.hint.plain' },
  flashcard: { label: 'cwm.label.flashcard', hint: 'cwm.hint.flashcard' },
  quiz: { label: 'cwm.label.quiz', hint: 'cwm.hint.quiz' },
  cloze: { label: 'cwm.label.cloze', hint: 'cwm.hint.cloze' },
};

/** 按当前语言出词的方式表（选方式那屏用） */
export function wizardModeMetaList(): WizardModeMeta[] {
  return WIZARD_MODES.map((value) => ({
    value,
    label: tr(WIZARD_MODE_KEYS[value].label),
    hint: tr(WIZARD_MODE_KEYS[value].hint),
  }));
}

/** 这个方式要不要调模型 */
export function modeNeedsAI(mode: WizardMode): boolean {
  return mode !== 'plain';
}

/** 方式的中文名（确认页那句「已按设置使用「全文回忆」」要用） */
export function modeLabelOf(mode: WizardMode): string {
  return tr(WIZARD_MODE_KEYS[mode].label);
}

/** 确认题面那屏的草稿（一张卡一份） */
export interface WizardDraft {
  key: string;
  bookTitle: string;
  chapterTitle?: string;
  text: string;
  /** 只给模型看的节选（整篇笔记才有；缺省用 text） */
  aiText?: string;
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
  /** AI 没生成出来，这张用的是原文 / 规则兜底（卡上要提示「重试这一张」） */
  aiFailed?: boolean;
}

/**
 * 批量确认页的审核进度一行（2026-11-21 增强）。
 *
 * 只有「真的滚到过这张卡」才算看过——按草稿数量算进度是假的，用户可能一眼没看。
 */
export function auditText(total: number, seen: number): string {
  const t = Math.max(0, Number(total) || 0);
  const s = Math.min(Math.max(0, Number(seen) || 0), t);
  return s >= t ? tr('cwm.countAll', { n: t }) : tr('cwm.countSome', { n: t, seen: s });
}

/**
 * 预设方式下确认页的说明（2026-11-21 增强）。
 *
 * 批量时要让人知道「这一批都是设置里那个方式生成的」，不是系统替他挑的。
 */
export function presetModeNote(label: string, total: number): string {
  const n = Math.max(1, Number(total) || 1);
  const head = n > 1
    ? tr('cwm.batchDefault', { n, label })
    : tr('cwm.oneDefault', { label });
  return head + tr('cwm.changeDefault', { head: '' });
}

/**
 * 兜底问句取哪一行：跳过标题行与列表符号，别让「# 某笔记 ## 划线摘录 >」当问句。
 *
 * AI 出不来时抽认卡要拿原文顶正面（2026-11-21 真机发现整篇笔记的标题行全串一起）。
 */
export function plainHeadOf(text: string): string {
  const raw = String(text ?? '');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    /* Markdown 标题不是正文，跳过 */
    if (/^#{1,6}\s/.test(trimmed)) continue;
    const body = trimmed
      .replace(/^>\s*/, '')
      .replace(/^[-*+]\s+/, '')
      .replace(/^\d+[.)、]\s*/, '')
      .trim();
    if (body) return body;
  }
  return raw.replace(/^#{1,6}\s*/gm, '').trim();
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
  if (d.aiText) p.aiText = d.aiText;
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
  return (keys ?? []).map((key) => {
    if (existing.has(key)) return 'exists';
    if (free > 0) {
      free -= 1;
      return 'new';
    }
    return 'over';
  });
}
