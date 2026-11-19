/* ============================================================
 * bz · 划线卡复习会话（review/card-session.ts）
 *
 * 复习一条划线卡不该打开任何文件——内容就在条目里。三种方式由复习计划这边
 * 定（设置里的「复习方式」），这里只管把选中的那种跑完：
 *
 *   · **抽认卡**：先给一句问句，点开看全文，再自评。问句不能等于答案——
 *     一上来给全文就是重读，看一眼点「容易」，排期直接失真。
 *   · **做题**：题库在加入计划时生成好了，这里只抽三分之一出来做。答完按
 *     正确率定难度（口径与做题冲刺同源：九成以上容易、七成以上一般……）。
 *   · **展开全文**：不碰模型，全文摆出来直接评。
 *
 * 三条共同取舍：
 *   · **答案必须一眼对得上**：全文 + 当时的想法 + 回原文，一个不少。
 *   · **卡住也能复习**：没配模型、题库没生成出来，退回「展开全文」，不让用户
 *     卡在空白页上。
 *   · **不碰文件**：这条链路要能在没网、没那本书的情况下跑完。
 * ============================================================ */
import type { App } from 'obsidian';
import { isCardItem, type ReviewCard, type ReviewItem } from './data';
import type { Rating } from './fsrs';
import type { CardMode } from './card-ai';
import { QUIZ_RATIO, pickCardQuestions } from './card-quiz';
import type { QuizQuestion } from './quiz-core/manager';
import { checkBlanks, renderClozeHtmlParts } from './cloze';
import { contextPromptOf } from './context';
import { clozeContentUsable, clozeSlotWidth, clozeViewOf, promptViewFor, quizViewOf } from './card-prompt';
import { stageNum } from './render';
import { accuracyToRating } from './sprint';
import { ratingForKey, ratingKeys } from './keys';
import { openCardEditor } from './card-edit';
import { getSettings } from '../core/settings-provider';
import { modeMetaOf, modeOfItem, queueRowsOf, switchNoticeOf, typeBucketsOf } from './review-flow';
import { CardAudio } from './card-audio';
import type { TtsConfig } from '../core/tts-client';
import { backlinkOfCard } from './reader-jump';
import { readerJumpUrl } from '../core/reader-link';
import { openExternalUrl } from '../core/utils';
import { canUseCapability, capabilityBlock } from '../data/entitlement';

/* 提示面与它的状态机住在 card-prompt.ts —— 那里不碰 obsidian 和 DOM，node 里
   能直接断言「问过之后必须有字」。此处转出，保持既有引用面不变。 */
export { promptOf, promptViewFor } from './card-prompt';

/** Obsidian 内部插件注册表（App 类型未公开，只用于「bz-reader 是否安装」判定） */
interface PluginRegistryHost {
  plugins?: { plugins?: Record<string, unknown> };
}

/* ==================== 听卡片 / 跳回原文：可单测的纯逻辑 ====================
   这两块的 UI 都走 innerHTML 整段替换，真机点击在 node 里不好测；把「文案 / 朗读文本 /
   按钮要不要出现」抽成纯函数，测试盯住它们，渲染函数只做转义与拼接。 */
export const SPEAK_CHAR_LIMIT = 200;

export type SpeakState = 'idle' | 'loading' | 'playing';

/** 朗读按钮三态文案：准备中 / 停止 / 听这张 */
export function speakLabelOf(state: SpeakState): string {
  return state === 'loading' ? '准备中…' : state === 'playing' ? '停止' : '听这张';
}

/** 朗读文本：优先 AI 问答，其次划线原文；超过上限截断并标记，由调用方给一句人话 */
export function speakTextOf(
  card: { text?: string; qa?: { q?: string; a?: string } } | null | undefined,
  limit = SPEAK_CHAR_LIMIT,
): { text: string; truncated: boolean } {
  const q = String(card?.qa?.q ?? '').trim();
  const a = String(card?.qa?.a ?? '').trim();
  const full = q || a ? [q, a].filter(Boolean).join(' ') : String(card?.text ?? '').trim();
  const truncated = full.length > limit;
  return { text: truncated ? full.slice(0, limit) : full, truncated };
}

/** 喇叭按钮：未解锁只给一个点了会弹拦截文案的按钮，不给真播放入口 */
export function speakButtonHtml(allowed: boolean, state: SpeakState = 'idle'): string {
  if (!allowed) {
    return '<button type="button" class="bzrv-cs-speak is-locked" data-act="speak-locked">听这张</button>';
  }
  return `<button type="button" class="bzrv-cs-speak" data-act="speak">${speakLabelOf(state)}</button>`;
}

/** 回到原文按钮：没有链接就不渲染；未解锁只给拦截入口 */
export function backButtonHtml(hasLink: boolean, allowed: boolean): string {
  if (!hasLink) return '';
  return allowed
    ? '<button type="button" class="bzrv-cs-back" data-act="back">回到原文</button>'
    : '<button type="button" class="bzrv-cs-back is-locked" data-act="back-locked">回到原文</button>';
}

/** 出处那行：书名 · 章节 */
export function sourceOf(item: ReviewItem): string {
  const book = String(item.card?.bookTitle ?? '').trim();
  const chapter = String(item.card?.chapterTitle ?? '').trim();
  if (book && chapter) return `${book} · ${chapter}`;
  return book || chapter || item.name || '';
}

/* 标签固定、键位来自设置（批 2）：以前 1-4 写死三处，换键位只改得动一处就等于没改。 */
const RATING_LABELS: Array<{ value: Rating; label: string }> = [
  { value: 'again', label: '忘了' },
  { value: 'hard', label: '困难' },
  { value: 'good', label: '一般' },
  { value: 'easy', label: '容易' },
];

function ratingsWith(rawKeys: unknown): Array<{ value: Rating; label: string; key: string }> {
  const keys = ratingKeys(rawKeys);
  return RATING_LABELS.map((r) => ({ ...r, key: keys[r.value] }));
}

const RATING_NAMES: Record<string, string> = { again: '忘了', hard: '困难', good: '一般', easy: '容易' };

export interface CardSessionOpts {
  app: App;
  host: HTMLElement;
  queue: ReviewItem[];
  /** 三种方式之一；缺省按抽认卡 */
  mode?: CardMode;
  /** 做题每轮抽多少（分母） */
  ratio?: number;
  /** 评完一条：写排期（由调用方负责落盘） */
  onRate: (item: ReviewItem, rating: Rating) => Promise<void>;
  /** 整轮走完 / 中途退出（completed=true 表示这一轮真的走完了） */
  onExit: (completed?: boolean) => void;
  /**
   * 让模型出一道问句当提示面（可选）。
   *
   * 返回 null 表示「这次没拿到」（没配 AI / 网络失败 / 回复不合格），会话
   * 退回内置提示——复习不该因为模型不可用而卡住。
   */
  ask?: (item: ReviewItem) => Promise<{ q: string; a: string } | null>;
  /** 取这张卡的题库（做题方式用；没有就降级展开全文） */
  loadQuiz?: (item: ReviewItem) => Promise<QuizQuestion[] | null>;
  /**
   * 补齐当前复习方式需要的内容（可选）。
   *
   * 内容只在「加入计划那一刻」生成过一次，用户之后改了复习方式，存量卡一张都不会补。
   * 没有这条回调时，缺内容直接降级成看原文——**不能**停在「正在准备…」，那等于把
   * 整张卡锁死（抽认卡的提示面踩过同一个坑）。
   */
  ensureContent?: (item: ReviewItem) => Promise<boolean>;
  /** 「重新生成」：重新问一次模型并覆盖卡上的内容；返回是否真的换了 */
  regenerate?: (item: ReviewItem) => Promise<boolean>;
  /**
   * 手改卡片（批 2）：保存后由调用方落盘并打 manual 标记。
   * 没有这条回调时编辑入口不显示——宁可不给，也不给一个存不进去的按钮。
   */
  onEdit?: (item: ReviewItem, values: { text: string; comment: string }) => Promise<void>;
}

/** 做题这一条的会话态 */
interface QuizRound {
  list: QuizQuestion[];
  idx: number;
  correct: number;
  wrong: number;
  /** 当前题选了第几个（null = 还没选） */
  picked: number | null;
}

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export class CardSession {
  private opts: CardSessionOpts;
  private index = 0;
  private revealed = false;
  private busy = false;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  /** 本次会话已经问过模型的卡（避免重画时反复请求） */
  private asked = new Set<string>();
  /** 已经拿到的问句（本会话缓存；落盘那一步由 ask 回调自己做） */
  private qCache = new Map<string, string>();
  /** 做题态；null = 还没开始/已交卷 */
  private quiz: QuizRound | null = null;
  /** 题库正在读 */
  private quizLoading = false;
  /** 这张卡没有题库（或读失败），退回展开全文 */
  private quizFallback = false;
  /** 刚点过「重新生成」，按钮上给个反馈 */
  private regenBusy = false;
  /** 填空作答态；null = 还没交卷 */
  private clozeState: { answers: string[]; results: boolean[] } | null = null;
  /** 工作台：上一次渲染的卡序号，用来判断「换卡了」而不是同一张重画 */
  private lastIndex = -1;
  /** 换卡时的一次性提示（同类型连做为空） */
  private notice = '';
  private noticeTimer: number | null = null;
  /** 这一轮已经为它补过内容的卡（补不到就降级，不再反复打模型） */
  private ensured = new Set<string>();
  /** 正在补内容的卡（渲染会被反复调用，在途期间不能重复发请求） */
  private ensuring = new Set<string>();
  /** 听卡片的播放器：render 用 innerHTML 整段替换，实例必须留在字段里 */
  private player = new CardAudio();

  constructor(opts: CardSessionOpts) {
    this.opts = opts;
  }

  start(): void {
    this.render();
    this.keyHandler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.destroy();
        this.opts.onExit(false);
        return;
      }
      if (this.isQuizMode() && this.quiz) {
        this.handleQuizKey(e);
        return;
      }
      // 填空 / 上下文有各自的提示面与提交动作，不能落进下面的「空格揭示」
      if (this.isClozeMode()) {
        this.handleClozeKey(e);
        return;
      }
      if (this.isContextMode()) {
        this.handleContextKey(e);
        return;
      }
      if (!this.revealed && !this.isPlainMode()) {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          this.reveal();
        }
        return;
      }
      const hit = ratingForKey(e.key, (getSettings()).reviewRatingKeys);
      if (hit) {
        e.preventDefault();
        void this.rate(hit);
      }
    };
    document.addEventListener('keydown', this.keyHandler);
  }

  destroy(): void {
    if (this.keyHandler) document.removeEventListener('keydown', this.keyHandler);
    this.keyHandler = null;
    if (this.noticeTimer !== null) window.clearTimeout(this.noticeTimer);
    this.noticeTimer = null;
    this.player.stop();
    this.opts.host.innerHTML = '';
  }

  /** 换卡时把上一张的作答痕迹清干净：填空题输入框、做题选中项、揭示状态都不能串味 */
  private resetTransient(): void {
    this.revealed = false;
    this.quiz = null;
    this.quizLoading = false;
    this.quizFallback = false;
    this.clozeState = null;
  }

  /** 点右侧队列或顶部类型 tab 直接跳到那张卡（未评级的卡也允许回看） */
  private jumpTo(index: number): void {
    if (index < 0 || index >= this.opts.queue.length || index === this.index) return;
    this.player.stop();
    this.index = index;
    this.resetTransient();
    this.render();
  }

  /**
   * 当前这张卡该用哪种方式。
   *
   * 2026-11-15 起方式跟着卡走：卡上写了 `mode` 就用它，没有（老卡片）才回落到
   * 会话级的 `opts.mode`。同一轮里抽认卡和填空题可以并存——这正是用户要的
   * 「复习方式和制卡时选的一致」。
   */
  private mode(): CardMode {
    const own = this.opts.queue[this.index]?.card?.mode;
    if (own === 'quiz' || own === 'plain' || own === 'cloze' || own === 'context' || own === 'flashcard') {
      return own;
    }
    return this.opts.mode ?? 'flashcard';
  }

  private isPlainMode(): boolean {
    return this.mode() === 'plain' || this.quizFallback;
  }

  private isQuizMode(): boolean {
    return this.mode() === 'quiz' && !this.quizFallback;
  }

  private isClozeMode(): boolean {
    return this.mode() === 'cloze';
  }

  private isContextMode(): boolean {
    return this.mode() === 'context';
  }

  private current(): ReviewItem | undefined {
    return this.opts.queue[this.index];
  }

  private reveal(): void {
    this.revealed = true;
    this.render();
  }

  private async rate(rating: Rating): Promise<void> {
    if (this.busy) return;
    const item = this.current();
    if (!item) return;
    this.busy = true;
    try {
      await this.opts.onRate(item, rating);
    } finally {
      this.busy = false;
    }
    this.index += 1;
    this.player.stop();
    this.resetTransient();
    if (this.index >= this.opts.queue.length) {
      this.destroy();
      this.opts.onExit(true);
      return;
    }
    this.render();
  }

  /**
   * 提示面用哪句话。
   *
   * 优先用卡上已经存好的 AI 问句（`card.qa`），其次用本会话刚拿到的；
   * 都没有且配了 `ask`，就去问一次——问的这段时间显示「正在生成提示…」，
   * 而不是先露出内置提示再换掉（那一瞬间用户已经把答案看完了）。
   */
  private promptFor(item: ReviewItem): string {
    const key = item.filePath;
    const view = promptViewFor(item, {
      asked: this.asked.has(key),
      canAsk: !!this.opts.ask,
      cached: this.qCache.get(key) ?? String(item.card?.qa?.q ?? '').trim(),
    });
    if (view.ask && this.opts.ask) {
      this.asked.add(key);
      void this.opts
        .ask(item)
        .then((res) => {
          if (res?.q) this.qCache.set(key, res.q);
        })
        .catch(() => undefined)
        .finally(() => {
          /* 拿到没拿到都要重画一次：问过之后 asked 已置位，重画时
             promptViewFor 会退回内置提示。原来这里是「拿不到就 return」，
             于是没配模型 / 模型调用失败时界面永远停在「正在生成提示…」，
             整张卡复习不了，控制台还一句错都不报。 */
          if (this.current()?.filePath === key) this.render();
        });
    }
    return view.text;
  }

  /** 从卡上读题库（读失败按「没有」处理，交给上层降级） */
  private async readQuiz(item: ReviewItem): Promise<QuizQuestion[] | null> {
    if (!this.opts.loadQuiz) return null;
    try {
      return await this.opts.loadQuiz(item);
    } catch {
      return null;
    }
  }

  /**
   * 做题：进会话就把题库读出来，抽好这一轮要问的几道。
   *
   * 题库为空时**先补一次**：内容只在加入计划那一刻生成过，用户之后把复习方式改成
   * 「做题」，存量卡全都没有题库——原来这里直接降级成看原文，等于选了做题也没题做。
   * 补过还没有才降级（`quizViewOf` 的 pending/fallback 口径）。
   */
  private ensureQuiz(item: ReviewItem): void {
    if (!this.isQuizMode() || this.quiz || this.quizLoading || this.quizFallback) return;
    if (!this.opts.loadQuiz) {
      this.quizFallback = true;
      this.render();
      return;
    }
    this.quizLoading = true;
    void (async () => {
      let list = await this.readQuiz(item);
      const key = item.filePath;
      // 没题 + 能补 + 这一轮还没试过 → pending（显示「正在准备题目…」并发一次请求）
      if (quizViewOf(list?.length ?? 0, !this.canEnsure(key)) === 'pending') {
        await this.ensureContentOnce(item);
        if (this.current()?.filePath !== key) return;
        list = await this.readQuiz(item);
      }
      if (this.current()?.filePath !== item.filePath) return;
      this.quizLoading = false;
      if (!list?.length) {
        this.quizFallback = true;
        this.render();
        return;
      }
      this.quiz = {
        list: pickCardQuestions(list, this.opts.ratio ?? QUIZ_RATIO),
        idx: 0,
        correct: 0,
        wrong: 0,
        picked: null,
      };
      this.render();
    })();
  }

  /** 这张卡这一轮还能不能补内容（没回调 / 已在途 / 已补过 → 不能） */
  private canEnsure(key: string): boolean {
    return !!this.opts.ensureContent && !this.ensured.has(key) && !this.ensuring.has(key);
  }

  /** 补一次内容并记账；补不到（抛错 / 返回 false）也算「试过了」，不再重试 */
  private async ensureContentOnce(item: ReviewItem): Promise<void> {
    const key = item.filePath;
    if (!this.canEnsure(key) || !this.opts.ensureContent) return;
    this.ensuring.add(key);
    try {
      await this.opts.ensureContent(item);
    } catch {
      /* 补不到就降级：卡片本身还在，照常能复习 */
    } finally {
      this.ensuring.delete(key);
      this.ensured.add(key);
    }
  }

  /**
   * 填空：卡上没有挖空内容时现场补一次（改复习方式的存量卡全靠这条），
   * 补不到才降级看原文。在途期间显示「正在准备填空…」，不能停在空白上。
   */
  private ensureClozeContent(item: ReviewItem): void {
    if (!this.isClozeMode()) return;
    const card = item.card;
    if (!card || this.clozeReady(card)) return;
    const key = item.filePath;
    if (!this.canEnsure(key)) return;
    void this.ensureContentOnce(item).finally(() => {
      if (this.current()?.filePath === key) this.render();
    });
  }


  private handleQuizKey(e: KeyboardEvent): void {
    const round = this.quiz;
    if (!round) return;
    const done = round.idx >= round.list.length;
    if (done) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        void this.finishQuiz();
      }
      return;
    }
    if (round.picked === null) {
      const n = Number(e.key);
      if (n >= 1 && n <= 4) {
        e.preventDefault();
        this.pickOption(n - 1);
      }
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this.nextQuestion();
    }
  }

  /**
   * 填空：Enter 交卷；交卷后 1-4 评级。
   * 没有填空内容时答案已经摆出来了，直接放行评级键——不能让用户按不动。
   */
  private handleClozeKey(e: KeyboardEvent): void {
    const card = this.current()?.card;
    if (!card || !this.clozeReady(card)) {
      this.rateByKey(e);
      return;
    }
    if (!this.clozeState) {
      // 输入框里按 Enter 只交卷；preventDefault 掉表单默认行为。
      // 中文输入法还在选词时（isComposing）不交卷，否则「回车选词」会被当成提交。
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        this.submitCloze();
      }
      return;
    }
    this.rateByKey(e);
  }

  /** 上下文：Enter 揭示；揭示后 1-4 评级 */
  private handleContextKey(e: KeyboardEvent): void {
    if (!this.revealed) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.reveal();
      }
      return;
    }
    this.rateByKey(e);
  }

  private rateByKey(e: KeyboardEvent): void {
    const hit = ratingForKey(e.key, (getSettings()).reviewRatingKeys);
    if (!hit) return;
    e.preventDefault();
    void this.rate(hit);
  }

  private pickOption(i: number): void {
    const round = this.quiz;
    if (!round || round.picked !== null) return;
    const q = round.list[round.idx];
    if (!q || i < 0 || i >= q.options.length) return;
    round.picked = i;
    if (q.correctIndices.includes(i)) round.correct += 1;
    else round.wrong += 1;
    this.render();
  }

  private nextQuestion(): void {
    const round = this.quiz;
    if (!round) return;
    round.idx += 1;
    round.picked = null;
    this.render();
  }

  /** 交卷：按正确率定难度，口径与做题冲刺同源 */
  private async finishQuiz(): Promise<void> {
    const round = this.quiz;
    if (!round) return;
    const total = round.correct + round.wrong;
    const acc = total ? Math.round((round.correct / total) * 100) : 0;
    await this.rate(accuracyToRating(acc));
  }

  /** 交填空卷：按 data-slot 收答案，逐空判分后整页重画（答案与对错都留在状态里） */
  private submitCloze(): void {
    if (this.clozeState) return;
    const card = this.current()?.card;
    if (!card?.cloze || !this.clozeReady(card)) return;
    const answers: string[] = [];
    this.opts.host.querySelectorAll<HTMLInputElement>('input.bzrv-cs-slot').forEach((el) => {
      const n = Number(el.dataset.slot);
      if (Number.isFinite(n) && n >= 1) answers[n - 1] = el.value;
    });
    const { results } = checkBlanks(card.cloze, answers);
    this.clozeState = { answers, results };
    this.render();
  }

  /** 这张卡有没有可用的填空内容（含 AI 只回半句的兜底） */
  private clozeReady(card: ReviewCard): boolean {
    return clozeContentUsable(card);
  }

  /**
   * 手改这张卡（批 2）。
   *
   * 保存后把本地缓存全部作废：提示面、题库、挖空都按旧文本生成，改了原文还留着
   * 旧的等于让人背一段自己没写过的字。
   */
  private editCard(): void {
    const item = this.current();
    if (!item || !this.opts.onEdit) return;
    openCardEditor(this.opts.app, item, async (v) => {
      await this.opts.onEdit!(item, v);
      const card = item.card;
      if (card) {
        card.text = v.text;
        card.comment = v.comment;
        card.manual = true;
        this.qCache.delete(card.key);
        this.asked.delete(card.key);
      }
      this.quiz = null;
      this.quizFallback = false;
      this.clozeState = null;
      this.revealed = false;
      this.ensured.delete(item.filePath);
      this.render();
    });
  }

  private async regenerate(): Promise<void> {
    if (!this.opts.regenerate || this.regenBusy) return;
    const item = this.current();
    if (!item) return;
    this.regenBusy = true;
    this.render();
    try {
      const ok = await this.opts.regenerate(item);
      if (ok) {
        this.qCache.delete(item.filePath);
        this.asked.delete(item.filePath);
        this.quiz = null;
        this.quizFallback = false;
        this.revealed = false;
        this.clozeState = null;
        // 重生成后卡上的内容变了：把最新那条换进来
        const card = item.card ?? ({} as ReviewCard);
        if (card.key) this.qCache.delete(card.key);
      }
    } finally {
      this.regenBusy = false;
      this.render();
    }
  }

  // ==================== 渲染 ====================

  private render(): void {
    const host = this.opts.host;
    const item = this.current();
    if (!item || !isCardItem(item)) {
      this.destroy();
      this.opts.onExit(false);
      return;
    }
    const total = this.opts.queue.length;
    const mode = this.mode();
    const meta = modeMetaOf(mode);
    const buckets = typeBucketsOf(this.opts.queue);
    const rows = queueRowsOf(this.opts.queue, item.filePath);

    /* 换卡判定：首次进入不提示；跨卡才提示，同一张重画（揭示/交卷）不提示。
       这样「看答案」不会把「已切换到…」又弹一遍。 */
    const isNew = this.lastIndex !== this.index;
    if (isNew) this.player.stop();
    let notice = this.notice;
    this.notice = '';
    if (isNew && this.lastIndex >= 0) {
      const prev = this.opts.queue[this.lastIndex];
      notice = switchNoticeOf(prev ? modeOfItem(prev) : mode, mode) || notice;
    }
    this.lastIndex = this.index;

    const tabs = buckets
      .map(
        (b) =>
          `<button type="button" class="bzrv-cs-tab${b.mode === mode ? ' is-on' : ''}" data-jump-mode="${b.mode}"><span>${esc(b.label)}</span><b>${b.count}</b></button>`,
      )
      .join('');
    const bars = buckets
      .map(
        (b) =>
          `<i data-tone="${b.tone}" style="width:${((b.count / total) * 100).toFixed(1)}%"></i>`,
      )
      .join('');
    const legend = buckets
      .map(
        (b) =>
          `<span class="lg" data-tone="${b.tone}"><i></i>${esc(b.label)} <b>${b.count}</b></span>`,
      )
      .join('');
    const queueRows = rows
      .map(
        (r) => `<button type="button" class="bzrv-cs-qrow ${r.state}" data-jump-index="${r.no - 1}" data-tone="${r.tone}">
          <span class="bzrv-cs-qno">${r.no}</span><span class="bzrv-cs-qic">${r.icon}</span>
          <span class="bzrv-cs-qname">${esc(r.name)}</span><span class="bzrv-cs-qmode">${esc(r.label)}</span>
        </button>`,
      )
      .join('');

    const markup = `
      <div class="bzrv-cs" role="group" data-tone="${meta.tone}"><span class="bzrv-sr-only">划线卡复习</span>
        <div class="bzrv-cs-top">
          <span class="bzrv-cs-brand">复习</span>
          <span class="bzrv-cs-src">${esc(sourceOf(item))}</span>
          <span class="bzrv-cs-stage-label">${esc(stageNum(item))}</span>
          <button type="button" class="bzrv-btn bzrv-cs-exit" data-act="exit"><span class="bzrv-sr-only">退出本轮</span>退出</button>
        </div>
        <div class="bzrv-cs-tabs">${tabs}</div>
        <div class="bzrv-cs-grid">
          <div class="bzrv-cs-stage">
            <div class="bzrv-cs-card${isNew ? ' is-entering' : ''}" data-tone="${meta.tone}">
              <div class="bzrv-cs-card-top">
                <span class="bzrv-cs-mode"><span class="bzrv-cs-mode-ic">${meta.icon}</span>${esc(meta.label)}</span>
                <span class="bzrv-cs-sp"></span>
                <span class="bzrv-cs-pos">${this.index + 1} / ${total}</span>
              </div>
              <div class="bzrv-cs-body">${this.bodyHtml(item)}</div>
              <div class="bzrv-cs-actions">${this.actionHtml(item)}</div>
              ${this.footActionsHtml(item)}
            </div>
            <div class="bzrv-cs-foot">${
              this.showRating(item)
                ? this.ratingHtml()
                : '<span class="bzrv-cs-hint">看完答案再评，别凭第一印象</span>'
            }</div>
          </div>
          <aside class="bzrv-cs-side">
            <div class="bzrv-cs-sec-t">本轮类型分布</div>
            <div class="bzrv-cs-dist">${bars}</div>
            <div class="bzrv-cs-legend">${legend}</div>
            <div class="bzrv-cs-sec-t">本轮队列</div>
            <div class="bzrv-cs-qlist">${queueRows}</div>
            <div class="bzrv-cs-meta">
              <div><span>当前方式</span><b>${esc(meta.label)}</b></div>
              <div><span>阶段</span><b>${esc(stageNum(item))}</b></div>
              <div><span>出处</span><b>${esc(sourceOf(item))}</b></div>
            </div>
          </aside>
        </div>
        ${notice ? `<div class="bzrv-cs-notice" role="status">${esc(notice)}</div>` : ''}
      </div>`;
    const parsed = new DOMParser().parseFromString(markup, 'text/html');
    host.replaceChildren(...Array.from(parsed.body.childNodes, (n) => document.importNode(n, true)));

    if (notice) {
      const key = item.filePath;
      if (this.noticeTimer !== null) window.clearTimeout(this.noticeTimer);
      this.noticeTimer = window.setTimeout(() => {
        if (this.current()?.filePath === key) this.render();
      }, 1800);
    }
    this.bind(host);
    this.ensureQuiz(item);
    this.ensureClozeContent(item);
  }

  /** 正文：看答案那一段（全文 + 想法），三种方式共用。跳原文挪到底部一行。 */
  private answerHtml(card: ReviewCard): string {
    const idea = String(card.comment ?? '').trim();
    return `<blockquote class="bzrv-cs-text">${esc(card.text)}</blockquote>
      ${idea ? `<p class="bzrv-cs-idea">${esc(idea)}</p>` : ''}`;
  }

  private bodyHtml(item: ReviewItem): string {
    const card = item.card!;
    if (this.isPlainMode()) return this.answerHtml(card);

    if (this.isQuizMode()) {
      const round = this.quiz;
      if (!round) {
        return `<p class="bzrv-cs-prompt is-loading">${
          this.quizFallback ? '这张卡没有题库，直接看原文' : '正在准备题目…'
        }</p>`;
      }
      if (round.idx >= round.list.length) return this.quizSummaryHtml(round);
      const q = round.list[round.idx];
      const picked = round.picked;
      const labels = ['A', 'B', 'C', 'D'];
      const options = q.options
        .map((opt, i) => {
          /* 复用做题家的选项样式（quiz-option-btn + correct/wrong）：同一种交互
             不必再造一套配色，用户在两处看到的选择题长得一样才不会犹豫。 */
          let cls = 'quiz-option-btn bzrv-cs-opt';
          if (picked !== null) {
            if (q.correctIndices.includes(i)) cls += ' correct';
            else if (picked === i) cls += ' wrong';
          }
          /* 模型给的选项常自带「A. 」序号。再加一层就成了「AA. 」，所以有就不重复加 */
          const labeled = /^[A-Da-d][.、)．\s]/.test(opt);
          const mark = labeled ? '' : `<span class="bzrv-cs-opt-i">${labels[i] ?? i + 1}</span>`;
          return `<button type="button" class="${cls}" data-opt="${i}"${
            picked !== null ? ' disabled' : ''
          }>${mark}<span class="bzrv-cs-opt-t">${esc(opt)}</span></button>`;
        })
        .join('');
      const explain =
        picked !== null && q.explain ? `<p class="bzrv-cs-explain">${esc(q.explain)}</p>` : '';
      return `
        <div class="bzrv-cs-quiz-head">第 ${round.idx + 1} / ${round.list.length} 题</div>
        <p class="bzrv-cs-question">${esc(q.question)}</p>
        <div class="bzrv-cs-options">${options}</div>
        ${explain}`;
    }

    if (this.isClozeMode()) return this.clozeBodyHtml(item);
    if (this.isContextMode()) return this.contextBodyHtml(card);

    const prompt = this.promptFor(item);
    return `
      <p class="bzrv-cs-prompt${prompt ? '' : ' is-loading'}">${prompt ? esc(prompt) : '正在生成提示…'}</p>
      ${this.revealed ? this.answerHtml(card) : ''}`;
  }

  /**
   * 填空：提示面只给挖空后的句子；交卷后逐空标对错、补上正确答案，再揭示原文。
   * 没有挖空内容时先显示「正在准备填空…」（同时后台补一次），补不到才摊开原文——
   * 复习不能停在一张空白卡片上。
   */
  private clozeBodyHtml(item: ReviewItem): string {
    const card = item.card!;
    const attempted = this.ensured.has(item.filePath) || !this.opts.ensureContent;
    const view = clozeViewOf(this.clozeReady(card), attempted);
    if (view === 'pending') {
      return '<p class="bzrv-cs-prompt is-loading">正在准备填空…</p>';
    }
    if (view === 'fallback') {
      return `<p class="bzrv-cs-prompt">这张卡还没准备好填空，先看原文</p>${this.answerHtml(card)}`;
    }
    const text = String(card.cloze!.text);
    const blanks = card.cloze!.blanks;
    const state = this.clozeState;
    const answers = state?.answers ?? [];
    const results = state?.results ?? [];
    /* 整张卡统一宽度，不按每个空自己的答案长度给——那等于把「这个空几个字」
       印在题面上（真机实测：11ch 与 15ch 两个框，正好对应两个答案的汉字数）。 */
    const width = clozeSlotWidth(blanks);
    const pieces = renderClozeHtmlParts(text)
      .map((part) => {
        if (part.kind === 'text') return esc(part.value);
        const i = part.index - 1;
        const cls = state ? (results[i] ? ' is-ok' : ' is-bad') : '';
        const value = state ? esc(answers[i] ?? '') : '';
        const locked = state ? ' readonly' : '';
        return `<span class="bzrv-cs-slot-n">${part.index}</span><input type="text" class="bzrv-cs-slot${cls}" data-slot="${part.index}" inputmode="text" autocomplete="off" style="width: ${width}ch" value="${value}"${locked}>`;
      })
      .join('');
    if (!state) {
      return `<p class="bzrv-cs-cloze-hint">凭上下文补全这几处</p>
        <p class="bzrv-cs-cloze">${pieces}</p>`;
    }
    const wrong = blanks
      .map((want, i) =>
        results[i] ? '' : `<p class="bzrv-cs-slot-ans">第 ${i + 1} 空：正确答案「${esc(want)}」</p>`,
      )
      .join('');
    const right = results.filter(Boolean).length;
    const allOk = right === blanks.length;
    return `<p class="bzrv-cs-cloze-hint">凭上下文补全这几处</p>
      <p class="bzrv-cs-cloze">${pieces}</p>
      ${wrong}
      <p class="bzrv-cs-cloze-result${allOk ? ' is-ok' : ''}">${
        allOk ? '全对' : `对了 ${right} / ${blanks.length}`
      }</p>
      ${this.answerHtml(card)}`;
  }

  /**
   * 上下文：先给前后文（或当时的想法/出处），划线藏起来；揭示后接原文。
   * 判断与文案都在 context.ts，这里只负责排版与转义。
   */
  private contextBodyHtml(card: ReviewCard): string {
    const prompt = contextPromptOf(card);
    let core: string;
    if (prompt.real) {
      core = `${prompt.before ? `<p class="bzrv-cs-ctx-side is-before">${esc(prompt.before)}</p>` : ''}
        <div class="bzrv-cs-ctx-hole">（你划的是这句？）</div>
        ${prompt.after ? `<p class="bzrv-cs-ctx-side is-after">${esc(prompt.after)}</p>` : ''}`;
    } else if (prompt.hint) {
      core = `<p class="bzrv-cs-hint">你当时的想法</p>
        <blockquote class="bzrv-cs-ctx-hint">${esc(prompt.hint)}</blockquote>`;
    } else {
      core = `${prompt.where ? `<p class="bzrv-cs-prompt">${esc(prompt.where)}</p>` : ''}
        <p class="bzrv-cs-hint">凭出处回忆，想不起来就翻回去</p>`;
    }
    return `<div class="bzrv-cs-ctx">
        <p class="bzrv-cs-prompt">${esc(prompt.lead)}</p>
        ${core}
      </div>
      ${this.revealed ? this.answerHtml(card) : ''}`;
  }

  private quizSummaryHtml(round: QuizRound): string {
    const total = round.correct + round.wrong;
    const acc = total ? Math.round((round.correct / total) * 100) : 0;
    const rating = accuracyToRating(acc);
    return `
      <div class="bzrv-cs-quiz-done">
        <p class="bzrv-cs-quiz-acc">答对 ${round.correct} / ${total}</p>
        <p class="bzrv-cs-quiz-rating">本次按「${RATING_NAMES[rating] ?? rating}」记</p>
      </div>`;
  }

  /** 卡片内部的动作按钮（揭示 / 下一题 / 对答案）；评级单独摆在卡片下方 */
  private actionHtml(item: ReviewItem): string {
    if (this.isPlainMode()) return '';
    if (this.isQuizMode()) {
      const round = this.quiz;
      if (!round) return '';
      if (round.idx >= round.list.length) {
        return `<button type="button" class="bzrv-btn bzrv-btn--primary" data-act="finish">记下这次结果（Enter）</button>`;
      }
      if (round.picked === null) return `<span class="bzrv-cs-hint">按 1-4 或点选项作答</span>`;
      return `<button type="button" class="bzrv-btn bzrv-btn--primary" data-act="next">${
        round.idx + 1 >= round.list.length ? '看结果' : '下一题'
      }（Enter）</button>`;
    }
    if (this.isClozeMode()) {
      if (!this.clozeReady(item.card!)) return '';
      return this.clozeState
        ? ''
        : '<button type="button" class="bzrv-btn bzrv-btn--primary" data-act="check">对答案</button>';
    }
    if (this.isContextMode()) {
      return this.revealed
        ? ''
        : '<button type="button" class="bzrv-btn bzrv-btn--primary" data-act="reveal">想起来了，看答案</button>';
    }
    return this.revealed
      ? ''
      : '<button type="button" class="bzrv-btn bzrv-btn--primary" data-act="reveal">看答案</button>';
  }

  /** 看完答案才给评级：全文卡没有揭示动作，直接可评；降级看原文也一样 */
  private showRating(item: ReviewItem): boolean {
    if (this.isPlainMode()) return true;
    if (this.isQuizMode()) {
      const round = this.quiz;
      return !!round && round.idx >= round.list.length;
    }
    if (this.isClozeMode()) return this.clozeReady(item.card!) && !!this.clozeState;
    return this.revealed;
  }

  private ratingHtml(): string {
    return `<div class="bzrv-cs-rate">${ratingsWith((getSettings()).reviewRatingKeys).map(
      (r) => `<button type="button" class="bzrv-btn" data-r="${r.value}">${r.label}（${r.key}）</button>`,
    ).join('')}</div>`;
  }

  private bind(host: HTMLElement): void {
    /* 退出键：触屏用户进了会话没有物理 Esc，遮罩又被整屏面板盖死——没有这个
       按钮就只能把整轮做完或者杀 App。与 Esc 同一语义（中途退不接下一批）。 */
    host.querySelector('[data-act="exit"]')?.addEventListener('click', () => {
      this.destroy();
      this.opts.onExit(false);
    });
    host.querySelector('[data-act="reveal"]')?.addEventListener('click', () => this.reveal());
    host.querySelector('[data-act="check"]')?.addEventListener('click', () => this.submitCloze());
    host.querySelector('[data-act="regen"]')?.addEventListener('click', () => void this.regenerate());
    host.querySelector('[data-act="edit"]')?.addEventListener('click', () => this.editCard());
    host.querySelector('[data-act="next"]')?.addEventListener('click', () => this.nextQuestion());
    host.querySelector('[data-act="finish"]')?.addEventListener('click', () => void this.finishQuiz());
    host.querySelectorAll<HTMLElement>('[data-r]').forEach((btn) => {
      btn.addEventListener('click', () => void this.rate(btn.dataset.r as Rating));
    });
    host.querySelectorAll<HTMLElement>('[data-opt]').forEach((btn) => {
      btn.addEventListener('click', () => this.pickOption(Number(btn.dataset.opt)));
    });
    /* 顶部类型 tab / 右侧队列：按类型实时跳卡，跳过已评级或未评级的都允许 */
    host.querySelectorAll<HTMLElement>('[data-jump-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = this.opts.queue.findIndex((it) => modeOfItem(it) === btn.dataset.jumpMode);
        if (target >= 0) this.jumpTo(target);
      });
    });
    host.querySelectorAll<HTMLElement>('[data-jump-index]').forEach((btn) => {
      btn.addEventListener('click', () => this.jumpTo(Number(btn.dataset.jumpIndex)));
    });
    /* 听卡片 / 跳回原文：判定与文案见文件头的纯函数，这里只接线。 */
    host.querySelector('[data-act="speak"]')?.addEventListener('click', () => this.speak());
    host.querySelector('[data-act="speak-locked"]')?.addEventListener('click', () => {
      this.notice = capabilityBlock('speech').message;
      this.render();
    });
    host.querySelector('[data-act="back"]')?.addEventListener('click', () => this.back());
    host.querySelector('[data-act="back-locked"]')?.addEventListener('click', () => {
      this.notice = capabilityBlock('sourceLink').message;
      this.render();
    });
  }

  // ==================== 听卡片 / 跳回原文 ====================

  private speakHtml(): string {
    /* 朗读听卡 2026-11-20 暂不展示：入口撤掉，speak()/ttsConfig()/纯函数与接线
       全部保留（用户觉得实现有问题，后续再放回来，届时这里改回一行即可）。 */
    return '';
  }

  /** 「回到原文」「听这张」并成一行：复习区只留回忆本身，改卡去卡片管理器。 */
  private footActionsHtml(item: ReviewItem): string {
    const card = item.card;
    const back = card ? backlinkOfCard(card, readerJumpUrl) : '';
    return `<div class="bzrv-cs-foot-actions">${backButtonHtml(!!back, canUseCapability('sourceLink'))}${this.speakHtml()}</div>`;
  }

  private speakState(): SpeakState {
    if (this.player.isLoading()) return 'loading';
    if (this.player.isPlaying()) return 'playing';
    return 'idle';
  }

  /** 播放态只改这一个按钮的文字，不整页重画——整段 render 会闪 */
  private paintSpeak(host: HTMLElement): void {
    const btn = host.querySelector<HTMLElement>('[data-act="speak"]');
    if (btn) btn.textContent = speakLabelOf(this.speakState());
  }

  /** 朗读配置跟 AI 内容生成走同一个设置源 getSettings，不另造全局单例 */
  private ttsConfig(): TtsConfig {
    const s = getSettings();
    return {
      url: String(s.ttsUrl ?? '').trim(),
      model: String(s.ttsModel ?? '').trim(),
      voice: String(s.ttsVoice ?? '').trim(),
      format: s.ttsFormat === 'wav' ? 'wav' : 'mp3',
      apiKey: String(s.ttsApiKey ?? '').trim(),
    };
  }

  private speak(): void {
    const item = this.current();
    const card = item?.card;
    if (!card) return;
    const { text, truncated } = speakTextOf(card);
    if (!text) {
      this.notice = '这张卡没有可朗读的文字';
      this.render();
      return;
    }
    const host = this.opts.host;
    const key = card.key || item.filePath;
    if (truncated) this.notice = '这段文字比较长，只念了前 200 字';
    void this.player.toggle(key, text, this.ttsConfig()).then(
      () => this.paintSpeak(host),
      (e: unknown) => {
        this.paintSpeak(host);
        this.notice = `朗读失败：${e instanceof Error ? e.message : String(e)}`;
        this.render();
      },
    );
    this.render();
  }

  private back(): void {
    const card = this.current()?.card;
    if (!card) return;
    const url = backlinkOfCard(card, readerJumpUrl);
    if (!url) return;
    const plugins = (this.opts.app as PluginRegistryHost | null)?.plugins?.plugins;
    if (!plugins?.['bz-reader']) {
      this.notice = '还没装 bz Reader';
      this.render();
      return;
    }
    openExternalUrl(this.opts.app, url);
  }
}
