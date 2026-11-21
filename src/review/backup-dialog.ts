/**
 * 恢复备份的弹窗（批 4，界面层）。
 *
 * 输入框默认填最近一份备份，下面列出候选文件：让用户手打完整路径是最容易出错的一步，
 * 而恢复又是个一旦点错就覆盖数据的动作。
 * 2026-11-20 起统一走 core/flow-dialog，不再单开原生 Modal。
 */
import type { App } from 'obsidian';
import { notice } from '../core/notice';
import { reviewApp } from './app';
import { exportDir, listBackupFiles, restoreBackupFile } from './backup-io';
import { openFlowDialog } from '../core/flow-dialog';
import { t } from '../i18n/strings';

export async function openRestoreDialog(app: App): Promise<void> {
  const files = await listBackupFiles(app);
  const latest = files.find((f) => f.toLowerCase().endsWith('.json'));
  if (!files.length) {
    notice(t('bk.noFiles', { dir: exportDir() }), 'warning');
    return;
  }
  const body = createDiv();
  const field = body.createDiv({ cls: 'bzrv-edit-field' });
  field.createDiv({ cls: 'bzrv-edit-head', text: t('bk.file') });
  const picks = files.slice(0, 5).map((f) => f.slice(f.lastIndexOf('/') + 1));
  field.createDiv({
    cls: 'bzrv-edit-desc',
    text: t('bk.recent', { list: picks.join(', '), more: files.length > picks.length ? ' …' : '' }),
  });
  const input = field.createEl('input');
  input.type = 'text';
  input.value = latest || files[0];
  body.createDiv({
    cls: 'bzrv-edit-desc',
    text: t('bk.restoreDesc'),
  });

  const v = await openFlowDialog({
    title: t('bk.restoreTitle'),
    message: '',
    body,
    actions: [
      { label: t('common.cancel'), value: 'cancel' },
      { label: t('bk.restore'), value: 'ok', cta: true },
    ],
  });
  if (v !== 'ok') return;
  reviewApp.ensure(app);
  const res = await restoreBackupFile(app, input.value.trim());
  notice(res.message, res.ok ? 'success' : 'warning');
  if (res.ok) void reviewApp.refreshPanel();
}
