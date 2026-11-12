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
import { promptOf, promptViewFor } from './card-prompt';
import { stageNum } from './render';
import { accuracyToRating } from './sprint';

/* 提示面与它的状态机住在 card-prompt.ts —— 那里不碰 obsidian 和 DOM，node 里
   能直接断言「问过之后必须有字」。此处转出，保持既有引用面不变。 */
export { promptOf, promptViewFor } from './card-prompt';

/** 出处那行：书名 · 章节 */
export function sourceOf(item: ReviewItem): string {
  const book = String(item.card?.bookTitle ?? '').trim();
  const chapter = String(item.card?.chapterTitle ?? '').trim();
  if (book && chapter) return `${book} · ${chapter}`;
  return book || chapter || item.name || '';
}

const RATINGS: Array<{ value: Rating; label: string; key: string }> = [
  { value: 'again', label: '忘了', key: '1' },
  { value: 'hard', label: '困难', key: '2' },
  { value: 'good', label: '一般', key: '3' },
  { value: 'easy', label: '容易', key: '4' },
];

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
  /** 「重新生成」：重新问一次模型并覆盖卡上的内容；返回是否真的换了 */
  regenerate?: (item: ReviewItem) => Promise<boolean>;
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
      const hit = RATINGS.find((r) => r.key === e.key);
      if (hit) {
        e.preventDefault();
        void this.rate(hit.value);
      }
    };
    document.addEventListener('keydown', this.keyHandler);
  }

  destroy(): void {
    if (this.keyHandler) document.removeEventListener('keydown', this.keyHandler);
    this.keyHandler = null;
    this.opts.host.innerHTML = '';
  }

  private mode(): CardMode {
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
    this.revealed = false;
    this.quiz = null;
    this.quizLoading = false;
    this.quizFallback = false;
    this.clozeState = null;
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

  /** 做题：进会话就把题库读出来，抽好这一轮要问的几道 */
  private ensureQuiz(item: ReviewItem): void {
    if (!this.isQuizMode() || this.quiz || this.quizLoading || this.quizFallback) return;
    if (!this.opts.loadQuiz) {
      this.quizFallback = true;
      this.render();
      return;
    }
    this.quizLoading = true;
    void (async () => {
      let list: QuizQuestion[] | null = null;
      try {
        list = await this.opts.loadQuiz!(item);
      } catch {
        list = null;
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
    const hit = RATINGS.find((r) => r.key === e.key);
    if (!hit) return;
    e.preventDefault();
    void this.rate(hit.value);
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

  /** 这张卡有没有可用的填空内容：空文本、空答案、没有占位都算没准备好 */
  private clozeReady(card: ReviewCard): boolean {
    const text = String(card.cloze?.text ?? '');
    const blanks = card.cloze?.blanks;
    if (!text.trim() || !Array.isArray(blanks) || !blanks.length) return false;
    return renderClozeHtmlParts(text).some((p) => p.kind === 'slot');
  }

  /** 空位宽度：按答案的视觉宽度估（汉字约两格），夹在 4–20ch 之间 */
  private slotWidth(answer: string): number {
    let width = 0;
    for (const ch of Array.from(String(answer ?? ''))) {
      width += /[\u3000-\u9fff\uff01-\uff60]/.test(ch) ? 2 : 1;
    }
    return Math.min(20, Math.max(4, width + 1));
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
    const pos = `${this.index + 1} / ${total}`;
    const canRegen = this.mode() !== 'plain' && this.mode() !== 'context' && !!this.opts.regenerate;

    host.innerHTML = `
      <div class="bzrv-cs" role="group" aria-label="划线卡复习">
        <div class="bzrv-cs-head">
          <button type="button" class="bzrv-btn bzrv-cs-exit" data-act="exit" title="退出本轮">退出</button>
          <span class="bzrv-cs-pos">${esc(pos)}</span>
          <span class="bzrv-cs-src">${esc(sourceOf(item))}</span>
          <span class="bzrv-cs-stage">${esc(stageNum(item))}</span>
          ${
            canRegen
              ? `<button type="button" class="bzrv-btn bzrv-cs-regen" data-act="regen"${
                  this.regenBusy ? ' disabled' : ''
                }>${this.regenBusy ? '正在生成…' : '重新生成'}</button>`
              : ''
          }
        </div>
        <div class="bzrv-cs-body">${this.bodyHtml(item)}</div>
        <div class="bzrv-cs-foot">${this.footHtml(item)}</div>
      </div>`;

    this.bind(host);
    this.ensureQuiz(item);
  }

  /** 正文：看答案那一段（全文 + 想法 + 回原文），三种方式共用 */
  private answerHtml(card: ReviewCard): string {
    const idea = String(card.comment ?? '').trim();
    const back = String(card.backlink ?? '').trim();
    return `<blockquote class="bzrv-cs-text">${esc(card.text)}</blockquote>
      ${idea ? `<p class="bzrv-cs-idea">${esc(idea)}</p>` : ''}
      ${back ? `<a class="bzrv-cs-back" href="${esc(back)}">回到原文</a>` : ''}`;
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

    if (this.isClozeMode()) return this.clozeBodyHtml(card);
    if (this.isContextMode()) return this.contextBodyHtml(card);

    const prompt = this.promptFor(item);
    return `
      <p class="bzrv-cs-prompt${prompt ? '' : ' is-loading'}">${prompt ? esc(prompt) : '正在生成提示…'}</p>
      ${this.revealed ? this.answerHtml(card) : ''}`;
  }

  /**
   * 填空：提示面只给挖空后的句子；交卷后逐空标对错、补上正确答案，再揭示原文。
   * 没有挖空内容时直接摊开原文——复习不能停在一张空白卡片上。
   */
  private clozeBodyHtml(card: ReviewCard): string {
    if (!this.clozeReady(card)) {
      return `<p class="bzrv-cs-prompt">这张卡还没准备好填空，先看原文</p>${this.answerHtml(card)}`;
    }
    const text = String(card.cloze!.text);
    const blanks = card.cloze!.blanks;
    const state = this.clozeState;
    const answers = state?.answers ?? [];
    const results = state?.results ?? [];
    const pieces = renderClozeHtmlParts(text)
      .map((part) => {
        if (part.kind === 'text') return esc(part.value);
        const i = part.index - 1;
        const cls = state ? (results[i] ? ' is-ok' : ' is-bad') : '';
        const value = state ? esc(answers[i] ?? '') : '';
        const locked = state ? ' readonly' : '';
        const width = this.slotWidth(blanks[i] ?? '');
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

  private footHtml(item: ReviewItem): string {
    if (this.isPlainMode()) return this.ratingHtml();

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
      if (!this.clozeReady(item.card!)) return this.ratingHtml();
      if (!this.clozeState) return `<button type="button" class="bzrv-btn bzrv-btn--primary" data-act="check">对答案</button>`;
      return this.ratingHtml();
    }

    if (this.isContextMode()) {
      return this.revealed
        ? this.ratingHtml()
        : `<button type="button" class="bzrv-btn bzrv-btn--primary" data-act="reveal">想起来了，看答案</button>`;
    }

    if (this.revealed) return this.ratingHtml();
    return `<button type="button" class="bzrv-btn bzrv-btn--primary" data-act="reveal">看答案</button>`;
  }

  private ratingHtml(): string {
    return `<div class="bzrv-cs-rate">${RATINGS.map(
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
    host.querySelector('[data-act="next"]')?.addEventListener('click', () => this.nextQuestion());
    host.querySelector('[data-act="finish"]')?.addEventListener('click', () => void this.finishQuiz());
    host.querySelectorAll<HTMLElement>('[data-r]').forEach((btn) => {
      btn.addEventListener('click', () => void this.rate(btn.dataset.r as Rating));
    });
    host.querySelectorAll<HTMLElement>('[data-opt]').forEach((btn) => {
      btn.addEventListener('click', () => this.pickOption(Number(btn.dataset.opt)));
    });
  }
}
