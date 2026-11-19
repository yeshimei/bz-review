/**
 * 划线卡编辑（批 2，界面层）。
 *
 * 以前卡片内容只能「重新生成」——AI 怎么写的就怎么背。用户看到明显的错字或
 * 断句不对，唯一的办法是回去改划线再重新加卡，排期进度跟着一起丢。
 *
 * 2026-11-20 起改用 core/flow-dialog 的统一壳（与确认题面、重新生成同一套），
 * 不再单开一个 Obsidian 原生 Modal——弹窗风格从此只有一种。
 * 保存时打上 `manual` 标记（由调用方写）：之后后台自动补内容会跳过这张卡，
 * 免得刚改完就被 AI 顶掉；点「重新生成」仍然可以覆盖。
 */
import type { App } from 'obsidian';
import type { ReviewItem } from './data';
import { openFlowDialog } from '../core/flow-dialog';
import { notice } from '../core/notice';

export interface CardEditValues {
  text: string;
  comment: string;
}

export function openCardEditor(app: App, item: ReviewItem, onSave: (v: CardEditValues) => void | Promise<void>): void {
  void app;
  const card = item.card;
  if (!card) return;
  const root = createDiv();
  root.className = 'bzrv-edit-modal';

  const textField = root.createDiv({ cls: 'bzrv-edit-field' });
  textField.createDiv({ cls: 'bzrv-edit-head', text: '原文' });
  textField.createDiv({ cls: 'bzrv-edit-desc', text: '复习时看到的就是这段；改完不会再被 AI 自动改写' });
  const textArea = textField.createEl('textarea', { cls: 'bzrv-edit-area' });
  textArea.rows = 6;
  textArea.value = String(card.text ?? '');

  const ideaField = root.createDiv({ cls: 'bzrv-edit-field' });
  ideaField.createDiv({ cls: 'bzrv-edit-head', text: '我的想法' });
  ideaField.createDiv({ cls: 'bzrv-edit-desc', text: '当时为什么划这句，可选' });
  const ideaArea = ideaField.createEl('textarea', { cls: 'bzrv-edit-area' });
  ideaArea.rows = 3;
  ideaArea.value = String(card.comment ?? '');

  void openFlowDialog({
    title: '编辑这张卡',
    message: '改完点「保存」才会写回卡片；取消则一个字节不动。',
    body: root,
    actions: [
      { label: '取消', value: 'cancel' },
      { label: '保存', value: 'ok', cta: true },
    ],
  }).then((v) => {
    if (v !== 'ok') return;
    const text = textArea.value.trim();
    /* 原文清空等于把卡变成空白，复习时无从回忆——挡在保存前，并明说原因，
       不能点了「保存」静默无反应让用户以为已经写回。 */
    if (!text) {
      notice('原文不能为空，这张卡没保存。', 'warning');
      return;
    }
    void Promise.resolve(onSave({ text, comment: ideaArea.value.trim() }));
  });
}
