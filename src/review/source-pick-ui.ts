/* ============================================================
 * bz · 从阅读器加入复习（review/source-pick-ui.ts）
 *
 * 2026-11-21 用户拍板：**复习相关的一切都归 Review**。这个窗口从 bz-reader
 * 的侧栏/书右键入口打开（也可以从 Review 自己的命令打开），做三件事：
 *   1. 选书（从 Review 命令进来才需要；从书里进来直接锁定当前书）；
 *   2. 挑范围（按划线 / 按章节，勾章节组 / 勾章节）；
 *   3. 确认（字数、每章上限、字数警告）→ 交给统一制卡窗口。
 *
 * 挑内容时的 AI（划线挑重点 / 正文挑句子）也在这里调，Reader 那边只供货。
 * 视觉沿用 Review 的弹窗与 token（.bzrv-pick-*），不再搬 Reader 的样式。
 * ============================================================ */
import type { App } from 'obsidian';
import { createAI, type AIService } from '../core/ai';
import { notice } from '../core/notice';
import { uiModal } from '../core/ui/modal';
import { readerJumpUrl } from '../core/reader-link';
import { aiReadyOrGuide } from './ai-guide';
import { openCardWizard, type CardWizardOptions } from './card-wizard';
import { getReviewPlanApi } from './reader-api';
import {
  findReaderReviewApi,
  type ReaderCatalogBook,
  type ReaderCatalogBookDetail,
  type ReaderReviewApi,
} from './reader-source';
import {
  capSourcesPerChapter,
  markChapterGroups,
  PICK_BLOCK_CHARS,
  PICK_WARN_CHARS,
  pickedChapters,
  pickedMarkStats,
  pickedMarks,
  resolvePick,
  type MarkChapterGroup,
} from './source-pick';
import type { CardWizardSource } from './card-wizard';

function fmt(n: number): string {
  return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function groupKey(g: MarkChapterGroup): string {
  return `${g.index}\u0001${g.title}`;
}

/** 来源补上「回到原文」的链接：Review 卡片靠它跳回 Reader 的那一句 */
function withBacklink(bookId: string, sources: CardWizardSource[]): CardWizardSource[] {
  for (const s of sources) {
    if (s.backlink) continue;
    s.backlink = readerJumpUrl(bookId, { text: s.text, chapter: s.chapterTitle });
  }
  return sources;
}

/**
 * 组装统一制卡窗口的宿主。
 *
 * 与 review/index.ts 的 openCardWizardForAdd 同一口径；这里不 import index，
 * 免得 `index → ui → source-pick-ui → index` 绕成循环依赖。
 */
function openWizard(app: App, opts: CardWizardOptions): void {
  const api = getReviewPlanApi();
  if (!api) {
    notice('复习模块还没准备好，稍后再试一次', 'warning');
    return;
  }
  openCardWizard(app, {
    addCards: (cards) => api.addCards(cards),
    statusOf: (keys) => api.statusOf(keys),
    quota: () => api.quota(),
  }, opts);
}

type Stage = 'loading' | 'books' | 'pick' | 'confirm';

/**
 * 打开「从阅读器加入复习」。
 *
 * @param opts.bookId 从 bz-reader 的书内入口进来时给当前书 id；不给就先列书。
 */
export function openSourcePicker(app: App, opts: { bookId?: string } = {}): void {
  const api = findReaderReviewApi(app);
  if (!api) {
    notice('从书里加入复习要新版 bz Reader：请在插件市场更新后重试。', 'warning');
    return;
  }
  new SourcePicker(app, api, opts.bookId).open();
}

class SourcePicker {
  private app: App;
  private api: ReaderReviewApi;
  private bookId: string;

  private closeModal: (() => void) | null = null;
  private root: HTMLElement | null = null;
  private closed = false;

  private stage: Stage = 'loading';
  private loadingText = '正在读 Reader 的书架…';
  private errorText = '';

  private books: ReaderCatalogBook[] = [];
  private book: ReaderCatalogBookDetail | null = null;
  private tab: 'marks' | 'chapters' = 'marks';
  private markPicked = new Set<string>();
  private chapPicked = new Set<number>();
  private limit = 0;
  private busy = false;
  private confirmInfo: { chapters: number; marks: number; chars: number } | null = null;

  /** 正文缓存：确认页统计与 AI 挑句共用，别让一本书被反复解析 */
  private bodyCache = new Map<number, string>();

  constructor(app: App, api: ReaderReviewApi, bookId?: string) {
    this.app = app;
    this.api = api;
    this.bookId = String(bookId ?? '').trim();
  }

  open(): void {
    const root = createDiv({ cls: 'bzrv-pick' });
    this.root = root;
    const { close } = uiModal({
      content: root,
      maxWidth: 720,
      className: 'bzrv-pick-popup',
      /* 挑内容是前置步骤，随时可以退；制卡窗口才用「只能 ✕ / 底部按钮关」那套 */
      closable: true,
      head: false,
      onClose: () => {
        this.closed = true;
      },
    });
    this.closeModal = close;
    if (this.bookId) void this.loadBook(this.bookId);
    else void this.loadBooks();
  }

  /* ── 数据 ───────────────────────────────────────────── */

  private async loadBooks(): Promise<void> {
    this.stage = 'loading';
    this.loadingText = '正在读 Reader 的书架…';
    this.errorText = '';
    this.render();
    try {
      const cat = await this.api.reviewCatalog();
      this.books = (cat.books ?? []).filter((b) => String(b.id ?? '').trim());
    } catch {
      this.books = [];
    }
    if (this.closed) return;
    this.stage = 'books';
    this.render();
  }

  private async loadBook(bookId: string): Promise<void> {
    this.stage = 'loading';
    this.loadingText = '正在读这本书的划线…';
    this.errorText = '';
    this.render();
    let book: ReaderCatalogBookDetail | null = null;
    try {
      const cat = await this.api.reviewCatalog(bookId);
      book = cat.book ?? null;
    } catch {
      book = null;
    }
    if (this.closed) return;
    if (!book) {
      this.errorText = '这本书的内容读不出来，稍后再试一次';
      this.stage = 'books';
      this.render();
      return;
    }
    this.book = book;
    this.bookId = book.id;
    this.tab = book.marks.length ? 'marks' : 'chapters';
    this.markPicked = new Set();
    this.chapPicked = new Set();
    this.stage = 'pick';
    this.render();
  }

  /** 读某一章正文（带缓存）；失败按空串处理，让 AI 挑句那一侧跳过 */
  private async body(index: number): Promise<string> {
    const hit = this.bodyCache.get(index);
    if (hit !== undefined) return hit;
    if (!this.book) return '';
    try {
      const text = await this.api.reviewChapterText(this.book.id, index);
      const clean = String(text ?? '');
      this.bodyCache.set(index, clean);
      return clean;
    } catch {
      return '';
    }
  }

  /* ── 渲染 ───────────────────────────────────────────── */

  private render(): void {
    if (!this.root || this.closed) return;
    this.root.empty();
    this.root.appendChild(this.renderHead());
    const body = this.root.createDiv({ cls: 'bzrv-pick-body' });
    if (this.stage === 'books') this.renderBooks(body);
    else if (this.stage === 'pick') this.renderPick(body);
    else if (this.stage === 'confirm') this.renderConfirm(body);
    else this.renderLoading(body);
    this.root.appendChild(this.renderFoot());
  }

  private titleOf(): string {
    if (this.stage === 'books') return '从阅读器加入复习';
    if (this.stage === 'confirm') return '确认要加入的内容';
    if (this.stage === 'pick') return '选要加入的内容';
    return '正在读取';
  }

  private renderHead(): HTMLElement {
    const head = createDiv({ cls: 'bzrv-pick-head' });
    head.createDiv({ cls: 'bzrv-pick-title', text: this.titleOf() });
    const x = head.createEl('button', { cls: 'bzrv-pick-x' });
    x.type = 'button';
    x.appendChild(createSpan({ cls: 'bzrv-sr-only', text: '关闭' }));
    x.createSpan({ text: '✕' });
    x.addEventListener('click', () => this.close());
    return head;
  }

  private renderFoot(): HTMLElement {
    const foot = createDiv({ cls: 'bzrv-pick-foot' });
    const add = (label: string, cta: boolean, fn: () => void, disabled = false): HTMLButtonElement => {
      const b = foot.createEl('button', { cls: 'bzrv-pick-btn' + (cta ? ' is-cta' : ''), text: label });
      b.type = 'button';
      b.disabled = disabled;
      b.addEventListener('click', fn);
      return b;
    };

    if (this.stage === 'loading') {
      add('取消', false, () => this.close());
      return foot;
    }
    if (this.stage === 'books') {
      add('取消', false, () => this.close());
      return foot;
    }
    if (this.stage === 'pick') {
      add('取消', false, () => this.close());
      add('下一步', true, () => void this.toConfirm(), this.busy);
      return foot;
    }
    add('返回', false, () => {
      this.stage = 'pick';
      this.confirmInfo = null;
      this.render();
    });
    const chars = this.confirmInfo?.chars ?? 0;
    add('开始', true, () => void this.start(), this.busy || chars > PICK_BLOCK_CHARS);
    return foot;
  }

  private renderLoading(body: HTMLElement): void {
    const wrap = body.createDiv({ cls: 'bzrv-pick-empty' });
    wrap.createDiv({ cls: 'bzrv-pick-loading', text: this.loadingText });
    if (this.errorText) wrap.createDiv({ cls: 'bzrv-pick-error', text: this.errorText });
  }

  private renderBooks(body: HTMLElement): void {
    if (this.errorText) {
      const wrap = body.createDiv({ cls: 'bzrv-pick-empty' });
      wrap.createDiv({ cls: 'bzrv-pick-error', text: this.errorText });
    }
    if (!this.books.length) {
      const wrap = body.createDiv({ cls: 'bzrv-pick-empty' });
      wrap.createDiv({ text: 'Reader 书架里还没有书。先在 bz Reader 导入一本书，再回来加入复习。' });
      return;
    }
    body.createDiv({ cls: 'bzrv-pick-lead', text: '选一本书，再挑要加入复习的划线或章节。' });
    const list = body.createDiv({ cls: 'bzrv-pick-books' });
    for (const b of this.books) {
      const row = list.createEl('button', { cls: 'bzrv-pick-book' });
      row.type = 'button';
      row.createDiv({ cls: 'bzrv-pick-book-name', text: b.title || '未命名' });
      row.createDiv({ cls: 'bzrv-pick-book-sub', text: `${b.author || '佚名'} · ${fmt(b.markCount)} 条划线` });
      row.addEventListener('click', () => void this.loadBook(b.id));
    }
  }

  private renderPick(body: HTMLElement): void {
    const book = this.book;
    if (!book) return;
    const meta = body.createDiv({ cls: 'bzrv-pick-bookmeta' });
    meta.createDiv({ cls: 'bzrv-pick-bookmeta-name', text: book.title || '未命名' });
    meta.createDiv({ cls: 'bzrv-pick-bookmeta-sub', text: book.author || '佚名' });

    const tabs = body.createDiv({ cls: 'bzrv-pick-tabs' });
    const mkTab = (key: 'marks' | 'chapters', label: string): void => {
      const b = tabs.createEl('button', { cls: 'bzrv-pick-tab' + (this.tab === key ? ' is-on' : ''), text: label });
      b.type = 'button';
      b.addEventListener('click', () => {
        if (this.tab === key) return;
        this.tab = key;
        this.render();
      });
    };
    mkTab('marks', '按划线');
    mkTab('chapters', '按章节');

    if (this.tab === 'marks') this.renderMarkPick(body, book);
    else this.renderChapterPick(body, book);
  }

  private renderMarkPick(body: HTMLElement, book: ReaderCatalogBookDetail): void {
    const groups = markChapterGroups(book.marks);
    body.createDiv({ cls: 'bzrv-pick-lead', text: '勾选章节：这一章里的划线会交给 AI 挑重点，值得记的才做成卡。' });
    if (!groups.length) {
      body.createDiv({ cls: 'bzrv-pick-empty', text: '这本书还没有划线。可以切到「按章节」，让 AI 从正文里挑。' });
      return;
    }
    const list = body.createDiv({ cls: 'bzrv-pick-list' });
    for (const g of groups) {
      const key = groupKey(g);
      const row = list.createEl('label', { cls: 'bzrv-pick-row' });
      const cb = row.createEl('input', { cls: 'bzrv-pick-check' });
      cb.type = 'checkbox';
      cb.checked = this.markPicked.has(key);
      cb.addEventListener('change', () => {
        if (cb.checked) this.markPicked.add(key);
        else this.markPicked.delete(key);
        this.syncBar();
      });
      const main = row.createDiv({ cls: 'bzrv-pick-row-main' });
      main.createDiv({ cls: 'bzrv-pick-row-title', text: g.title || '未命名章节' });
      main.createDiv({ cls: 'bzrv-pick-row-sub', text: `${fmt(g.count)} 条 · ${fmt(g.chars)} 字` });
    }
    this.renderSelectBar(body, groups.length, () => {
      const every = groups.every((g) => this.markPicked.has(groupKey(g)));
      this.markPicked = new Set(every ? [] : groups.map(groupKey));
      this.render();
    });
    const stats = pickedMarkStats(book.marks, Array.from(this.markPicked));
    body.createDiv({
      cls: 'bzrv-pick-sum',
      text: `已选 ${fmt(this.markPicked.size)} 章 · ${fmt(stats.count)} 条划线 · ${fmt(stats.chars)} 字`,
    });
  }

  private renderChapterPick(body: HTMLElement, book: ReaderCatalogBookDetail): void {
    body.createDiv({ cls: 'bzrv-pick-lead', text: '勾选章节：AI 会读这些章节的正文，从中挑值得记住的句子做成卡。' });
    if (!book.chapters.length) {
      body.createDiv({ cls: 'bzrv-pick-empty', text: '这本书的章节目录读不出来。可以切回「按划线」，从已有划线里挑。' });
      return;
    }
    const list = body.createDiv({ cls: 'bzrv-pick-list' });
    for (const c of book.chapters) {
      const row = list.createEl('label', { cls: 'bzrv-pick-row' });
      const cb = row.createEl('input', { cls: 'bzrv-pick-check' });
      cb.type = 'checkbox';
      cb.checked = this.chapPicked.has(c.index);
      cb.addEventListener('change', () => {
        if (cb.checked) this.chapPicked.add(c.index);
        else this.chapPicked.delete(c.index);
        this.syncBar();
      });
      const main = row.createDiv({ cls: 'bzrv-pick-row-main' });
      main.createDiv({ cls: 'bzrv-pick-row-title', text: c.title || `第 ${c.index + 1} 章` });
    }
    this.renderSelectBar(body, book.chapters.length, () => {
      const every = book.chapters.every((c) => this.chapPicked.has(c.index));
      this.chapPicked = new Set(every ? [] : book.chapters.map((c) => c.index));
      this.render();
    });
    body.createDiv({ cls: 'bzrv-pick-sum', text: `已选 ${fmt(this.chapPicked.size)} 章` });
  }

  private renderSelectBar(body: HTMLElement, total: number, toggle: () => void): void {
    const bar = body.createDiv({ cls: 'bzrv-pick-bar' });
    const every = total > 0 && (this.tab === 'marks'
      ? this.markPicked.size === total
      : this.chapPicked.size === total);
    const b = bar.createEl('button', { cls: 'bzrv-pick-link', text: every ? '全不选' : '全选' });
    b.type = 'button';
    b.addEventListener('click', toggle);
  }

  /** 勾选变化只刷新底部统计，不整屏重画（列表长了才不会跳回顶部） */
  private syncBar(): void {
    if (!this.root) return;
    const stats = this.root.querySelector<HTMLElement>('.bzrv-pick-sum');
    if (!stats || !this.book) return;
    if (this.tab === 'marks') {
      const s = pickedMarkStats(this.book.marks, Array.from(this.markPicked));
      stats.textContent = `已选 ${fmt(this.markPicked.size)} 章 · ${fmt(s.count)} 条划线 · ${fmt(s.chars)} 字`;
    } else {
      stats.textContent = `已选 ${fmt(this.chapPicked.size)} 章`;
    }
    const all = this.root.querySelector<HTMLElement>('.bzrv-pick-link');
    if (all) {
      const total = this.tab === 'marks' ? markChapterGroups(this.book.marks).length : this.book.chapters.length;
      const every = total > 0 && (this.tab === 'marks' ? this.markPicked.size === total : this.chapPicked.size === total);
      all.textContent = every ? '全不选' : '全选';
    }
  }

  /* ── 确认 ───────────────────────────────────────────── */

  private async toConfirm(): Promise<void> {
    if (this.busy || !this.book) return;
    if (this.tab === 'marks') {
      const stats = pickedMarkStats(this.book.marks, Array.from(this.markPicked));
      if (!stats.count) {
        notice('先勾选至少一个章节', 'info');
        return;
      }
      this.confirmInfo = { chapters: this.markPicked.size, marks: stats.count, chars: stats.chars };
      this.stage = 'confirm';
      this.render();
      return;
    }

    if (!this.chapPicked.size) {
      notice('先勾选至少一个章节', 'info');
      return;
    }
    const picked = Array.from(this.chapPicked).sort((a, b) => a - b);
    this.busy = true;
    this.stage = 'loading';
    this.loadingText = '正在统计字数…';
    this.render();
    let chars = 0;
    for (const i of picked) chars += Array.from(await this.body(i)).length;
    this.busy = false;
    if (this.closed) return;
    this.confirmInfo = { chapters: picked.length, marks: 0, chars };
    this.stage = 'confirm';
    this.render();
  }

  private renderConfirm(body: HTMLElement): void {
    const info = this.confirmInfo;
    if (!info) return;
    const box = body.createDiv({ cls: 'bzrv-pick-confirm' });
    const line = (text: string, cls = ''): void => {
      const p = box.createDiv({ cls: 'bzrv-pick-confirm-line' + (cls ? ` ${cls}` : ''), text });
      p.title = '';
    };
    line(`方式：${this.tab === 'marks' ? '按划线挑重点' : '按章节挑句子'}`);
    line(
      this.tab === 'marks'
        ? `范围：${fmt(info.chapters)} 章 · ${fmt(info.marks)} 条划线`
        : `范围：${fmt(info.chapters)} 章`,
    );
    line(`字数：${fmt(info.chars)} 字`);

    if (this.tab === 'chapters') {
      const row = box.createDiv({ cls: 'bzrv-pick-limit' });
      const main = row.createDiv({ cls: 'bzrv-pick-limit-main' });
      main.createDiv({ cls: 'bzrv-pick-limit-name', text: '每章最多几张' });
      main.createDiv({ cls: 'bzrv-pick-limit-hint', text: '留 0 让 AI 按这一章的长度自己定；填了数字就是上限，不够不凑。' });
      const input = row.createEl('input', { cls: 'bzrv-pick-limit-input' });
      input.type = 'number';
      input.min = '0';
      input.value = String(this.limit);
      input.addEventListener('input', () => {
        this.limit = Math.max(0, Math.round(Number(input.value) || 0));
      });
    }

    if (info.chars > PICK_BLOCK_CHARS) {
      line(`内容太多了（${fmt(info.chars)} 字，上限 ${fmt(PICK_BLOCK_CHARS)} 字）：先少选几章再试。`, 'is-error');
    } else if (info.chars > PICK_WARN_CHARS) {
      line(`内容偏多（${fmt(info.chars)} 字）：会分几批发给模型，耗时和费用都会上去。`, 'is-warn');
    } else {
      line('确认后会先让 AI 挑内容，再进入选复习方式——不确认不会写入任何卡片。', 'is-note');
    }
  }

  /* ── 交给统一制卡 ───────────────────────────────────── */

  private async start(): Promise<void> {
    if (this.busy) return;
    const book = this.book;
    const info = this.confirmInfo;
    if (!book || !info) return;
    if (info.chars > PICK_BLOCK_CHARS) return;

    this.busy = true;
    this.render();
    const ok = await aiReadyOrGuide('挑要加入的内容要用 AI');
    if (!ok) {
      this.busy = false;
      this.render();
      return;
    }
    let ai: AIService | null = null;
    try {
      ai = createAI();
    } catch {
      ai = null;
    }
    if (!ai) {
      notice('AI 服务没准备好，稍后再试一次', 'warning');
      this.busy = false;
      this.render();
      return;
    }
    const service = ai;
    const ask = (prompt: string): Promise<string> => service.chat(prompt);

    const tab = this.tab;
    const bookId = book.id;
    const bookTitle = book.title;
    const limit = this.limit;
    const marks = tab === 'marks' ? pickedMarks(book.marks, Array.from(this.markPicked)) : [];
    const chapters = tab === 'chapters' ? pickedChapters(book.chapters, this.chapPicked) : [];

    this.close();
    openWizard(this.app, {
      load: async () => {
        const sources = await resolvePick(tab === 'marks' ? 'marksKey' : 'chaptersKey', {
          bookId,
          bookTitle,
          marks,
          chapters,
          ask,
          chapterText: (i) => this.body(i),
        });
        const capped = tab === 'chapters' ? capSourcesPerChapter(sources, limit) : sources;
        return withBacklink(bookId, capped);
      },
      loadingText: tab === 'marks' ? '正在读划线，挑要加入的重点…' : '正在读这本书，挑要加入的内容…',
    });
  }

  private close(): void {
    if (this.closed) return;
    this.closed = true;
    this.closeModal?.();
  }
}
