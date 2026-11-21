/* ============================================================
 * bz · 复习方式选择卡（review/mode-picker.ts）
 *
 * 统一制卡界面（card-wizard）与「重新生成 AI 内容」共用这一套四张卡：
 * 全文回忆 / 抽认卡 / 做题 / 挖空。以前一边是列表弹窗、一边是卡片网格，
 * 同一个插件两种制卡界面——2026-11-21 用户拍板只留一套。
 *
 * 只有一处 DOM 结构，不碰 AI、不碰设置。
 * ============================================================ */
import { uiModal } from '../core/ui/modal';
import { wizardModeMetaList, type WizardMode } from './card-wizard-model';
import { t } from '../i18n/strings';

export interface ModePickerOptions {
  /** 初始选中 */
  mode: WizardMode;
  /** 预计发给 AI 的字数（为 0 时不显示副行，全文回忆本来就不用 AI） */
  estimatedChars?: number;
  onChange?: (mode: WizardMode) => void;
}

export interface ModePickerView {
  root: HTMLElement;
  getMode(): WizardMode;
}

export function buildModePicker(opts: ModePickerOptions): ModePickerView {
  let mode: WizardMode = opts.mode;
  const chars = Math.max(0, Math.round(Number(opts.estimatedChars) || 0));
  const root = createDiv({ cls: 'bzrv-wiz-modes' });
  const cards = new Map<WizardMode, HTMLElement>();

  for (const meta of wizardModeMetaList()) {
    /* 用真按钮而不是 div：Tab 能走到、回车能选，读屏也知道这是可选项 */
    const card = root.createEl('button', { cls: 'bzrv-wiz-mode' });
    card.type = 'button';
    card.createSpan({ cls: 'bzrv-wiz-mode-name', text: meta.label });
    if (meta.value !== 'plain' && chars > 0) {
      card.createSpan({
        cls: 'bzrv-wiz-mode-sub',
        text: t('wiz.estimatedChars', { n: chars.toLocaleString('en-US') }),
      });
    }
    card.addEventListener('click', () => {
      if (mode === meta.value) return;
      mode = meta.value;
      paint();
      opts.onChange?.(mode);
    });
    cards.set(meta.value, card);
  }

  function paint(): void {
    for (const [value, el] of cards) el.classList.toggle('is-on', value === mode);
  }
  paint();

  return { root, getMode: () => mode };
}

export interface ModePickerModalOptions {
  title: string;
  /** 卡片上方的一句说明 */
  lead?: string;
  mode: WizardMode;
  estimatedChars?: number;
  ctaLabel?: string;
}

/**
 * 以弹窗形式问一次方式（「重新生成 AI 内容」用）。
 *
 * 与制卡流程同一个壳：✕ / 取消 / ESC / 点遮罩都能关，关闭即放弃本次方式选择。
 */
export function pickModeModal(opts: ModePickerModalOptions): Promise<WizardMode | null> {
  return new Promise((resolve) => {
    let settled = false;
    let close = (): void => {};

    const finish = (value: WizardMode | null): void => {
      if (settled) return;
      settled = true;
      close();
      resolve(value);
    };

    const root = createDiv({ cls: 'bzrv-wiz' });
    const head = root.createDiv({ cls: 'bzrv-wiz-head' });
    head.createDiv({ cls: 'bzrv-wiz-title', text: opts.title });
    const x = head.createEl('button', { cls: 'bzrv-wiz-x' });
    x.type = 'button';
    x.appendChild(createSpan({ cls: 'bzrv-sr-only', text: '关闭' }));
    x.createSpan({ text: '✕' });
    x.addEventListener('click', () => finish(null));

    const body = root.createDiv({ cls: 'bzrv-wiz-body' });
    if (opts.lead) body.createEl('p', { cls: 'bzrv-wiz-lead', text: opts.lead });
    const picker = buildModePicker({ mode: opts.mode, estimatedChars: opts.estimatedChars });
    body.appendChild(picker.root);

    const foot = root.createDiv({ cls: 'bzrv-wiz-foot' });
    const cancel = foot.createEl('button', { cls: 'bzrv-wiz-btn', text: '取消' });
    cancel.type = 'button';
    cancel.addEventListener('click', () => finish(null));
    const ok = foot.createEl('button', { cls: 'bzrv-wiz-btn is-cta', text: opts.ctaLabel || '下一步' });
    ok.type = 'button';
    ok.addEventListener('click', () => finish(picker.getMode()));

    const modal = uiModal({
      content: root,
      size: 'lg',
      className: 'bzrv-wiz-popup',
      head: false,
      onClose: () => {
        if (settled) return;
        settled = true;
        resolve(null);
      },
    });
    close = modal.close;
  });
}
