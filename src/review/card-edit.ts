/**
 * 划线卡编辑（批 2，界面层）。
 *
 * 以前卡片内容只能「重新生成」——AI 怎么写的就怎么背。用户看到明显的错字或
 * 断句不对，唯一的办法是回去改划线再重新加卡，排期进度跟着一起丢。
 *
 * 2026-11-19 起不再用 Obsidian 原生 Setting 排这个框：Setting 默认是
 * 「左边标题 / 右边控件」的横向 flex，手机上输入框只剩半幅宽、还挤在右侧。
 * 改成标题与说明在上、输入框在下的纵向布局，并给弹窗根挂上本插件的作用域
 * 标记，样式就能命中这里而不会漏到别的弹窗。
 *
 * 保存时打上 `manual` 标记（由调用方写）：之后后台自动补内容会跳过这张卡，
 * 免得刚改完就被 AI 顶掉；点「重新生成」仍然可以覆盖。
 */
import { Modal, type App } from 'obsidian';
import type { ReviewItem } from './data';

export interface CardEditValues {
  text: string;
  comment: string;
}

export function openCardEditor(app: App, item: ReviewItem, onSave: (v: CardEditValues) => void | Promise<void>): void {
  const card = item.card;
  if (!card) return;
  const modal = new Modal(app);
  modal.titleEl.setText('编辑这张卡');
  const root = modal.contentEl;
  root.dataset.bzrv = '';
  root.addClass('bzrv-edit-modal');

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

  const actions = root.createDiv({ cls: 'bzrv-edit-actions' });
  const cancel = actions.createEl('button', { cls: 'bzrv-btn', text: '取消' });
  cancel.addEventListener('click', () => modal.close());
  const save = actions.createEl('button', { cls: 'bzrv-btn bzrv-btn--primary', text: '保存' });
  save.addEventListener('click', () => {
    const text = textArea.value.trim();
    /* 原文清空等于把卡变成空白，复习时无从回忆——挡在保存前，不去改结构 */
    if (!text) return;
    void Promise.resolve(onSave({ text, comment: ideaArea.value.trim() })).finally(() => modal.close());
  });

  modal.open();
}
