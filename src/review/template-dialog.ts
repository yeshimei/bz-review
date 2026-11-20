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

  const frontBoxes = makeSide('正面显示（复习时先看）', tpl?.front ?? ['question']);
  const backBoxes = makeSide('背面显示（点「看答案」后）', tpl?.back ?? ['text', 'comment']);

  const hint = root.createDiv({ cls: 'bzrv-edit-desc' });
  hint.textContent = '只勾这张卡确实有内容的字段；留空的字段不会显示。清空两边即恢复默认抽认卡。';

  void openFlowDialog({
    title: '自定义卡片模板',
    message: '只改这张卡的正反面字段，复习排期不动。',
    body: root,
    actions: [
      { label: '取消', value: 'cancel' },
      { label: '保存', value: 'ok', cta: true },
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
      notice('正面和背面都要至少勾一个这张卡有内容的字段（比如原文、问句、想法）', 'warning');
      return;
    }
    void Promise.resolve(onSave(next));
  });
}
