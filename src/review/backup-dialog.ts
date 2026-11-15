/**
 * 恢复备份的弹窗（批 4，界面层）。
 *
 * 输入框默认填最近一份备份，下面列出候选文件：让用户手打完整路径是最容易出错的一步，
 * 而恢复又是个一旦点错就覆盖数据的动作。
 */
import { Modal, Setting, type App } from 'obsidian';
import { notice } from '../core/notice';
import { reviewApp } from './app';
import { exportDir, listBackupFiles, restoreBackupFile } from './backup-io';

export async function openRestoreDialog(app: App): Promise<void> {
  const files = await listBackupFiles(app);
  const latest = files.find((f) => f.toLowerCase().endsWith('.json'));
  if (!files.length) {
    notice(`还没有备份文件（默认在 ${exportDir()}）`, 'warning');
    return;
  }
  const modal = new Modal(app);
  modal.titleEl.setText('从备份恢复');
  let path = latest || files[0];
  const picks = files.slice(0, 5).map((f) => f.slice(f.lastIndexOf('/') + 1));

  new Setting(modal.contentEl)
    .setName('备份文件')
    .setDesc(`最近的备份：${picks.join('、')}${files.length > picks.length ? ' …' : ''}`)
    .addText((t) => {
      t.setValue(path).onChange((v) => {
        path = v.trim();
      });
      t.inputEl.style.minWidth = '22em';
    });

  new Setting(modal.contentEl)
    .setDesc('恢复会用备份里的数据整体覆盖当前计划；覆盖前会自动留一份快照，反悔可从设置的回滚拿回来。')
    .addButton((b) => b.setButtonText('取消').onClick(() => modal.close()))
    .addButton((b) =>
      b
        .setButtonText('恢复')
        .setCta()
        .onClick(async () => {
          reviewApp.ensure(app);
          const res = await restoreBackupFile(app, path, reviewApp.dataManager!);
          notice(res.message, res.ok ? 'success' : 'warning');
          if (res.ok) {
            modal.close();
            void reviewApp.refreshPanel();
          }
        })
    );
  modal.open();
}
