/**
 * 划线卡编辑（批 2，界面层）。
 *
 * 以前卡片内容只能「重新生成」——AI 怎么写的就怎么背。用户看到明显的错字或
 * 断句不对，唯一的办法是回去改划线再重新加卡，排期进度跟着一起丢。
 *
 * 用 Obsidian 自带 Modal 而不是自绘浮层：文本域、按钮、键盘可达性全部现成，
 * 也就不用为这一个弹窗再加一套样式。
 *
 * 保存时打上 `manual` 标记：之后后台自动补内容会跳过这张卡（
 * `ensureCardContent` 里判），免得刚改完就被 AI 顶掉；点「重新生成」仍然可以覆盖。
 */
import { Modal, Setting, type App } from 'obsidian';
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
  let text = String(card.text ?? '');
  let comment = String(card.comment ?? '');

  new Setting(modal.contentEl)
    .setName('原文')
    .setDesc('复习时看到的就是这段；改完不会再被 AI 自动改写')
    .addTextArea((t) => {
      t.setValue(text).onChange((v) => {
        text = v;
      });
      t.inputEl.rows = 6;
      t.inputEl.addClass('bzrv-edit-text');
    });

  new Setting(modal.contentEl)
    .setName('我的想法')
    .setDesc('当时为什么划这句，可选')
    .addTextArea((t) => {
      t.setValue(comment);
      t.inputEl.rows = 3;
      t.inputEl.addClass('bzrv-edit-text');
      t.onChange((v) => {
        comment = v;
      });
    });

  const canSave = (): boolean => text.trim().length > 0;

  new Setting(modal.contentEl)
    .addButton((b) => b.setButtonText('取消').onClick(() => modal.close()))
    .addButton((b) =>
      b
        .setButtonText('保存')
        .setCta()
        .onClick(() => {
          /* 原文清空等于把卡变成空白，复习时无从回忆——挡在保存前，不去改结构 */
          if (!canSave()) {
            return;
          }
          void Promise.resolve(onSave({ text: text.trim(), comment: comment.trim() })).finally(() => modal.close());
        })
    );

  modal.open();
}
