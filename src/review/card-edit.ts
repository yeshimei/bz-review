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
import { t } from '../i18n/strings';

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
  textField.createDiv({ cls: 'bzrv-edit-head', text: t('caredit.source') });
  textField.createDiv({ cls: 'bzrv-edit-desc', text: t('caredit.sourceDesc') });
  const textArea = textField.createEl('textarea', { cls: 'bzrv-edit-area' });
  textArea.rows = 6;
  textArea.value = String(card.text ?? '');

  const ideaField = root.createDiv({ cls: 'bzrv-edit-field' });
  ideaField.createDiv({ cls: 'bzrv-edit-head', text: t('caredit.thought') });
  ideaField.createDiv({ cls: 'bzrv-edit-desc', text: t('caredit.thoughtDesc') });
  const ideaArea = ideaField.createEl('textarea', { cls: 'bzrv-edit-area' });
  ideaArea.rows = 3;
  ideaArea.value = String(card.comment ?? '');

  void openFlowDialog({
    title: t('caredit.title'),
    message: t('caredit.desc'),
    body: root,
    actions: [
      { label: t('common.cancel'), value: 'cancel' },
      { label: t('common.save'), value: 'ok', cta: true },
    ],
  }).then((v) => {
    if (v !== 'ok') return;
    const text = textArea.value.trim();
    /* 原文清空等于把卡变成空白，复习时无从回忆——挡在保存前，并明说原因，
       不能点了「保存」静默无反应让用户以为已经写回。 */
    if (!text) {
      notice(t('caredit.empty'), 'warning');
      return;
    }
    void Promise.resolve(onSave({ text, comment: ideaArea.value.trim() }));
  });
}
