/**
 * 自动快照的落盘（IO 薄层，命名与清理规则在 snapshot.ts）。
 *
 * 目录是数据目录下的 `.SNAPSHOT`：与 review.json 同盘、同库，用户把库拷到
 * 另一台机器时快照跟着走；点前缀目录不在 Obsidian 索引里，一条 API 都用 adapter。
 */
import type { App } from 'obsidian';
import { storageDir } from '../core/storage';
import {
  SNAPSHOT_DIR_NAME,
  isSnapshotName,
  latestSnapshot,
  pickOverLimit,
  pickPrunable,
  snapshotDay,
  snapshotName,
} from './snapshot';

export function snapshotDir(): string {
  return `${storageDir().replace(/\/+$/, '')}/${SNAPSHOT_DIR_NAME}`;
}

async function ensureDir(app: App): Promise<void> {
  const dir = snapshotDir();
  try {
    if (await app.vault.adapter.exists(dir)) return;
    await app.vault.adapter.mkdir(dir);
  } catch {
    /* 并发建目录 / 适配器不支持：交给后面的写盘报错，这里不打断主流程 */
  }
}

export async function listSnapshots(app: App): Promise<string[]> {
  try {
    const listed = (await app.vault.adapter.list(snapshotDir())) as { files?: string[] };
    return (listed?.files ?? [])
      .map((p) => p.slice(p.lastIndexOf('/') + 1))
      .filter((name) => isSnapshotName(name))
      .sort();
  } catch {
    return [];
  }
}

export async function readSnapshot(app: App, name: string): Promise<string | null> {
  try {
    return (await app.vault.adapter.read(`${snapshotDir()}/${name}`));
  } catch {
    return null;
  }
}

async function writeOne(app: App, raw: string, now: Date): Promise<string> {
  await ensureDir(app);
  const names = await listSnapshots(app);
  let name = snapshotName(now);
  /* 同一秒内连点两次「立即备份」：加 -2/-3 后缀，别互相覆盖 */
  for (let i = 2; names.includes(name); i++) name = snapshotName(now).replace(/\.json$/, `-${i}.json`);
  await app.vault.adapter.write(`${snapshotDir()}/${name}`, raw);
  /* 两份清单取并集：按天清过期 + 按份数封顶（含刚写的这份一起数）。
     pickPrunable 拿到的是写之前的列表，不会把刚写的那份当旧的删掉。 */
  const toRemove = new Set([...pickPrunable(names, now), ...pickOverLimit([...names, name])]);
  for (const old of toRemove) {
    try {
      await app.vault.adapter.remove(`${snapshotDir()}/${old}`);
    } catch {
      /* 清理失败不影响本次快照 */
    }
  }
  return name;
}

/**
 * 写当天第一份快照（原来长什么样）。
 *
 * 一天只留一份：同一天里评几十次级，每次都留等于把文件夹塞满噪音，
 * 而「今天早上它是什么样」才是真正想回滚到的那个点。
 * 写成功后顺手清理过期文件；任何一步失败都只返回 null，不影响主写入。
 */
export async function writeDailySnapshot(app: App, raw: string, now: Date = new Date()): Promise<string | null> {
  if (!raw) return null;
  try {
    const day = snapshotDay(now);
    const names = await listSnapshots(app);
    if (names.some((n) => n.startsWith(`review.${day}-`))) return null;
    return await writeOne(app, raw, now);
  } catch (e) {
    console.warn('[review] 快照写入失败（不影响主数据）', e);
    return null;
  }
}

/** 立即备份一份（不受「一天一份」限制；回滚前也用它留退路） */
export async function writeSnapshotNow(app: App, raw: string, now: Date = new Date()): Promise<string | null> {
  if (!raw) return null;
  try {
    return await writeOne(app, raw, now);
  } catch (e) {
    console.warn('[review] 快照写入失败', e);
    return null;
  }
}

/** 最近一份快照的文件名（设置页「回滚」用） */
export async function latestSnapshotName(app: App): Promise<string | null> {
  return latestSnapshot(await listSnapshots(app));
}
