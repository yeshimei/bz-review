/* ============================================================
 * bz · 统一制卡流程（review/card-wizard.ts）
 *
 * 2026-11-21 用户拍板：**整个插件只有这一套制卡界面**。
 * 以前 bz-reader 里一套（卡片网格 + 确认题面），bz-review 里一套（列表弹窗、
 * 选完直接进计划），同一件事两种界面，且后者连题面都不给看。现在流程住在
 * Review：Reader 只负责挑内容，把 sources 交过来。
 *
 * 四步，一屏到底：
 *   1. 选一种复习方式（全文回忆 / 抽认卡 / 做题 / 挖空）；
 *   2. AI 出第一遍题面（加载态就在这一屏，不另开弹窗）；
 *   3. 确认题面：抽认卡改问句、做题删补题、**挖空用鼠标拖选**；
 *   4. 确认才入库，取消一个字节不写。
 *
 * 三条硬口径：
 *   · 换方式 / 重新出题时先清空旧草稿——上一轮的内容不许在加载时闪出来；
 *   · 生成期间「返回」禁用，关窗即丢弃在途结果（不写盘、不弹已加入）；
 *   · 点遮罩与 ESC 都不关：只有右上角 ✕ 与底部按钮能结束，防误触丢题面。
 * ============================================================ */
import type { App } from 'obsidian';
import { notice } from '../core/notice';
import { uiModal } from '../core/ui/modal';
import { getSettings, saveSettings } from '../core/settings-provider';
import { aiReadyOrGuide } from './ai-guide';
import {
  generateCardContent,
  safeMakeAI,
  type CardContentDraft,
  type CardPrepareContext,
} from './card-ai';
import type { CardMode } from './card-mode';
import { defaultCardMethod } from './card-mode';
import { generateOneQuizQuestion } from './card-quiz';
import { ruleCloze } from './cloze';
import type { ReviewCard } from './data';
import type { ReviewAddSummary, ReviewCardInput } from './reader-api';
import type { QuizQuestion } from './quiz-core/manager';
import { addSpan, clozeToRanges, rangesToCloze, removeSpan, type ClozeSpan } from './cloze-edit';
import {
  clipTitle,
  draftToInput,
  markWizardStates,
  modeNeedsAI,
  WIZARD_MODES,
  type WizardDraft,
  type WizardMode,
  type WizardState,
} from './card-wizard-model';
import { buildModePicker } from './mode-picker';

/** 交给制卡流程的一条内容（Reader 的划线 / 笔记选段都长这样） */
export interface CardWizardSource {
  key: string;
  bookTitle: string;
  chapterTitle?: string;
  text: string;
  comment?: string;
  backlink?: string;
  sourceNote?: { path: string; from: number; to: number };
}

/** 制卡流程需要的数据能力（由 review/index.ts 的门面注入，避免循环依赖） */
export interface CardWizardHost {
  addCards(cards: ReviewCardInput[]): Promise<ReviewAddSummary>;
  statusOf(keys: string[]): Promise<Array<{ path: string; planned: boolean }>>;
  quota(): Promise<{ remaining: number }>;
}

export interface CardWizardOptions {
  sources?: CardWizardSource[];
  /** 异步来源（AI 挑重点 / 读章节）：给了先进加载态，回来再进选方式 */
  load?: () => Promise<CardWizardSource[]>;
  loadingText?: string;
  onAdded?: (res: ReviewAddSummary) => void;
  /** true = 无视「新卡默认方式」，一律先问 */
  forcePick?: boolean;
}

type Step = 'loading' | 'pick' | 'edit' | 'empty';

interface ClozeEditState {
  plain: string;
  spans: ClozeSpan[];
  preview: boolean;
  history: string[];
  msg: string;
}

const STATE_LABEL: Record<WizardState, string> = {
  new: '新增',
  exists: '已在计划',
  over: '超出上限',
};

function srOnly(text: string): HTMLElement {
  return createSpan({ cls: 'bzrv-sr-only', text });
}

function sourceTextChars(s: CardWizardSource): number {
  return Array.from(String(s.text ?? '')).length + Array.from(String(s.comment ?? '')).length;
}

export function openCardWizard(app: App, host: CardWizardHost, opts: CardWizardOptions): void {
  new CardWizard(app, host, opts).open();
}

class CardWizard {
  private app: App;
  private host: CardWizardHost;
  private opts: CardWizardOptions;

  private root: HTMLElement;
  private closeModal: (() => void) | null = null;

  private step: Step = 'pick';
  private mode: WizardMode;
  private sources: CardWizardSource[] = [];
  private existing = new Set<string>();
  private quotaRemaining = Infinity;
  private skipped = 0;

  private drafts: WizardDraft[] = [];
  private states: WizardState[] = [];
  private clozeStates = new Map<string, ClozeEditState>();

  private busy = false;
  private generating = false;
  private genDone = 0;
  private regenIndex = -1;
  private fillIndex = -1;
  private remember = false;
  private cancelled = false;
  private closed = false;
  private errorText = '';
  private listScroll = 0;
  /** 补完一道题要把它滚进视野（增强 3） */
  private pendingScrollKey = '';

  constructor(app: App, host: CardWizardHost, opts: CardWizardOptions) {
    this.app = app;
    this.host = host;
    this.opts = opts;
    const preset = defaultCardMethod(getSettings());
    this.mode = preset && (WIZARD_MODES as readonly string[]).includes(preset)
      ? (preset as WizardMode)
      : 'flashcard';
  }

  open(): void {
    const content = createDiv({ cls: 'bzrv-wiz' });
    this.root = content;
    const { close } = uiModal({
      content,
      maxWidth: 780,
      className: 'bzrv-wiz-popup',
      /* 只认 ✕ 与底部按钮：点遮罩 / ESC 都不关（2026-11-21 用户口径） */
      closable: false,
      head: false,
      onClose: () => { this.closed = true; this.cancelled = true; },
    });
    this.closeModal = close;

    this.render();
    if (this.opts.load) void this.loadSources();
    else void this.setSources(this.opts.sources ?? []);
  }

  /* ── 数据准备 ─────────────────────────────────────────── */

  private async loadSources(): Promise<void> {
    this.step = 'loading';
    this.render();
    let list: CardWizardSource[] = [];
    try {
      list = (await this.opts.load!()) ?? [];
    } catch {
      if (this.closed) return;
      this.errorText = '挑内容的时候出错了，稍后再试一次';
      this.step = 'empty';
      this.render();
      return;
    }
    if (this.closed) return;
    await this.setSources(list);
  }

  private async setSources(raw: CardWizardSource[]): Promise<void> {
    const clean = (Array.isArray(raw) ? raw : []).filter((s) => String(s?.text ?? '').trim());
    if (!clean.length) {
      this.step = 'empty';
      this.render();
      return;
    }
    try {
      const rows = await this.host.statusOf(clean.map((s) => s.key));
      this.existing = new Set(rows.filter((r) => r.planned).map((r) => r.path));
      const quota = await this.host.quota();
      this.quotaRemaining = Number.isFinite(quota.remaining) ? quota.remaining : Infinity;
    } catch {
      this.existing = new Set();
      this.quotaRemaining = Infinity;
    }
    if (this.closed) return;

    const kept = clean.filter((s) => !this.existing.has(s.key));
    this.skipped = clean.length - kept.length;
    this.sources = kept;
    if (!kept.length) {
      this.step = 'empty';
      this.render();
      return;
    }

    const preset = this.opts.forcePick ? null : defaultCardMethod(getSettings());
    if (preset && (WIZARD_MODES as readonly string[]).includes(preset)) {
      this.mode = preset as WizardMode;
      this.render();
      void this.generateAll();
      return;
    }
    this.step = 'pick';
    this.render();
  }

  /* ── 渲染骨架 ─────────────────────────────────────────── */

  private render(): void {
    const oldList = this.root.querySelector<HTMLElement>('.bzrv-wiz-list');
    if (oldList) this.listScroll = oldList.scrollTop;
    this.root.empty();
    this.root.appendChild(this.renderHead());
    const body = this.root.createDiv({ cls: 'bzrv-wiz-body' });
    if (this.step === 'loading') this.renderLoading(body);
    else if (this.step === 'pick') this.renderPick(body);
    else if (this.step === 'edit') this.renderEdit(body);
    else this.renderEmpty(body);
    this.root.appendChild(this.renderFoot());

    if (this.step === 'edit') {
      requestAnimationFrame(() => {
        const list = this.root.querySelector<HTMLElement>('.bzrv-wiz-list');
        if (list) list.scrollTop = this.listScroll;
        const fresh = this.root.querySelector<HTMLElement>('[data-newq="1"]');
        if (fresh) {
          fresh.scrollIntoView({ block: 'nearest' });
          this.pendingScrollKey = '';
        }
      });
    }
  }

  private titleOf(): string {
    if (this.step === 'edit') return '确认题面';
    if (this.step === 'empty') return '没有可加入的内容';
    if (this.step === 'loading') return '正在挑内容';
    return '选一种复习方式';
  }

  private renderHead(): HTMLElement {
    const head = createDiv({ cls: 'bzrv-wiz-head' });
    head.createDiv({ cls: 'bzrv-wiz-title', text: this.titleOf() });
    const x = head.createEl('button', { cls: 'bzrv-wiz-x' });
    x.type = 'button';
    x.appendChild(srOnly('关闭'));
    x.createSpan({ text: '✕' });
    x.addEventListener('click', () => this.close());
    return head;
  }

  private renderFoot(): HTMLElement {
    const foot = createDiv({ cls: 'bzrv-wiz-foot' });
    const add = (label: string, cta: boolean, fn: () => void, disabled = false): HTMLButtonElement => {
      const b = foot.createEl('button', { cls: 'bzrv-wiz-btn' + (cta ? ' is-cta' : ''), text: label });
      b.type = 'button';
      b.disabled = disabled;
      b.addEventListener('click', fn);
      return b;
    };

    if (this.step === 'loading') {
      add('取消', false, () => this.close());
      return foot;
    }
    if (this.step === 'empty') {
      add('关闭', true, () => this.close());
      return foot;
    }
    if (this.step === 'pick') {
      add('取消', false, () => this.close());
      add('下一步', true, () => void this.beginGeneration(), this.busy);
      return foot;
    }

    add('返回', false, () => {
      if (this.busy) return;
      this.step = 'pick';
      this.drafts = [];
      this.states = [];
      this.clozeStates.clear();
      this.render();
    }, this.busy);
    const n = this.drafts.length;
    add(`确认加入（${n} 张）`, true, () => void this.submit(), this.busy || !n);
    return foot;
  }

  private renderLoading(body: HTMLElement): void {
    body.createEl('p', { cls: 'bzrv-wiz-lead', text: 'AI 挑完就在这一页选复习方式，不用再开一个窗口。' });
    const row = body.createDiv({ cls: 'bzrv-wiz-loading' });
    row.createDiv({ cls: 'bzrv-wiz-spinner' });
    row.createSpan({ text: this.opts.loadingText || '正在挑要加入的内容…' });
  }

  private renderPick(body: HTMLElement): void {
    body.createEl('p', {
      cls: 'bzrv-wiz-lead',
      text: '选定方式后会先出一遍题面，确认之后才进复习计划。',
    });
    if (this.skipped > 0) {
      body.createDiv({
        cls: 'bzrv-wiz-note',
        text: `其中 ${this.skipped} 条已经在复习计划里，已跳过，不会重复加入。`,
      });
    }

    const chars = this.sources.reduce((n, s) => n + sourceTextChars(s), 0);
    const picker = buildModePicker({ mode: this.mode, estimatedChars: chars });
    picker.root.dataset.picker = 'add';
    picker.root.addEventListener('click', () => { this.mode = picker.getMode(); });
    body.appendChild(picker.root);

    const remember = body.createEl('label', { cls: 'bzrv-wiz-remember' });
    const box = remember.createEl('input');
    box.type = 'checkbox';
    box.checked = this.remember;
    box.addEventListener('change', () => { this.remember = box.checked; });
    const text = remember.createDiv({ cls: 'bzrv-wiz-remember-text' });
    text.createEl('b', { text: '以后都用这个方式，不再出现这一屏' });
    text.createEl('small', { text: '想改回来，去设置里的「新卡默认方式」改回「每次问我」。' });
  }

  private renderEmpty(body: HTMLElement): void {
    const text = this.errorText
      || (this.skipped > 0
        ? `这 ${this.skipped} 条都已经在复习计划里，不会重复加入。`
        : '没有可加入的内容——先划几笔，或换一段试试。');
    body.createEl('p', { cls: 'bzrv-wiz-lead', text });
  }

  private renderEdit(body: HTMLElement): void {
    body.createEl('p', { cls: 'bzrv-wiz-lead', text: '题面确认后才进复习计划，之后按它复习。' });

    if (this.generating) {
      const bar = body.createDiv({ cls: 'bzrv-wiz-genbar' });
      bar.createDiv({ cls: 'bzrv-wiz-spinner' });
      bar.createSpan({ cls: 'bzrv-wiz-genbar-text', text: this.progressText() });
    }

    const list = body.createDiv({ cls: 'bzrv-wiz-list' });
    /* 生成中不画任何旧草稿：换方式时上一轮的内容不许在这里闪一下 */
    if (!this.generating) {
      this.drafts.forEach((d, i) => list.appendChild(this.renderCard(d, i)));
    }
  }

  private progressText(): string {
    return `正在出题（${this.genDone}/${Math.max(1, this.sources.length)}）`;
  }

  /* ── 单张卡 ───────────────────────────────────────────── */

  private renderCard(d: WizardDraft, i: number): HTMLElement {
    const box = createDiv({ cls: 'bzrv-wiz-card' });
    const head = box.createDiv({ cls: 'bzrv-wiz-card-head' });
    head.createSpan({
      cls: 'bzrv-wiz-card-title',
      text: `${i + 1}. ${d.chapterTitle || d.bookTitle}`,
    });
    const state = this.states[i] ?? 'new';
    head.createSpan({
      cls: 'bzrv-wiz-tag is-' + state,
      text: STATE_LABEL[state],
    });

    const body = box.createDiv({ cls: 'bzrv-wiz-card-body' });
    if (this.regenIndex === i) {
      body.createDiv({ cls: 'bzrv-wiz-skel' }).append(
        createSpan(), createSpan(), createSpan(),
      );
      const busy = body.createDiv({ cls: 'bzrv-wiz-row-busy' });
      busy.createDiv({ cls: 'bzrv-wiz-spinner' });
      busy.createSpan({ text: '正在重新生成这一张…' });
      return box;
    }

    if (d.mode === 'plain') {
      body.createEl('p', { cls: 'bzrv-wiz-src', text: d.text });
    } else if (d.mode === 'flashcard') {
      const field = body.createDiv({ cls: 'bzrv-wiz-field' });
      field.createSpan({ cls: 'bzrv-wiz-label', text: '标题' });
      const input = field.createEl('input', { cls: 'bzrv-wiz-input' });
      input.type = 'text';
      input.value = d.front;
      input.placeholder = '正面提醒';
      input.addEventListener('input', () => { d.front = input.value; });
      const back = body.createDiv({ cls: 'bzrv-wiz-field' });
      back.createSpan({ cls: 'bzrv-wiz-label', text: '正文' }).append(srOnly('只读'));
      back.createDiv({ cls: 'bzrv-wiz-src', text: d.text });
    } else if (d.mode === 'quiz') {
      const field = body.createDiv({ cls: 'bzrv-wiz-field' });
      field.createSpan({ cls: 'bzrv-wiz-label', text: '标题' });
      const input = field.createEl('input', { cls: 'bzrv-wiz-input' });
      input.type = 'text';
      input.value = d.title;
      input.placeholder = '这批题的标题';
      input.addEventListener('input', () => { d.title = input.value; });

      const qs = body.createDiv({ cls: 'bzrv-wiz-qs' });
      if (!d.questions.length && this.fillIndex !== i) {
        qs.createEl('p', { cls: 'bzrv-wiz-empty', text: '没出到题，点「补一道题」或「重新生成」。' });
      }
      d.questions.forEach((q, qi) => qs.appendChild(this.renderQuestion(d, qi, q)));
      if (this.fillIndex === i) {
        const busy = qs.createDiv({ cls: 'bzrv-wiz-row-busy' });
        busy.createDiv({ cls: 'bzrv-wiz-spinner' });
        busy.createSpan({ text: '正在补一道题…' });
      }
      if (this.pendingScrollKey === d.key) qs.lastElementChild?.setAttr('data-newq', '1');
    } else {
      body.appendChild(this.renderCloze(d));
    }

    this.renderTools(body, i);
    return box;
  }

  private renderQuestion(d: WizardDraft, qi: number, q: QuizQuestion): HTMLElement {
    const row = createDiv({ cls: 'bzrv-wiz-q' });
    const head = row.createDiv({ cls: 'bzrv-wiz-q-head' });
    head.createSpan({ cls: 'bzrv-wiz-q-no', text: String(qi + 1) });
    const del = head.createEl('button', { cls: 'bzrv-wiz-q-del' });
    del.type = 'button';
    del.appendChild(srOnly('删掉这题'));
    del.createSpan({ text: '✕' });
    del.disabled = this.busy;
    del.addEventListener('click', () => {
      d.questions.splice(qi, 1);
      this.render();
    });

    const input = row.createEl('input', { cls: 'bzrv-wiz-input' });
    input.type = 'text';
    input.value = q.question;
    input.addEventListener('input', () => { q.question = input.value; });

    const opts = row.createDiv({ cls: 'bzrv-wiz-opts' });
    q.options.forEach((o, oi) => {
      const line = opts.createDiv({ cls: 'bzrv-wiz-opt' });
      if (q.correctIndices.includes(oi)) line.addClass('is-correct');
      line.createSpan({ cls: 'bzrv-wiz-opt-k', text: String.fromCharCode(65 + oi) });
      line.createSpan({ cls: 'bzrv-wiz-opt-t', text: o });
      if (q.correctIndices.includes(oi)) line.createSpan({ cls: 'bzrv-wiz-opt-mark', text: '✓' });
    });
    return row;
  }

  private renderTools(body: HTMLElement, i: number): void {
    const d = this.drafts[i];
    if (!d) return;
    const bar = body.createDiv({ cls: 'bzrv-wiz-tools' });
    if (d.mode === 'quiz') {
      const add = bar.createEl('button', { cls: 'bzrv-wiz-mini', text: '补一道题' });
      add.type = 'button';
      add.disabled = this.busy;
      add.addEventListener('click', () => void this.fillOne(i));
    }
    const regen = bar.createEl('button', { cls: 'bzrv-wiz-mini', text: '重新生成' });
    regen.type = 'button';
    regen.disabled = this.busy;
    regen.addEventListener('click', () => void this.regenOne(i));
  }

  /* ── 挖空编辑器（鼠标拖选） ───────────────────────────── */

  private clozeState(d: WizardDraft): ClozeEditState {
    let st = this.clozeStates.get(d.key);
    if (!st) {
      const model = d.cloze ? clozeToRanges(d.cloze.text, d.cloze.blanks) : { plain: d.text, spans: [] };
      st = { plain: model.plain, spans: model.spans, preview: false, history: [], msg: '' };
      this.clozeStates.set(d.key, st);
    }
    return st;
  }

  private renderCloze(d: WizardDraft): HTMLElement {
    const st = this.clozeState(d);
    const box = createDiv({ cls: 'bzrv-wiz-cloze' });

    const bar = box.createDiv({ cls: 'bzrv-wiz-cloze-bar' });
    bar.createSpan({ cls: 'bzrv-wiz-count', text: `已挖 ${st.spans.length} 处` });
    bar.createSpan({ cls: 'bzrv-wiz-grow' });
    const mini = (label: string, fn: () => void): void => {
      const b = bar.createEl('button', { cls: 'bzrv-wiz-mini', text: label });
      b.type = 'button';
      b.addEventListener('click', fn);
    };
    mini('撤销', () => this.clozeUndo(d));
    mini('清空', () => {
      if (!st.spans.length) return;
      st.history.push(JSON.stringify(st.spans));
      st.spans = [];
      this.render();
    });
    mini(st.preview ? '回到编辑' : '看复习时的样子', () => {
      st.preview = !st.preview;
      this.render();
    });

    const src = box.createDiv({
      cls: 'bzrv-wiz-cloze-src' + (st.preview ? ' is-preview' : ''),
    });
    this.paintCloze(d, st, src);
    if (!st.preview) {
      const onUp = (ev: Event): void => this.onClozeUp(ev, d, src);
      src.addEventListener('mouseup', onUp);
      src.addEventListener('touchend', onUp);
    }

    box.createEl('p', {
      cls: 'bzrv-wiz-hint',
      text: st.preview
        ? '复习时长这样：空位藏起来，只留下划线让你回忆。'
        : '用鼠标拖选要挖掉的文字；拖选（或点一下）紫色空位就能还原。',
    });
    if (st.msg) box.createDiv({ cls: 'bzrv-wiz-note', text: st.msg });
    return box;
  }

  /** 把纯文本 + 区间画成段落与紫色空位 */
  private paintCloze(d: WizardDraft, st: ClozeEditState, src: HTMLElement): void {
    const paras = st.plain.split('\n');
    let base = 0;
    paras.forEach((text, pi) => {
      const p = src.createEl('p', { cls: 'bzrv-wiz-para' });
      p.dataset.i = String(pi);
      const segs = st.spans
        .filter((s) => s.start < base + text.length && s.end > base)
        .map((s) => ({
          gs: Math.max(s.start, base),
          ge: Math.min(s.end, base + text.length),
          s: Math.max(s.start, base) - base,
          e: Math.min(s.end, base + text.length) - base,
        }))
        .sort((a, b) => a.s - b.s);

      let cur = 0;
      for (const seg of segs) {
        if (seg.s > cur) p.appendChild(document.createTextNode(text.slice(cur, seg.s)));
        const no = st.spans.findIndex((s) => s.start === seg.gs && s.end === seg.ge) + 1;
        const mark = p.createSpan({ cls: 'bzrv-wiz-blank' });
        mark.createSpan({ cls: 'bzrv-wiz-blank-text', text: text.slice(seg.s, seg.e) });
        mark.createSpan({ cls: 'bzrv-wiz-blank-no', text: String(no) });
        mark.dataset.start = String(seg.gs);
        mark.dataset.end = String(seg.ge);
        if (!st.preview) {
          mark.addEventListener('click', (ev) => {
            ev.stopPropagation();
            if (window.getSelection()?.toString()) return;
            st.history.push(JSON.stringify(st.spans));
            st.spans = removeSpan(st.spans, seg.gs, seg.ge);
            st.msg = '已还原';
            this.render();
          });
        }
        p.appendChild(mark);
        cur = seg.e;
      }
      if (cur < text.length) p.appendChild(document.createTextNode(text.slice(cur)));
      base += text.length + 1;
    });
  }

  private onClozeUp(ev: Event, d: WizardDraft, src: HTMLElement): void {
    void ev;
    if (this.busy) return;
    const st = this.clozeState(d);
    if (st.preview) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    if (!src.contains(range.commonAncestorContainer)) return;

    const start = this.clozeOffset(src, range.startContainer, range.startOffset);
    const end = this.clozeOffset(src, range.endContainer, range.endOffset);
    sel.removeAllRanges();
    if (start == null || end == null) return;

    const res = addSpan(st.plain, st.spans, start, end);
    if (res.action === 'rejected') {
      st.msg = res.reason === 'tooLong'
        ? '一次挖太长了，挑一个关键词就好'
        : res.reason === 'visible'
          ? '再挖下去就没有提示了，留一点原文'
          : '这段没有可挖的文字';
      this.render();
      return;
    }
    st.history.push(JSON.stringify(st.spans));
    st.spans = res.spans;
    st.msg = res.action === 'removed' ? `已还原 ${res.count ?? 1} 处` : '';
    this.render();
  }

  /** DOM 选区 → 纯文本下标（段落起点由段落文本长度累加） */
  private clozeOffset(src: HTMLElement, node: Node, offset: number): number | null {
    const box = node.nodeType === 1 ? (node as HTMLElement) : node.parentElement;
    const p = box?.closest?.('.bzrv-wiz-para') as HTMLElement | null;
    if (!p) return null;
    const paras = Array.from(src.querySelectorAll<HTMLElement>('.bzrv-wiz-para'));
    const idx = paras.indexOf(p);
    if (idx < 0) return null;
    let start = 0;
    for (let i = 0; i < idx; i += 1) start += (paras[i].textContent ?? '').length + 1;
    const r = document.createRange();
    r.selectNodeContents(p);
    try {
      r.setEnd(node, offset);
    } catch {
      return null;
    }
    return start + r.toString().length;
  }

  private clozeUndo(d: WizardDraft): void {
    const st = this.clozeState(d);
    const prev = st.history.pop();
    if (!prev) return;
    st.spans = JSON.parse(prev) as ClozeSpan[];
    st.msg = '已撤销';
    this.render();
  }

  /* ── 出题 ─────────────────────────────────────────────── */

  private async beginGeneration(): Promise<void> {
    if (this.busy) return;
    /* 勾了「以后都用这个方式」：写进 Review 自己的「新卡默认方式」 */
    if (this.remember) {
      const settings = getSettings();
      settings.reviewCardDefaultMethod = this.mode;
      await saveSettings().catch(() => undefined);
    }
    if (modeNeedsAI(this.mode) && !(await aiReadyOrGuide('制卡要用 AI'))) return;
    await this.generateAll();
  }

  private async generateAll(): Promise<void> {
    this.busy = true;
    this.generating = true;
    this.genDone = 0;
    this.drafts = [];
    this.states = [];
    this.clozeStates.clear();
    this.step = 'edit';
    this.render();

    const out: WizardDraft[] = [];
    for (let i = 0; i < this.sources.length; i += 1) {
      const draft = await this.makeDraft(this.sources[i], this.mode);
      out.push(draft);
      this.genDone = i + 1;
      const bar = this.root.querySelector<HTMLElement>('.bzrv-wiz-genbar-text');
      if (bar) bar.textContent = this.progressText();
      if (this.cancelled) return;
    }
    if (this.cancelled) return;

    this.drafts = out;
    this.states = markWizardStates(out.map((d) => d.key), this.existing, this.quotaRemaining);
    this.generating = false;
    this.busy = false;
    this.render();
  }

  private prepareCtx(mode: WizardMode, card: ReviewCard): CardPrepareContext {
    return {
      mode: mode as CardMode,
      loadCard: async () => card,
      updateCard: async () => undefined,
      loadQuiz: async () => null,
      saveQuiz: async () => undefined,
      makeAI: safeMakeAI,
    };
  }

  private cardOf(d: WizardDraft): ReviewCard {
    const card: ReviewCard = {
      key: d.key,
      bookTitle: d.bookTitle,
      text: d.text,
      mode: d.mode as CardMode,
    };
    if (d.chapterTitle) card.chapterTitle = d.chapterTitle;
    if (d.comment) card.comment = d.comment;
    if (d.backlink) card.backlink = d.backlink;
    if (d.sourceNote) card.sourceNote = d.sourceNote;
    return card;
  }

  /** 一条来源 → 一张待确认的草稿（挖空与抽认卡失败时都有兜底） */
  private async makeDraft(src: CardWizardSource, mode: WizardMode): Promise<WizardDraft> {
    const d: WizardDraft = {
      key: src.key,
      bookTitle: src.bookTitle,
      text: src.text,
      mode,
      front: '',
      title: '',
      questions: [],
      cloze: null,
    };
    if (src.chapterTitle) d.chapterTitle = src.chapterTitle;
    if (src.comment) d.comment = src.comment;
    if (src.backlink) d.backlink = src.backlink;
    if (src.sourceNote) d.sourceNote = src.sourceNote;
    if (mode === 'plain') return d;

    const card = this.cardOf(d);
    let generated: CardContentDraft | null = null;
    try {
      generated = await generateCardContent(card, this.prepareCtx(mode, card));
    } catch {
      generated = null;
    }
    if (this.cancelled) return d;

    if (mode === 'flashcard') {
      /* 出不来就问原文本身：宁可退化成全文回忆，也不给一张空白卡 */
      d.front = String(generated?.qa?.q ?? '').trim() || src.text;
      return d;
    }
    if (mode === 'quiz') {
      d.questions = generated?.questions ?? [];
      d.title = clipTitle(d.questions[0]?.question ?? '');
      return d;
    }

    const cloze = generated?.cloze ?? ruleCloze(src.text);
    d.cloze = cloze.blanks.length
      ? { text: cloze.text, blanks: cloze.blanks }
      : { text: src.text, blanks: [] };
    return d;
  }

  private async regenOne(i: number): Promise<void> {
    const d = this.drafts[i];
    if (!d || this.busy) return;
    this.busy = true;
    this.regenIndex = i;
    this.render();
    const fresh = await this.makeDraft(this.sourceOf(d), d.mode);
    this.busy = false;
    this.regenIndex = -1;
    if (this.cancelled) return;
    d.front = fresh.front;
    d.title = fresh.title;
    d.questions = fresh.questions;
    d.cloze = fresh.cloze;
    this.clozeStates.delete(d.key);
    this.render();
  }

  private async fillOne(i: number): Promise<void> {
    const d = this.drafts[i];
    if (!d || this.busy) return;
    this.busy = true;
    this.fillIndex = i;
    this.render();
    const q = await generateOneQuizQuestion(this.cardOf(d), safeMakeAI);
    this.busy = false;
    this.fillIndex = -1;
    if (this.cancelled) return;
    if (!q) {
      this.render();
      notice('这次没补出题来，待会儿再试', 'warning');
      return;
    }
    const flat = (s: string): string => s.replace(/\s+/g, '');
    if (d.questions.some((x) => flat(x.question) === flat(q.question))) {
      this.render();
      notice('这道题已经有了', 'info');
      return;
    }
    d.questions.push(q);
    this.pendingScrollKey = d.key;
    this.render();
  }

  private sourceOf(d: WizardDraft): CardWizardSource {
    const s: CardWizardSource = { key: d.key, bookTitle: d.bookTitle, text: d.text };
    if (d.chapterTitle) s.chapterTitle = d.chapterTitle;
    if (d.comment) s.comment = d.comment;
    if (d.backlink) s.backlink = d.backlink;
    if (d.sourceNote) s.sourceNote = d.sourceNote;
    return s;
  }

  /* ── 入库 ─────────────────────────────────────────────── */

  private validate(): string | null {
    for (const d of this.drafts) {
      if (d.mode !== 'cloze') continue;
      const st = this.clozeState(d);
      const cloze = rangesToCloze(st.plain, st.spans);
      if (!cloze.blanks.length) return '挖空卡还没有空位：在原文上拖选一段就能挖。';
    }
    return null;
  }

  private async submit(): Promise<void> {
    if (this.busy) return;
    const bad = this.validate();
    if (bad) {
      notice(bad, 'warning');
      return;
    }
    const fresh = this.drafts.filter((_, i) => this.states[i] !== 'exists');
    if (!fresh.length) {
      notice('这些内容都已经在复习计划里了', 'info');
      this.close();
      return;
    }

    /* 提交前把编辑器里的区间写回草稿（挖空是这里唯一「边改边存」的方式） */
    for (const d of fresh) {
      if (d.mode !== 'cloze') continue;
      const st = this.clozeState(d);
      d.cloze = rangesToCloze(st.plain, st.spans);
    }

    this.busy = true;
    this.render();
    try {
      const res = await this.host.addCards(fresh.map(draftToInput));
      const parts = [`已加入 ${res.added} 张`];
      if (res.exists) parts.push(`${res.exists} 张本来就在计划里`);
      if (res.rejected) parts.push(`${res.rejected} 张超出基础版上限`);
      if (res.notFound) parts.push(`${res.notFound} 张找不到原文`);
      notice(parts.join('，'), res.added ? 'success' : 'warning');
      try {
        this.opts.onAdded?.(res);
      } catch {
        /* 回调失败不回收已经进计划的卡 */
      }
      this.close();
    } catch {
      notice('加入复习失败，稍后再试一次', 'error');
      this.busy = false;
      this.render();
    }
  }

  private close(): void {
    this.cancelled = true;
    this.closeModal?.();
  }
}
