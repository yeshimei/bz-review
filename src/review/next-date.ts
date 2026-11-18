/**
 * 手动指定下次复习日期（批 3，界面层）。
 *
 * 「明天要考试，今晚想再过一遍」「这本书明天还」，这些都是排期管不到的情况。
 * 排期是算出来的，人总有临时安排；给一个直接改日期的入口，比让用户去改系统时间体面。
 */
import { Modal, Setting, type App, type TFile } from 'obsidian';
import { notice } from '../core/notice';
import { reviewApp } from './app';

function toDateInput(iso?: string | null): string {
  const d = iso ? new Date(iso) : new Date(Date.now() + 86400000);
  const base = Number.isFinite(d.getTime()) ? d : new Date(Date.now() + 86400000);
  const mm = String(base.getMonth() + 1).padStart(2, '0');
  const dd = String(base.getDate()).padStart(2, '0');
  return `${base.getFullYear()}-${mm}-${dd}`;
}

export async function openNextDateDialog(app: App, file: TFile | null): Promise<void> {
  if (!file) {
    notice('先打开一篇笔记', 'warning');
    return;
  }
  reviewApp.ensure(app);
  const items = await reviewApp.dataManager!.loadItems();
  const item = items.find((i) => i.filePath === file.path);
  if (!item) {
    notice('这篇不在复习计划里，先加入计划', 'warning');
    return;
  }
  const modal = new Modal(app);
  modal.titleEl.setText('下次什么时候复习');
  let value = toDateInput(item.nextReviewDate);
  new Setting(modal.contentEl)
    .setName('日期')
    .setDesc('填 yyyy-mm-dd；到那天会进「今天」列。想今晚再看就填今天。')
    .addText((t) => {
      t.setValue(value).onChange((v) => {
        value = v;
      });
      t.inputEl.type = 'date';
      t.inputEl.value = value;
      t.onChange(() => undefined);
    });
  new Setting(modal.contentEl)
    .addButton((b) => b.setButtonText('取消').onClick(() => modal.close()))
    .addButton((b) =>
      b
        .setButtonText('保存')
        .setCta()
        .onClick(async () => {
          /* 时间定在当天 09:00：太早会把人堵在半夜，太晚则当天上午看不到它 */
          const at = new Date(`${value}T09:00:00`);
          if (!Number.isFinite(at.getTime())) {
            notice('日期看不懂，按 2026-11-20 这样填', 'warning');
            return;
          }
          const ok = await reviewApp.dataManager!.setNextReview(file.path, at.toISOString());
          notice(ok ? `已安排到 ${value}` : '这一条已经不在了', ok ? 'success' : 'warning');
          modal.close();
          void reviewApp.refreshPanel();
        })
    );
  modal.open();
}
