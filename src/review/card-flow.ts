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
 * 两个框都走 `core/flow-dialog`（同一个壳、同一套 ESC / 遮罩 / 焦点圈闭），
 * 不再各写一套弹窗——壳子只有一份，长得一样，关法也一样。
 * ============================================================ */
import { openFlowDialog } from '../core/flow-dialog';
import type { CardMode } from './card-ai';
import type { QuizQuestion } from './quiz-core/manager';
import type { ReviewItem } from './data';

/** 五种方式在界面上的名字（顺序＝复习时的推荐顺序） */
export const CARD_MODE_LABELS: ReadonlyArray<{ value: CardMode; label: string; hint: string }> = [
  { value: 'flashcard', label: 'AI 抽认卡', hint: '先给一句不能照抄原文的问句，想不起来再看原文' },
  { value: 'quiz', label: 'AI 做题', hint: '按内容生成四选一，每轮只抽其中一部分' },
  { value: 'cloze', label: 'AI 填空', hint: '把关键短语挖掉，自己填回去' },
  { value: 'context', label: '上下文', hint: '只给前后几句，回忆被藏起来的那段' },
  { value: 'plain', label: '展开全文', hint: '不调用 AI，直接摆出原文，自己评难度' },
];

/** 一句人话的名字：设置页与提示都用它 */
export function cardModeLabel(mode: CardMode): string {
  return CARD_MODE_LABELS.find((m) => m.value === mode)?.label ?? mode;
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
export async function pickCardMethod(): Promise<PickCardMethodResult | null> {
  /* 勾选框放进富正文，动作按钮只留「先不建」+ 五种方式：取消必须是显式一个动作，
     否则用户点遮罩就走，事后不知道自己刚才做了什么。 */
  const body = document.createElement('div');
  body.className = 'bzrv-card-method';

  const list = document.createElement('div');
  list.className = 'bzrv-card-method-list';
  for (const m of CARD_MODE_LABELS) {
    const row = document.createElement('div');
    row.className = 'bzrv-card-method-row';
    const name = document.createElement('b');
    name.textContent = m.label;
    const hint = document.createElement('span');
    hint.textContent = m.hint;
    row.appendChild(name);
    row.appendChild(hint);
    list.appendChild(row);
  }
  body.appendChild(list);

  const rememberWrap = document.createElement('label');
  rememberWrap.className = 'bzrv-card-method-remember';
  const rememberBox = document.createElement('input');
  rememberBox.type = 'checkbox';
  const rememberText = document.createElement('span');
  rememberText.textContent = '记住这个选择，以后加卡不再问';
  rememberWrap.appendChild(rememberBox);
  rememberWrap.appendChild(rememberText);
  body.appendChild(rememberWrap);

  const actions = [
    { label: '先不建', value: 'cancel' },
    ...CARD_MODE_LABELS.map((m) => ({ label: m.label, value: m.value })),
  ];

  const picked = await openFlowDialog({
    title: '这段内容做成哪种卡？',
    message: '选一种制卡方式；复习时这张卡就按它走。',
    body,
    actions,
  });

  if (!picked || picked === 'cancel') return null;
  const mode = CARD_MODE_LABELS.find((m) => m.value === picked)?.value;
  if (!mode) return null;
  return { mode, remember: rememberBox.checked };
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

  if (mode === 'flashcard') {
    const body = document.createElement('div');
    body.className = 'bzrv-card-confirm';

    const qLabel = document.createElement('label');
    qLabel.className = 'bzrv-card-confirm-field';
    const qCap = document.createElement('span');
    qCap.textContent = '提示面（问句）';
    const qInput = document.createElement('input');
    qInput.className = 'bzrv-input';
    qInput.type = 'text';
    qInput.value = String(card.qa?.q ?? '');
    qInput.placeholder = '留空则开始前现场生成一句';
    qLabel.appendChild(qCap);
    qLabel.appendChild(qInput);

    const tLabel = document.createElement('label');
    tLabel.className = 'bzrv-card-confirm-field';
    const tCap = document.createElement('span');
    tCap.textContent = '原文（背面）';
    const tArea = document.createElement('textarea');
    tArea.className = 'bzrv-input';
    tArea.rows = 4;
    tArea.value = String(card.text ?? '');
    tLabel.appendChild(tCap);
    tLabel.appendChild(tArea);

    body.appendChild(qLabel);
    body.appendChild(tLabel);

    /* 「重新生成」：抽认卡的内容不满意就当场再要一句，不必退回队列再点一次右键。
       生成结果只填进输入框——用户点「取消」时卡上什么都不变。 */
    const regenBtn = document.createElement('button');
    regenBtn.type = 'button';
    regenBtn.className = 'bzrv-btn bzrv-btn--ghost';
    regenBtn.textContent = '重新生成问句';
    body.appendChild(regenBtn);
    regenBtn.addEventListener('click', () => {
      if (!opts.regenerateAsk) return;
      regenBtn.disabled = true;
      regenBtn.textContent = '正在生成…';
      void opts
        .regenerateAsk()
        .then((res) => {
          if (res?.q) qInput.value = res.q;
        })
        .finally(() => {
          regenBtn.disabled = false;
          regenBtn.textContent = '重新生成问句';
        });
    });

    const v = await openFlowDialog({
      title: '看一遍再开始',
      message: '这张抽认卡的内容可以直接改；改过的卡以后不会被 AI 自动覆盖。',
      body,
      actions: [
        { label: '取消', value: 'cancel' },
        { label: '开始复习', value: 'ok', cta: true },
      ],
    });
    if (v !== 'ok') return { go: false };
    return { go: true, text: tArea.value, question: qInput.value.trim() };
  }

  if (mode === 'quiz') {
    /* 深拷贝：删除只在框里生效，点「取消」时库里的题一道不少 */
    let list: QuizQuestion[] = (opts.questions ?? []).map((q) => ({ ...q }));
    const removed: Array<{ q: QuizQuestion; at: number }> = [];

    const body = document.createElement('div');
    body.className = 'bzrv-card-confirm';

    const tip = document.createElement('p');
    tip.className = 'bzrv-card-confirm-tip';
    tip.textContent = '删掉不想要的题；删掉的会收到下面一行，点一下就能放回去。';
    body.appendChild(tip);

    const listWrap = document.createElement('div');
    listWrap.className = 'bzrv-card-confirm-list';
    body.appendChild(listWrap);

    const removedWrap = document.createElement('div');
    removedWrap.className = 'bzrv-card-confirm-removed';
    body.appendChild(removedWrap);

    const regenBtn = document.createElement('button');
    regenBtn.type = 'button';
    regenBtn.className = 'bzrv-btn bzrv-btn--ghost';
    regenBtn.textContent = '重新生成整份题库';
    body.appendChild(regenBtn);

    const repaint = (): void => {
      listWrap.innerHTML = '';
      list.forEach((q, i) => {
        const row = document.createElement('div');
        row.className = 'bzrv-card-confirm-row';
        const n = document.createElement('span');
        n.className = 'bzrv-card-confirm-i';
        n.textContent = `${i + 1}`;
        const txt = document.createElement('span');
        txt.className = 'bzrv-card-confirm-q';
        txt.textContent = q.question;
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'bzrv-icon-btn';
        del.textContent = '✕';
        del.appendChild(Object.assign(document.createElement('span'), { className: 'bzrv-sr-only', textContent: '删掉这道题' }));
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
        const empty = document.createElement('p');
        empty.className = 'bzrv-card-confirm-tip';
        empty.textContent = '题库空了：要么点下面的「重新生成」，要么把删掉的放回去。';
        listWrap.appendChild(empty);
      }
      removedWrap.innerHTML = '';
      if (!removed.length) return;
      const cap = document.createElement('span');
      cap.textContent = '已删：';
      removedWrap.appendChild(cap);
      removed.forEach((r, i) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'bzrv-btn bzrv-btn--ghost bzrv-card-confirm-chip';
        chip.textContent = '补回这题';
        chip.appendChild(Object.assign(document.createElement('span'), { className: 'bzrv-sr-only', textContent: r.q.question }));
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
      if (!opts.regenerateQuiz) return;
      regenBtn.disabled = true;
      regenBtn.textContent = '正在生成…';
      void opts
        .regenerateQuiz()
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

    const v = await openFlowDialog({
      title: '这一轮的题',
      message: '做题卡可以先把不想要的题删掉，再开始复习。',
      body,
      actions: [
        { label: '取消', value: 'cancel' },
        { label: '开始复习', value: 'ok', cta: true },
      ],
    });
    if (v !== 'ok') return { go: false };
    return { go: true, questions: list };
  }

  // 填空 / 上下文 / 展开全文：没有值得改的东西，别弹空框
  return { go: true };
}
