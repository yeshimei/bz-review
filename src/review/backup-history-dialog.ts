/**
 * 「备份与回滚」独立弹窗（多份历史 + 手动挑任意时间点）。
 *
 * 设置页原来只有一个输入框 + 一个「回滚到最近快照」按钮，想退回三天前的状态
 * 根本做不到。这里把两类恢复点（自动快照 + 手动备份）并成一份清单，点哪份退哪份。
 *
 * 两条铁律（用户 2026-11-20 拍板）：
 *   1. 备份、回滚都要二次确认——备份看着无害，但会占一份历史；回滚会整份覆盖，
 *      两步确认挡住手滑。
 *   2. 回滚前先把当前状态留一份快照——退错了还能再退回来，不用哭。
 */
import type { App } from 'obsidian';
import { notice } from '../core/notice';
import { openFlowDialog } from '../core/flow-dialog';
import { uiModal } from '../core/ui/modal';
import { diskReadText, jsonFileStore } from '../core/storage';
import { getReviewFilePath, getReviewMetaPath } from './data';
import { countRestoreRaw, describeRestorePoint, restoreStampOf, sortRestorePoints, type RestorePoint } from './backup-history';
import { exportBackupFile, listBackupFiles } from './backup-io';
import { listSnapshots, readSnapshot, snapshotDir, writeSnapshotNow } from './snapshot-store';
import { parseReviewFile, serializeReviewItems, reviewMeta } from './store-format';
import { t } from '../i18n';

/** 收集所有可回滚的时间点：自动快照 + 手动 JSON 备份（CSV 不能导回，不算） */
async function collectRestorePoints(app: App): Promise<RestorePoint[]> {
  const out: RestorePoint[] = [];
  const dir = snapshotDir().replace(/\/+$/, '');
  for (const name of await listSnapshots(app)) {
    const stamp = restoreStampOf(name);
    if (!stamp) continue;
    const raw = await readSnapshot(app, name);
    out.push({
      name,
      path: `${dir}/${name}`,
      source: 'snapshot',
      stamp,
      count: raw === null ? null : countRestoreRaw(raw),
    });
  }
  for (const path of await listBackupFiles(app)) {
    if (!/\.json$/i.test(path)) continue;
    const name = path.slice(path.lastIndexOf('/') + 1);
    const stamp = restoreStampOf(name);
    if (!stamp) continue;
    let raw: string | null = null;
    try {
      raw = (await app.vault.adapter.read(path));
    } catch {
      /* 读不出来就给「条数未知」，回滚时再报错 */
    }
    out.push({ name, path, source: 'backup', stamp, count: raw === null ? null : countRestoreRaw(raw) });
  }
  return sortRestorePoints(out);
}

/** 删除一份恢复点：只删磁盘上的快照 / 备份文件，当前复习数据一律不动 */
async function deleteRestorePoint(app: App, point: RestorePoint): Promise<{ ok: boolean; message: string }> {
  try {
    await app.vault.adapter.remove(point.path);
    return { ok: true, message: t('backup.deleted') };
  } catch (e) {
    return { ok: false, message: t('backup.deleteFailed', { reason: e instanceof Error ? e.message : String(e) }) };
  }
}

/**
 * 回滚到指定恢复点：先给当前数据留一份快照，再整份写回。
 * 快照、手动备份两种原文形态都认（走 parseReviewFile），不走合并——用户明确说
 * 「回到那个样子」，不该被 newer-wins 挡住。
 */
async function restorePoint(app: App, point: RestorePoint): Promise<{ ok: boolean; message: string }> {
  let raw: string | null;
  if (point.source === 'snapshot') raw = await readSnapshot(app, point.name);
  else {
    try {
      raw = (await app.vault.adapter.read(point.path));
    } catch {
      raw = null;
    }
  }
  if (raw === null) return { ok: false, message: t('backup.readFailed', { name: point.name }) };
  let json: unknown;
  try {
    json = JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch {
    /* 手动备份可能是半个文件 / 被改坏：别让 JSON.parse 抛穿，给用户一句人话 */
    return { ok: false, message: t('backup.corrupt') };
  }
  const parsed = parseReviewFile(json);
  if (parsed.broken) return { ok: false, message: t('backup.noData') };

  const current = await diskReadText(app, getReviewFilePath());
  if (current) await writeSnapshotNow(app, current, new Date());
  await jsonFileStore<unknown>(getReviewFilePath(), { app }).write(serializeReviewItems(parsed.items));
  await jsonFileStore<unknown>(getReviewMetaPath(), { app }).write(reviewMeta(new Date()));
  return { ok: true, message: t('backup.rolledBack', { n: parsed.items.length }) };
}

/** 二次确认后做一份手动备份（写到 export 目录，跟库走） */
async function backupNow(app: App): Promise<void> {
  const v = await openFlowDialog({
    title: t('backup.askNowTitle'),
    message: t('backup.askNowBody'),
    actions: [
      { label: t('common.cancel'), value: 'cancel' },
      { label: t('backup.doBackup'), value: 'ok', cta: true },
    ],
  });
  if (v !== 'ok') return;
  const items = (await import('./app')).reviewApp;
  items.ensure(app);
  const list = await items.dataManager!.loadItems();
  const path = await exportBackupFile(app, list, 'json');
  notice(t('backup.backedUp', { n: list.length, path }), 'success');
}

/** 打开「备份与回滚」弹窗 */
export async function openBackupHistoryDialog(app: App): Promise<void> {
  let points = await collectRestorePoints(app);
  const body = createDiv({ cls: 'bzrv-backup-history' });

  const render = (): void => {
    body.empty();
    body.createDiv({
      cls: 'bzrv-edit-desc',
      text: points.length
        ? t('backup.hint')
        : t('backup.empty'),
    });
    const list = body.createDiv({ cls: 'bzrv-backup-list' });
    for (const point of points) {
      const row = list.createDiv({ cls: 'bzrv-backup-row' });
      const info = row.createDiv({ cls: 'bzrv-backup-info' });
      info.createSpan({ cls: 'bzrv-backup-time', text: describeRestorePoint(point) });
      const rowActions = row.createDiv({ cls: 'bzrv-backup-row-actions' });
      const del = rowActions.createEl('button', { cls: 'bzrv-btn bzrv-btn--danger-ghost', text: t('backup.delete') });
      del.onclick = () => {
        void (async () => {
          const v = await openFlowDialog({
            title: t('backup.deleteTitle'),
            message: t('backup.deleteBody', { desc: describeRestorePoint(point) }),
            actions: [
              { label: t('common.cancel'), value: 'cancel' },
              { label: t('backup.delete'), value: 'ok', cta: true, danger: true },
            ],
          });
          if (v !== 'ok') return;
          const res = await deleteRestorePoint(app, point);
          notice(res.message, res.ok ? 'success' : 'warning');
          if (res.ok) {
            points = points.filter((p) => p.path !== point.path);
            render();
          }
        })();
      };
      const btn = rowActions.createEl('button', { cls: 'bzrv-btn', text: t('backup.restoreHere') });
      let busy = false;
      btn.onclick = () => {
        if (busy) return;
        void (async () => {
          try {
            const v = await openFlowDialog({
              title: t('backup.restoreTitle'),
              message: t('backup.restoreBody', { desc: describeRestorePoint(point) }),
              actions: [
                { label: t('common.cancel'), value: 'cancel' },
                { label: t('backup.restore'), value: 'ok', cta: true, danger: true },
              ],
            });
            if (v !== 'ok') return;
            busy = true;
            const res = await restorePoint(app, point);
            notice(res.message, res.ok ? 'success' : 'warning');
            if (res.ok) {
              const { reviewApp } = await import('./app');
              void reviewApp.refreshPanel();
              modal.close();
            } else busy = false;
          } catch (e) {
            busy = false;
            notice(t('backup.corruptReason', { reason: e instanceof Error ? e.message : String(e) }), 'warning');
          }
        })();
      };
    }
  };
  render();

  const modal = uiModal({
    title: t('backup.title'),
    head: true,
    content: body,
    size: 'md',
    className: 'bzrv-backup-history-modal',
  });

  /* 顶部动作条：立即备份（二次确认）+ 关掉。滚动区已在 body 内，这里贴底排按钮。 */
  const actions = modal.popup.createDiv({ cls: 'bzrv-edit-actions bzrv-backup-actions' });
  const refresh = actions.createEl('button', { cls: 'bzrv-btn', text: t('backup.refresh') });
  refresh.onclick = () => {
    void (async () => {
      points = await collectRestorePoints(app);
      render();
    })();
  };
  const backupBtn = actions.createEl('button', { cls: 'bzrv-btn', text: t('backup.backupNow') });
  backupBtn.onclick = () => {
    void (async () => {
      await backupNow(app);
      points = await collectRestorePoints(app);
      render();
    })();
  };
  const closeBtn = actions.createEl('button', { cls: 'bzrv-btn', text: t('common.close') });
  closeBtn.onclick = () => modal.close();
  // 默认焦点别落在列表里的危险「删除」按钮上（打开时按 Enter 会进删除确认）
  closeBtn.focus();
}

/** 入口：从设置页「回滚到最近快照」改走这里时，也复用二次确认口径 */
export async function restoreLatestWithConfirm(app: App): Promise<void> {
  const points = await collectRestorePoints(app);
  const latest = points[0];
  if (!latest) {
    notice(t('backup.emptyList'), 'warning');
    return;
  }
  const v = await openFlowDialog({
    title: t('backup.restoreLatestTitle'),
    message: t('backup.restoreLatestBody', { desc: describeRestorePoint(latest) }),
    actions: [
      { label: t('common.cancel'), value: 'cancel' },
      { label: t('backup.restore'), value: 'ok', cta: true, danger: true },
    ],
  });
  if (v !== 'ok') return;
  const res = await restorePoint(app, latest);
  notice(res.message, res.ok ? 'success' : 'warning');
  if (res.ok) {
    const { reviewApp } = await import('./app');
    void reviewApp.refreshPanel();
  }
}
