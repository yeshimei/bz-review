/* ============================================================
 * bz · 制卡与开卡两道流程界面（review/card-flow.ts）
 *
 * 用户 2026-11-15 的两条口径，落成两个流程框：
 *
 *   一、**制卡方式选择**（加入复习计划那一刻）
 *       默认每次问「这段内容做成哪种卡」；勾了「记住」或设置里选了具体方式，
 *       以后不再问。选出来的方式写进 `ReviewCard.mode`，复习时就按它走。
 *
 *   二、**开卡前二次确认**（点开一张卡、真正开始复习之前）
 *       抽认卡在这里能改问句和原文；做题卡在这里能一条条删题（删错了当场能
 *       点回去补）、能「重新生成」整份题库。设置里可以整体关掉（默认开）。
 *
 * 2026-11-19 起第三个用途：**重新生成后的确认**。右键「重新生成 AI 内容」
 * 不再直接覆盖——先生成草稿，用同一套确认面板给用户看，确认后才替换。
 * 三处共用同一个壳（core/flow-dialog）与同一套面板，别各写一份。
 * ============================================================ */
import { openFlowDialog } from '../core/flow-dialog';
import { CARD_MODE_LABELS } from './card-mode-meta';
export { CARD_MODE_LABELS, cardModeLabel } from './card-mode-meta';
import type { CardMode } from './card-ai';
import type { QuizQuestion } from './quiz-core/manager';
import type { ReviewItem } from './data';

/**
 * 开卡前确认只对做题卡有意义：删题要在开始前做完。
 *
 * 抽认卡 2026-11-19 改回最朴素的形态——正面一句话，点「看答案」出背面原文。
 * 「看一遍再开始」那道确认框整段撤掉，问句不满意请到卡片管理器里改或重新生成。
 */
export function needsCardConfirm(mode: CardMode): boolean {
  return mode === 'quiz';
}

/** 制卡方式选择的结果：方式 + 是否要「以后别再问」 */
export interface PickCardMethodResult {
  mode: CardMode;
  /** 勾了「记住」= 写进设置当默认方式，之后不再弹这个框 */
  remember: boolean;
}

/**
 * 让用户选一种制卡方式。
 *
 * 取消（遮罩 / ESC / 「先不建」）返回 **null**，调用方据此什么都不做——
 * 不能把取消当成「用默认方式继续」，那会凭空给用户加一张他没要的卡。
 */
export async function pickCardMethod(purpose: 'add' | 'regenerate' = 'add'): Promise<PickCardMethodResult | null> {
  /* 勾选框只属于「加入」：重新生成是一次性动作，没有「以后别问」这回事。 */
  const regenerating = purpose === 'regenerate';
  const body = createDiv();
  body.className = 'bzrv-card-method';

  const list = createDiv();
  list.className = 'bzrv-card-method-list';
  for (const m of CARD_MODE_LABELS) {
    const row = createDiv();
    row.className = 'bzrv-card-method-row';
    const name = createEl('b');
    name.textContent = m.label;
    const hint = createSpan();
    hint.textContent = m.hint;
    row.appendChild(name);
    row.appendChild(hint);
    list.appendChild(row);
  }
  body.appendChild(list);

  let remember = false;
  if (!regenerating) {
    const rememberWrap = createEl('label');
    rememberWrap.className = 'bzrv-card-method-remember';
    const rememberBox = createEl('input');
    rememberBox.type = 'checkbox';
    const rememberText = createSpan();
    rememberText.textContent = '记住这个选择，以后加卡不再问';
    rememberWrap.appendChild(rememberBox);
    rememberWrap.appendChild(rememberText);
    body.appendChild(rememberWrap);
    remember = rememberBox.checked;
  }

  const actions = [
    { label: regenerating ? '取消' : '先不建', value: 'cancel' },
    ...CARD_MODE_LABELS.map((m) => ({ label: m.label, value: m.value })),
  ];

  const picked = await openFlowDialog({
    title: regenerating ? '重新生成用哪种方式？' : '这段内容做成哪种卡？',
    message: regenerating
      ? '选一种方式重新生成题面；原卡不会动，直到你点「确认修改」。'
      : '选一种制卡方式；复习时这张卡就按它走。',
    body,
    actions,
  });

  if (!picked || picked === 'cancel') return null;
  const mode = CARD_MODE_LABELS.find((m) => m.value === picked)?.value;
  if (!mode) return null;
  if (!regenerating && body.querySelector('input') instanceof HTMLInputElement) {
    remember = (body.querySelector('input') as HTMLInputElement).checked;
  }
  return { mode, remember };
}

/** 开卡前确认框的产物 */
export interface CardConfirmResult {
  /** false = 用户取消（不开始、什么都不改） */
  go: boolean;
  /** 抽认卡：改过的原文 / 问句（没改就是原值） */
  text?: string;
  question?: string;
  /** 做题卡：删剩下的题库（删光了就没法开始，调用方据此拦住） */
  questions?: QuizQuestion[];
}

export interface CardConfirmOpts {
  item: ReviewItem;
  mode: CardMode;
  /** 做题卡：当前题库（抽认卡不传） */
  questions?: QuizQuestion[];
  /** 点「重新生成」时重新拉一份题库（只有做题卡用） */
  regenerateQuiz?: () => Promise<QuizQuestion[] | null>;
  /** 点「重新生成」时重新问一次模型要问句（只有抽认卡用） */
  regenerateAsk?: () => Promise<{ q: string; a: string } | null>;
}

/* ── 两块可复用的确认面板（开卡前 / 重新生成后共用同一套） ── */

interface FlashcardParts {
  body: HTMLElement;
  read: () => { text: string; question: string };
}

/** 抽认卡面板：问句 + 原文，外加一颗「重新生成问句」 */
function buildFlashcardParts(init: {
  text: string;
  question: string;
  regenerateAsk?: () => Promise<{ q: string; a: string } | null>;
}): FlashcardParts {
  const body = createDiv();
  body.className = 'bzrv-card-confirm';

  const qLabel = createEl('label');
  qLabel.className = 'bzrv-card-confirm-field';
  const qCap = createSpan();
  qCap.textContent = '提示面（问句）';
  const qInput = createEl('input');
  qInput.className = 'bzrv-input';
  qInput.type = 'text';
  qInput.value = String(init.question ?? '');
  qInput.placeholder = '留空则开始前现场生成一句';
  qLabel.appendChild(qCap);
  qLabel.appendChild(qInput);

  const tLabel = createEl('label');
  tLabel.className = 'bzrv-card-confirm-field';
  const tCap = createSpan();
  tCap.textContent = '原文（背面）';
  const tArea = createEl('textarea');
  tArea.className = 'bzrv-input';
  tArea.rows = 4;
  tArea.value = String(init.text ?? '');
  tLabel.appendChild(tCap);
  tLabel.appendChild(tArea);

  body.appendChild(qLabel);
  body.appendChild(tLabel);

  /* 「重新生成」：抽认卡的内容不满意就当场再要一句，不必退回队列再点一次右键。
     生成结果只填进输入框——用户点「取消」时卡上什么都不变。 */
  const regenBtn = createEl('button');
  regenBtn.type = 'button';
  regenBtn.className = 'bzrv-btn bzrv-btn--ghost';
  regenBtn.textContent = '重新生成问句';
  body.appendChild(regenBtn);
  regenBtn.addEventListener('click', () => {
    if (!init.regenerateAsk) return;
    regenBtn.disabled = true;
    regenBtn.textContent = '正在生成…';
    void init
      .regenerateAsk()
      .then((res) => {
        if (res?.q) qInput.value = res.q;
        if (res?.a) tArea.value = res.a;
      })
      .finally(() => {
        regenBtn.disabled = false;
        regenBtn.textContent = '重新生成问句';
      });
  });

  return { body, read: () => ({ text: tArea.value, question: qInput.value.trim() }) };
}

interface QuizParts {
  body: HTMLElement;
  read: () => QuizQuestion[];
}

/** 做题面板：逐题删/补回，外加重整份题库 */
function buildQuizParts(
  initial: QuizQuestion[],
  regenerateQuiz?: () => Promise<QuizQuestion[] | null>,
): QuizParts {
  /* 深拷贝：删除只在框里生效，点「取消」时库里的题一道不少 */
  let list: QuizQuestion[] = (initial ?? []).map((q) => ({ ...q }));
  const removed: Array<{ q: QuizQuestion; at: number }> = [];

  const body = createDiv();
  body.className = 'bzrv-card-confirm';

  const tip = createEl('p');
  tip.className = 'bzrv-card-confirm-tip';
  tip.textContent = '删掉不想要的题；删掉的会收到下面一行，点一下就能放回去。';
  body.appendChild(tip);

  const listWrap = createDiv();
  listWrap.className = 'bzrv-card-confirm-list';
  body.appendChild(listWrap);

  const removedWrap = createDiv();
  removedWrap.className = 'bzrv-card-confirm-removed';
  body.appendChild(removedWrap);

  const regenBtn = createEl('button');
  regenBtn.type = 'button';
  regenBtn.className = 'bzrv-btn bzrv-btn--ghost';
  regenBtn.textContent = '重新生成整份题库';
  body.appendChild(regenBtn);

  const repaint = (): void => {
    listWrap.innerHTML = '';
    list.forEach((q, i) => {
      const row = createDiv();
      row.className = 'bzrv-card-confirm-row';
      const n = createSpan();
      n.className = 'bzrv-card-confirm-i';
      n.textContent = `${i + 1}`;
      const txt = createSpan();
      txt.className = 'bzrv-card-confirm-q';
      txt.textContent = q.question;
      const del = createEl('button');
      del.type = 'button';
      del.className = 'bzrv-icon-btn';
      del.textContent = '✕';
      del.appendChild(Object.assign(createSpan(), { className: 'bzrv-sr-only', textContent: '删掉这道题' }));
      del.addEventListener('click', () => {
        removed.push({ q, at: Date.now() });
        list = list.filter((x) => x !== q);
        repaint();
      });
      row.appendChild(n);
      row.appendChild(txt);
      row.appendChild(del);
      listWrap.appendChild(row);
    });
    if (!list.length) {
      const empty = createEl('p');
      empty.className = 'bzrv-card-confirm-tip';
      empty.textContent = '题库空了：要么点下面的「重新生成」，要么把删掉的放回去。';
      listWrap.appendChild(empty);
    }
    removedWrap.innerHTML = '';
    if (!removed.length) return;
    const cap = createSpan();
    cap.textContent = '已删：';
    removedWrap.appendChild(cap);
    removed.forEach((r, i) => {
      const chip = createEl('button');
      chip.type = 'button';
      chip.className = 'bzrv-btn bzrv-btn--ghost bzrv-card-confirm-chip';
      chip.textContent = '补回这题';
      chip.appendChild(Object.assign(createSpan(), { className: 'bzrv-sr-only', textContent: r.q.question }));
      chip.addEventListener('click', () => {
        list.splice(Math.min(i, list.length), 0, r.q);
        removed.splice(i, 1);
        repaint();
      });
      removedWrap.appendChild(chip);
    });
  };
  repaint();

  regenBtn.addEventListener('click', () => {
    if (!regenerateQuiz) return;
    regenBtn.disabled = true;
    regenBtn.textContent = '正在生成…';
    void regenerateQuiz()
      .then((fresh) => {
        if (fresh?.length) {
          list = fresh.map((q) => ({ ...q }));
          removed.length = 0;
        }
      })
      .finally(() => {
        regenBtn.disabled = false;
        regenBtn.textContent = '重新生成整份题库';
        repaint();
      });
  });

  return { body, read: () => list };
}

/**
 * 开卡前的二次确认。
 *
 * 抽认卡：可改问句与原文（改完落盘并打 manual，后台不再覆盖）。
 * 做题卡：可一条条删题，删掉的进「已删」区，当场能点回去补；也能重新生成。
 * 其余方式没有可改的东西，直接开始（不弹空框）。
 */
export async function confirmBeforeRound(opts: CardConfirmOpts): Promise<CardConfirmResult> {
  const { item, mode } = opts;
  const card = item.card!;

  /* 抽认卡 / 填空 / 上下文 / 全文回忆：直接开卡，不拦一道确认框。 */
  if (!needsCardConfirm(mode)) return { go: true };

  if (mode === 'flashcard') {
    const parts = buildFlashcardParts({
      text: String(card.text ?? ''),
      question: String(card.qa?.q ?? ''),
      regenerateAsk: opts.regenerateAsk,
    });
    const v = await openFlowDialog({
      title: '看一遍再开始',
      message: '这张抽认卡的内容可以直接改；改过的卡以后不会被 AI 自动覆盖。',
      body: parts.body,
      actions: [
        { label: '取消', value: 'cancel' },
        { label: '开始复习', value: 'ok', cta: true },
      ],
    });
    if (v !== 'ok') return { go: false };
    const read = parts.read();
    return { go: true, text: read.text, question: read.question };
  }

  if (mode === 'quiz') {
    const parts = buildQuizParts(opts.questions ?? [], opts.regenerateQuiz);
    const v = await openFlowDialog({
      title: '这一轮的题',
      message: '做题卡可以先把不想要的题删掉，再开始复习。',
      body: parts.body,
      actions: [
        { label: '取消', value: 'cancel' },
        { label: '开始复习', value: 'ok', cta: true },
      ],
    });
    if (v !== 'ok') return { go: false };
    return { go: true, questions: parts.read() };
  }

  // 填空 / 上下文 / 展开全文：没有值得改的东西，别弹空框
  return { go: true };
}

/* ============================================================
 * 重新生成后的确认（2026-11-19）
 * ============================================================ */

/** 重新生成草稿（与 card-ai 的 CardContentDraft 同形，这里只用到题面部分） */
export interface RegenerateDraftView {
  qa?: { q: string; a: string };
  cloze?: { text: string; blanks: string[] };
  questions?: QuizQuestion[];
}

/** 确认页产物：ok=false 什么都不改；ok=true 时按方式给出替换内容 */
export interface RegenerateConfirmResult {
  ok: boolean;
  qa?: { q: string; a: string };
  cloze?: { text: string; blanks: string[] };
  questions?: QuizQuestion[];
}

/**
 * 把新生成的一版摆给用户看，确认后才替换。
 *
 * 抽认卡/做题卡直接用开卡前那两块面板（同一套删题、改问句），填空卡给一段
 * 挖空预览；展开全文/上下文没有可替换的题面，调用方本来就不会走到这里。
 */
export async function confirmRegenerated(opts: {
  item: ReviewItem;
  mode: CardMode;
  draft: RegenerateDraftView;
  /** 面板里再点一次「重新生成」 */
  regenerate?: () => Promise<RegenerateDraftView | null>;
}): Promise<RegenerateConfirmResult> {
  const card = opts.item.card!;
  const mode: CardMode = opts.mode === 'plain' ? 'flashcard' : opts.mode;

  if (mode === 'flashcard') {
    const parts = buildFlashcardParts({
      text: String(card.text ?? ''),
      question: String(opts.draft.qa?.q ?? card.qa?.q ?? ''),
      regenerateAsk: opts.regenerate
        ? async () => {
            const d = await opts.regenerate!();
            return d?.qa ?? null;
          }
        : undefined,
    });
    const v = await openFlowDialog({
      title: '确认修改题面',
      message: '这是按你选的方式新生成的一版；点「确认修改」才会覆盖卡上原来的题面。',
      body: parts.body,
      actions: [
        { label: '取消', value: 'cancel' },
        { label: '确认修改', value: 'ok', cta: true },
      ],
    });
    if (v !== 'ok') return { ok: false };
    const read = parts.read();
    if (!read.question) return { ok: false };
    return { ok: true, qa: { q: read.question, a: read.text } };
  }

  if (mode === 'quiz') {
    const parts = buildQuizParts(opts.draft.questions ?? [], opts.regenerate
      ? async () => {
          const d = await opts.regenerate!();
          return d?.questions ?? null;
        }
      : undefined);
    const v = await openFlowDialog({
      title: '确认修改题库',
      message: '这是按你选的方式新生成的一版；点「确认修改」才会覆盖卡上原来的题库。',
      body: parts.body,
      actions: [
        { label: '取消', value: 'cancel' },
        { label: '确认修改', value: 'ok', cta: true },
      ],
    });
    if (v !== 'ok') return { ok: false };
    const questions = parts.read();
    if (!questions.length) return { ok: false };
    return { ok: true, questions };
  }

  if (mode === 'cloze') {
    const body = createDiv();
    body.className = 'bzrv-card-confirm';
    const tip = createEl('p');
    tip.className = 'bzrv-card-confirm-tip';
    tip.textContent = '新生成的一版（空位会在复习时挖出来）：';
    body.appendChild(tip);
    const preview = createEl('p');
    preview.className = 'bzrv-card-confirm-q';
    preview.textContent = String(opts.draft.cloze?.text ?? '').replace(/\{\{\d+\}\}/g, '（　）');
    body.appendChild(preview);
    const v = await openFlowDialog({
      title: '确认修改题面',
      message: '点「确认修改」才会覆盖卡上原来的挖空。',
      body,
      actions: [
        { label: '取消', value: 'cancel' },
        { label: '确认修改', value: 'ok', cta: true },
      ],
    });
    if (v !== 'ok' || !opts.draft.cloze?.blanks?.length) return { ok: false };
    return { ok: true, cloze: opts.draft.cloze };
  }

  return { ok: true };
}
