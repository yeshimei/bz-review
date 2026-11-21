/* ============================================================
 * bz · 重新生成后的确认面板（review/card-flow.ts）
 *
 * 2026-11-21 起「选一种复习方式」只留在统一制卡流程里（card-wizard），
 * 原来这套列表式选择器整段删除——一个插件不再有第二种制卡界面。
 *
 * 这个文件现在只负责「重新生成 AI 内容」的确认：
 * 先生成草稿、摆给用户看，点「确认修改」才覆盖卡上原来的题面。
 *
 * 原「开卡前二次确认」已于 2026-11-20 整段删除：点开卡片直接进会话。
 * ============================================================ */
import { openFlowDialog } from '../core/flow-dialog';
import type { CardMode } from './card-ai';
import type { QuizQuestion } from './quiz-core/manager';
import type { ReviewItem } from './data';
import { t } from '../i18n/strings';

/* ── 两块可复用的确认面板（重新生成后用） ── */

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
  qCap.textContent = t('cardflow.front');
  const qInput = createEl('input');
  qInput.className = 'bzrv-input';
  qInput.type = 'text';
  qInput.value = String(init.question ?? '');
  qInput.placeholder = t('cardflow.frontHint');
  qLabel.appendChild(qCap);
  qLabel.appendChild(qInput);

  const tLabel = createEl('label');
  tLabel.className = 'bzrv-card-confirm-field';
  const tCap = createSpan();
  tCap.textContent = t('cardflow.back');
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
  regenBtn.textContent = t('cardflow.regenQuestion');
  body.appendChild(regenBtn);
  regenBtn.addEventListener('click', () => {
    if (!init.regenerateAsk) return;
    regenBtn.disabled = true;
    regenBtn.textContent = t('cardflow.generating');
    void init
      .regenerateAsk()
      .then((res) => {
        if (res?.q) qInput.value = res.q;
        if (res?.a) tArea.value = res.a;
      })
      .finally(() => {
        regenBtn.disabled = false;
        regenBtn.textContent = t('cardflow.regenQuestion');
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
  tip.textContent = t('cardflow.deleteHint');
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
  regenBtn.textContent = t('cardflow.regenAll');
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
      del.appendChild(Object.assign(createSpan(), { className: 'bzrv-sr-only', textContent: t('cardflow.deleteQuestion') }));
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
      empty.textContent = t('cardflow.emptyBank');
      listWrap.appendChild(empty);
    }
    removedWrap.innerHTML = '';
    if (!removed.length) return;
    const cap = createSpan();
    cap.textContent = t('cardflow.deletedPrefix');
    removedWrap.appendChild(cap);
    removed.forEach((r, i) => {
      const chip = createEl('button');
      chip.type = 'button';
      chip.className = 'bzrv-btn bzrv-btn--ghost bzrv-card-confirm-chip';
      chip.textContent = t('cardflow.restoreQuestion');
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
    regenBtn.textContent = t('cardflow.generating');
    void regenerateQuiz()
      .then((fresh) => {
        if (fresh?.length) {
          list = fresh.map((q) => ({ ...q }));
          removed.length = 0;
        }
      })
      .finally(() => {
        regenBtn.disabled = false;
        regenBtn.textContent = t('cardflow.regenAll');
        repaint();
      });
  });

  return { body, read: () => list };
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
      title: t('cardflow.confirmFront'),
      message: t('cardflow.confirmFrontDesc'),
      body: parts.body,
      actions: [
        { label: t('common.cancel'), value: 'cancel' },
        { label: t('cardflow.confirm'), value: 'ok', cta: true },
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
      title: t('cardflow.confirmBank'),
      message: t('cardflow.confirmBankDesc'),
      body: parts.body,
      actions: [
        { label: t('common.cancel'), value: 'cancel' },
        { label: t('cardflow.confirm'), value: 'ok', cta: true },
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
    tip.textContent = t('cardflow.newCloze');
    body.appendChild(tip);
    const preview = createEl('p');
    preview.className = 'bzrv-card-confirm-q';
    preview.textContent = String(opts.draft.cloze?.text ?? '').replace(/\{\{\d+\}\}/g, '（　）');
    body.appendChild(preview);
    const v = await openFlowDialog({
      title: t('cardflow.confirmFront'),
      message: t('cardflow.confirmClozeDesc'),
      body,
      actions: [
        { label: t('common.cancel'), value: 'cancel' },
        { label: t('cardflow.confirm'), value: 'ok', cta: true },
      ],
    });
    if (v !== 'ok' || !opts.draft.cloze?.blanks?.length) return { ok: false };
    return { ok: true, cloze: opts.draft.cloze };
  }

  return { ok: true };
}
