/**
 * 回收站的读写（IO 薄层，逻辑全在 trash.ts）。
 *
 * 单独一个文件：recycle 纯逻辑要能被 node 测试直接 import，
 * 一沾 obsidian / storage 就跑不了。
 */
import type { App } from 'obsidian';
import { jsonFileStore, storageFile } from '../core/storage';
import { tryGetSettings } from '../core/settings-provider';
import { addToTrash, pruneTrash, takeFromTrash, type TrashEntry } from './trash';

/** 回收站文件（与 review.json 同目录，跟着库走） */
export function getTrashFilePath(): string {
  const s = tryGetSettings();
  return storageFile('review-trash.json', (s && s.storagePath) || 'CONFIG/STORAGE');
}

function store(app: App) {
  return jsonFileStore<any>(getTrashFilePath(), { app, defaultValue: [] });
}

function normalize(raw: unknown): TrashEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((e) => e && typeof e === 'object' && typeof e.key === 'string' && e.key);
}

export async function loadTrash(app: App): Promise<TrashEntry[]> {
  return pruneTrash(normalize(await store(app).read()), new Date());
}

/** 删除条目时调用：追加进回收站并清掉过期的 */
export async function pushTrash(app: App, items: readonly any[], now: Date = new Date()): Promise<void> {
  if (!items.length) return;
  const list = pruneTrash(normalize(await store(app).read()), now);
  await store(app).write(addToTrash(list, items, now));
}

/** 恢复成功后把对应墓碑拿掉（否则这些条目下次合并会被当成「已删除」） */
export async function removeTrashKeys(app: App, keys: readonly string[]): Promise<void> {
  if (!keys.length) return;
  const list = normalize(await store(app).read());
  await store(app).write(takeFromTrash(list, keys).list);
}

/** 取回并同时从回收站移除（数据层恢复用） */
export async function takeTrash(app: App, keys: readonly string[]): Promise<TrashEntry[]> {
  const list = normalize(await store(app).read());
  const { list: rest, restored } = takeFromTrash(list, keys);
  if (restored.length) await store(app).write(rest);
  return restored;
}

export async function clearTrash(app: App): Promise<void> {
  await store(app).write([]);
}
