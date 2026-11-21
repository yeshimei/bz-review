/**
 * 自定义卡片模板的编辑弹窗（2026-11-20）。
 *
 * 受限字段模板：用户勾选正面/背面各显示哪些预定义字段，不开放手写 HTML/CSS——
 * 手写会引入注入面、手机排版不可控，还会冲垮插件的样式作用域。字段按预定义顺序渲染。
 */
import type { App } from 'obsidian';
import type { ReviewCard } from './data';
import { openFlowDialog } from '../core/flow-dialog';
import { notice } from '../core/notice';
import { TEMPLATE_FIELDS, fieldValue, normalizeTemplate, type CardTemplate, type TemplateField } from './card-template';
import { t } from '../i18n';

/** 打开模板编辑弹窗；onSave 由调用方落盘（dataManager.updateCardTemplate） */
export function openTemplateEditor(
  app: App,
  card: ReviewCard,
  onSave: (tpl: CardTemplate | null) => void | Promise<void>
): void {
  void app;
  const root = createDiv();
  root.className = 'bzrv-edit-modal';
  const tpl = normalizeTemplate(card.template as never);

  const makeSide = (title: string, selected: readonly string[]): Map<TemplateField, HTMLInputElement> => {
    const field = root.createDiv({ cls: 'bzrv-edit-field' });
    field.createDiv({ cls: 'bzrv-edit-head', text: title });
    const boxes = new Map<TemplateField, HTMLInputElement>();
    for (const f of TEMPLATE_FIELDS) {
      const label = createEl('label');
      label.className = 'bzrv-tpl-opt';
      const box = label.createEl('input');
      box.type = 'checkbox';
      box.checked = selected.includes(f.key);
      const text = createSpan();
      text.textContent = f.label;
      label.appendChild(text);
      field.appendChild(label);
      boxes.set(f.key, box);
    }
    return boxes;
  };

  const frontBoxes = makeSide(t('template.front'), tpl?.front ?? ['question']);
  const backBoxes = makeSide(t('template.back'), tpl?.back ?? ['text', 'comment']);

  const hint = root.createDiv({ cls: 'bzrv-edit-desc' });
  hint.textContent = t('template.hint');

  void openFlowDialog({
    title: t('template.title'),
    message: t('template.desc'),
    body: root,
    actions: [
      { label: t('common.cancel'), value: 'cancel' },
      { label: t('common.save'), value: 'ok', cta: true },
    ],
  }).then((v) => {
    if (v !== 'ok') return;
    const front = TEMPLATE_FIELDS.filter((f) => frontBoxes.get(f.key)?.checked).map((f) => f.key);
    const back = TEMPLATE_FIELDS.filter((f) => backBoxes.get(f.key)?.checked).map((f) => f.key);
    const next = normalizeTemplate({ front, back });
    if (!next) {
      void Promise.resolve(onSave(null));
      return;
    }
    /* 两面都得有内容，否则复习时一面空白没法用 */
    if (!front.some((k) => fieldValue(card, k)) || !back.some((k) => fieldValue(card, k))) {
      notice(t('template.errBoth'), 'warning');
      return;
    }
    void Promise.resolve(onSave(next));
  });
}
