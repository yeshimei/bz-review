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
  if (raw === null) return { ok: false, message: `读不到这份备份：${point.name}` };
  let json: unknown;
  try {
    json = JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch {
    /* 手动备份可能是半个文件 / 被改坏：别让 JSON.parse 抛穿，给用户一句人话 */
    return { ok: false, message: '备份文件损坏，无法回滚' };
  }
  const parsed = parseReviewFile(json);
  if (parsed.broken) return { ok: false, message: '这份备份读不出复习数据，换一份试试' };

  const current = await diskReadText(app, getReviewFilePath());
  if (current) await writeSnapshotNow(app, current, new Date());
  await jsonFileStore<unknown>(getReviewFilePath(), { app }).write(serializeReviewItems(parsed.items));
  await jsonFileStore<unknown>(getReviewMetaPath(), { app }).write(reviewMeta(new Date()));
  return { ok: true, message: `已回滚 ${parsed.items.length} 条（回滚前已给当前数据留快照）` };
}

/** 二次确认后做一份手动备份（写到 export 目录，跟库走） */
async function backupNow(app: App): Promise<void> {
  const v = await openFlowDialog({
    title: '现在备份一次？',
    message: '会把当前复习数据另存一份，方便以后回滚。',
    actions: [
      { label: '取消', value: 'cancel' },
      { label: '备份', value: 'ok', cta: true },
    ],
  });
  if (v !== 'ok') return;
  const items = (await import('./app')).reviewApp;
  items.ensure(app);
  const list = await items.dataManager!.loadItems();
  const path = await exportBackupFile(app, list, 'json');
  notice(`已备份 ${list.length} 条：${path}`, 'success');
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
        ? '选一份，点「回滚到这里」。回滚前会先把当前数据存成快照，退错还能再退回来。'
        : '还没有备份或快照。点下方「立即备份」存一份。',
    });
    const list = body.createDiv({ cls: 'bzrv-backup-list' });
    for (const point of points) {
      const row = list.createDiv({ cls: 'bzrv-backup-row' });
      const info = row.createDiv({ cls: 'bzrv-backup-info' });
      info.createSpan({ cls: 'bzrv-backup-time', text: describeRestorePoint(point) });
      const btn = row.createEl('button', { cls: 'bzrv-btn', text: '回滚到这里' });
      let busy = false;
      btn.onclick = () => {
        if (busy) return;
        void (async () => {
          try {
            const v = await openFlowDialog({
              title: '回滚到这里？',
              message: `${describeRestorePoint(point)}\n\n当前数据会先存成一份快照，然后整份替换成这份备份。`,
              actions: [
                { label: '取消', value: 'cancel' },
                { label: '回滚', value: 'ok', cta: true, danger: true },
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
            notice(`备份文件损坏，无法回滚：${e instanceof Error ? e.message : String(e)}`, 'warning');
          }
        })();
      };
    }
  };
  render();

  const modal = uiModal({
    title: '备份与回滚',
    head: true,
    content: body,
    maxWidth: 520,
    className: 'bzrv-backup-history-modal',
  });

  /* 顶部动作条：立即备份（二次确认）+ 关掉。滚动区已在 body 内，这里贴底排按钮。 */
  const actions = modal.popup.createDiv({ cls: 'bzrv-edit-actions bzrv-backup-actions' });
  const refresh = actions.createEl('button', { cls: 'bzrv-btn', text: '刷新列表' });
  refresh.onclick = () => {
    void (async () => {
      points = await collectRestorePoints(app);
      render();
    })();
  };
  const backupBtn = actions.createEl('button', { cls: 'bzrv-btn', text: '立即备份' });
  backupBtn.onclick = () => {
    void (async () => {
      await backupNow(app);
      points = await collectRestorePoints(app);
      render();
    })();
  };
  const closeBtn = actions.createEl('button', { cls: 'bzrv-btn', text: '关闭' });
  closeBtn.onclick = () => modal.close();
}

/** 入口：从设置页「回滚到最近快照」改走这里时，也复用二次确认口径 */
export async function restoreLatestWithConfirm(app: App): Promise<void> {
  const points = await collectRestorePoints(app);
  const latest = points[0];
  if (!latest) {
    notice('还没有任何备份或快照', 'warning');
    return;
  }
  const v = await openFlowDialog({
    title: '回滚到最近一份？',
    message: `${describeRestorePoint(latest)}\n\n当前数据会先存成快照，再整份替换。`,
    actions: [
      { label: '取消', value: 'cancel' },
      { label: '回滚', value: 'ok', cta: true, danger: true },
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
