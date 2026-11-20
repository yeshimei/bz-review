/**
 * 备份的落盘与恢复（批 4，IO 薄层）。
 *
 * 导出到库内 `<数据目录>/export/`（默认 `bz-review/storage/export`）：跟着库走、用户能在文件管理器里直接拖进网盘。
 * 恢复走「先给当前数据留一份快照，再整份写回」——合并语义留给日常写入，
 * 恢复是明确的「我要回到那个样子」，不该被 newer-wins 挡住。
 */
import type { App } from 'obsidian';
import { diskReadText, jsonFileStore, storageDir } from '../core/storage';
import type { ReviewItem } from './data';
import { getReviewFilePath, getReviewMetaPath, ReviewDataManager } from './data';
import { backupFileName, buildBackup, parseBackup, toCsv } from './backup';
import { serializeReviewItems, reviewMeta } from './store-format';
import { writeSnapshotNow } from './snapshot-store';

export function exportDir(): string {
  return `${storageDir().replace(/\/+$/, '')}/export`;
}

async function ensureDir(app: App, dir: string): Promise<void> {
  try {
    if (!(await app.vault.adapter.exists(dir))) await app.vault.adapter.mkdir(dir);
  } catch {
    /* 已存在 / 并发创建：后面的写盘会给出真实错误 */
  }
}

/** 导出：返回写好的文件路径（调用方拿去提示用户） */
export async function exportBackupFile(app: App, items: readonly ReviewItem[], kind: 'json' | 'csv'): Promise<string> {
  const now = new Date();
  const dir = exportDir();
  await ensureDir(app, dir);
  const path = `${dir}/${backupFileName(now, kind)}`;
  const body = kind === 'json' ? JSON.stringify(buildBackup(items, now), null, 2) : toCsv(items);
  await app.vault.adapter.write(path, body);
  return path;
}

/** 恢复前把当前数据留一份，恢复也能反悔 */
export async function restoreBackupFile(app: App, path: string): Promise<{ ok: boolean; message: string }> {
  let raw: string;
  try {
    raw = (await app.vault.adapter.read(path));
  } catch {
    return { ok: false, message: `读不到这个文件：${path}` };
  }
  let parsedRaw: unknown;
  try {
    /* 剥 UTF-8 BOM：Windows 记事本另存的 JSON 会带 BOM，JSON.parse 直接报
       Unexpected token，用户会以为备份坏了。 */
    parsedRaw = JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch {
    return { ok: false, message: '这不是一个 JSON 备份文件' };
  }
  const parsed = parseBackup(parsedRaw);
  if (!parsed.ok) return { ok: false, message: parsed.error };

  const current = await diskReadText(app, getReviewFilePath());
  if (current) await writeSnapshotNow(app, current, new Date());

  /* 备份条目已是导出的干净形态，这里只做浅拷贝再落盘；派生字段（isMissing/排期等）
     由下次 loadItems 从数据层补全，恢复阶段不在这里重复构造，避免两份规则漂移。 */
  const items = parsed.items.map((it) => ({ ...it })) as ReviewItem[];
  await jsonFileStore<unknown>(getReviewFilePath(), { app }).write(serializeReviewItems(items));
  await jsonFileStore<unknown>(getReviewMetaPath(), { app }).write(reviewMeta(new Date()));
  return { ok: true, message: `已恢复 ${items.length} 条（恢复前的数据留了一份快照）` };
}

/** 列出备份目录里的文件（恢复弹窗给个候选，省得用户手打路径） */
export async function listBackupFiles(app: App): Promise<string[]> {
  try {
    const listed = (await app.vault.adapter.list(exportDir())) as { files?: string[] };
    return (listed?.files ?? []).filter((f) => /\.(json|csv)$/i.test(f)).sort().reverse();
  } catch {
    return [];
  }
}

/** 从当前笔记解析出的卡片直接入计划（供命令调用） */
export async function importCardsFromMarkdown(
  dm: ReviewDataManager,
  cards: ReturnType<typeof import('./md-cards').parseMarkdownCards>
): Promise<{ added: number; skipped: number; rejected: number; overLimitMessage: string }> {
  const res = await dm.addCards(cards.map((c) => c.card));
  return { added: res.added, skipped: res.skipped, rejected: res.rejected, overLimitMessage: res.overLimitMessage };
}

/** 备份文件里能读出多少条（弹窗里给个预览，别让用户盲恢复） */
export function countOfBackup(raw: string): number | null {
  try {
    const parsed = parseBackup(JSON.parse(raw.replace(/^\uFEFF/, '')));
    return parsed.ok ? parsed.items.length : null;
  } catch {
    return null;
  }
}
