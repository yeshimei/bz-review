/* ============================================================
 * bz · 划线卡的 AI 内容（review/card-ai.ts）
 *
 * 复习这边只认三种方式，内容一律在**加入计划那一刻**生成一次，之后固定
 * 在卡上：抽认卡存一句问句，做题存一份题库，展开全文什么都不存。
 *
 * 两条口径：
 *   · **只生成一次**。卡上已经有当前方式要用的东西就跳过——每轮复习都重新
 *     问模型，既慢又变味（题库会漂移，复习就没法比较）。
 *   · **串行排队**。整本书一次加几十条划线时，逐张并发打模型只会一起超时。
 *     这里排成一条队，一张一张来，一张失败不影响后面；用户该看到的「已加入」
 *     早就返回了，生成在后台继续。
 * ============================================================ */
import { createAI, type AIService } from '../core/ai';
import { tryGetSettings } from '../core/settings-provider';
import type { ReviewCard } from './data';
import type { QuizQuestion } from './quiz-core/manager';
import { generateFlashcard } from './flashcard';
import { generateCardQuiz } from './card-quiz';
import { generateCloze, ruleCloze } from './cloze';
import type { CardMode } from './card-mode';

/* 方式的判定口径搬到 `card-mode.ts`（纯函数、不依赖模型服务，可被单测钉住）；
   这里原样再导出，既有调用方一行都不用改。 */
export type { CardMode } from './card-mode';
export { CARD_MODES, cardModeOf, defaultCardMethod, isCardMode, modeOfCard } from './card-mode';

/** 每轮抽题比例（分母）：2=一半、3=三分之一、4=四分之一 */
export function cardQuizRatioOf(settings?: unknown): number {
  const s: unknown = settings ?? tryGetSettings();
  const ratio = s && typeof s === 'object' && 'reviewCardQuizRatio' in s
    ? (s as { reviewCardQuizRatio?: unknown }).reviewCardQuizRatio
    : undefined;
  const n = Math.round(Number(ratio) || 3);
  return Math.min(4, Math.max(2, n));
}

/** 生成一张卡需要的全部外部能力（测试里注入假的就行） */
export interface CardPrepareContext {
  mode: CardMode;
  /** 按钥匙读回卡的最新内容（排期表可能刚被别处改过） */
  loadCard: (key: string) => Promise<ReviewCard | null>;
  updateCard: (key: string, patch: Partial<ReviewCard>) => Promise<unknown>;
  loadQuiz: (key: string) => Promise<QuizQuestion[] | null>;
  saveQuiz: (key: string, questions: QuizQuestion[]) => Promise<void>;
  /** 建 AI 服务；没配好时返回 null（不许抛） */
  makeAI: () => AIService | null;
}

/** 包一层 createAI：没配 AI 时它可能抛，这里统一收成 null */
export function safeMakeAI(): AIService | null {
  try {
    return createAI();
  } catch {
    return null;
  }
}

/** 生成结果（还没写盘）：确认之后才替换掉卡上的旧题面 */
export interface CardContentDraft {
  mode: CardMode;
  qa?: { q: string; a: string; at: number };
  cloze?: { text: string; blanks: string[]; at: number };
  questions?: QuizQuestion[];
}

/**
 * 只生成、不写盘。
 *
 * 「重新生成」2026-11-19 起要先过一次确认页（用户改完才替换），所以把生成
 * 与落盘拆开：这个函数出草稿，`ensureCardContent` 负责在后台补内容，界面侧
 * 拿到草稿先给用户看。
 */
export async function generateCardContent(
  card: ReviewCard,
  ctx: CardPrepareContext,
): Promise<CardContentDraft | null> {
  if (!card?.key) return null;
  if (ctx.mode === 'plain') return null;
  /* 上下文卡用的是阅读器给的 before/after，没有要生成的东西 */
  if (ctx.mode === 'context') return null;
  /* 媒体卡 / 图片遮挡：内容来自用户提供的文件，不经过 AI（清单2第2条：AI 看图能力留给将来） */
  if (ctx.mode === 'media' || ctx.mode === 'occlusion') return null;

  if (ctx.mode === 'flashcard') {
    const res = await generateFlashcard(card, ctx.makeAI);
    if (!res?.q) return null;
    return { mode: 'flashcard', qa: { q: res.q, a: res.a, at: Date.now() } };
  }

  if (ctx.mode === 'cloze') {
    /* 先问模型；模型不给、或给得不合格，退回规则挖空——复习不能因为模型卡住 */
    const made = (await generateCloze(card, ctx.makeAI)) ?? ruleCloze(String(card.text ?? ''));
    if (!made.blanks?.length || !made.text.includes('{{1}}')) return null;
    return { mode: 'cloze', cloze: made };
  }

  const list = await generateCardQuiz(card, ctx.makeAI);
  if (!list?.length) return null;
  return { mode: 'quiz', questions: list };
}

/** 把一份草稿写到卡上（确认之后调用） */
export async function applyCardContent(card: ReviewCard, ctx: CardPrepareContext, draft: CardContentDraft): Promise<boolean> {
  if (!card?.key || !draft) return false;
  if (draft.mode === 'flashcard') {
    if (!draft.qa?.q) return false;
    await ctx.updateCard(card.key, { qa: draft.qa });
    return true;
  }
  if (draft.mode === 'cloze') {
    if (!draft.cloze?.blanks?.length) return false;
    await ctx.updateCard(card.key, { cloze: draft.cloze });
    /* 挖空句当列表短标题（去掉 {{1}} 标记）；纯展示，不进编辑界面。 */
    const sentence = String(draft.cloze.text ?? '').replace(/\{\{\d+\}\}/g, '').trim();
    if (sentence) await ctx.updateCard(card.key, { displayTitle: sentence });
    return true;
  }
  if (!draft.questions?.length) return false;
  await ctx.saveQuiz(card.key, draft.questions);
  /* 做题卡的题目在独立题库、卡上拿不到；回填第一题题干当列表短标题，
     让同章的十几道题在复习列表里分得清。纯展示字段，不进编辑界面。 */
  const firstQ = String(draft.questions[0]?.question ?? '').trim();
  if (firstQ) await ctx.updateCard(card.key, { displayTitle: firstQ });
  return true;
}

/**
 * 给一张卡补齐当前方式要用的内容。
 *
 * 返回「这次真的生成了吗」——调用方据此决定要不要刷新界面。`force` 为 true
 * 时无视已有内容覆盖（「重新生成」按钮），否则已有就跳过。
 */
export async function ensureCardContent(
  card: ReviewCard,
  ctx: CardPrepareContext,
  force = false,
): Promise<boolean> {
  if (!card?.key) return false;
  if (ctx.mode === 'plain') return false;
  // 上下文卡用的是阅读器给的 before/after，没有要生成的东西
  if (ctx.mode === 'context') return false;
  // 媒体卡 / 图片遮挡：文件由用户配，AI 不生成内容
  if (ctx.mode === 'media' || ctx.mode === 'occlusion') return false;
  /* 手改过的卡不再自动补：后台预生成会把手写的问答/挖空顶掉，
     而这正是用户刚动手改过的东西。显式「重新生成」走 force，照旧可以覆盖。 */
  if (!force && card.manual) return false;

  if (ctx.mode === 'flashcard') {
    if (!force && String(card.qa?.q ?? '').trim()) return false;
  } else if (ctx.mode === 'cloze') {
    if (!force && card.cloze?.text && card.cloze.blanks?.length) return false;
  } else if (!force) {
    const have = await ctx.loadQuiz(card.key);
    if (have && have.length) return false;
  }

  const draft = await generateCardContent(card, ctx);
  if (!draft) return false;
  return applyCardContent(card, ctx, draft);
}

/** 正在排队/生成中的钥匙（同一张卡被连点两次不排两遍） */
const pending = new Set<string>();
/** 串行链：一张一张来，避免整本书加入时几十个请求一起打出去 */
let chain: Promise<void> = Promise.resolve();

/**
 * 后台排队给若干张卡补内容。
 *
 * 返回的是队列的尾巴，测试里可以直接 await；正常调用方不用等（`void` 掉），
 * 「已加入」的反馈不该卡在模型上。
 */
export function queueCardPreparation(
  keys: readonly string[],
  ctx: CardPrepareContext,
  force = false,
): Promise<void> {
  const list = Array.from(new Set((Array.isArray(keys) ? keys : []).map((k) => String(k ?? '').trim()).filter(Boolean)));
  const todo = list.filter((k) => !pending.has(k));
  if (!todo.length) return chain;
  for (const k of todo) pending.add(k);
  chain = chain.then(async () => {
    for (const key of todo) {
      try {
        const card = await ctx.loadCard(key);
        if (card) await ensureCardContent(card, ctx, force);
      } catch {
        /* 一张失败不影响后面：卡片本身还在，复习时还能退回普通提示 */
      } finally {
        pending.delete(key);
      }
    }
  });
  return chain;
}

/** 当前还有几张在排队（面板刷新/测试断言用） */
export function pendingCardCount(): number {
  return pending.size;
}
