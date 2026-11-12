/**
 * 从 bz 导入复习数据（src/data/migrate.ts）
 *
 * bz 里的复习计划存在 `CONFIG/STORAGE/review.json`，本插件默认写
 * `CONFIG/REVIEW/review.json`——两个插件同时装也不会互相覆盖。
 *
 * 迁移只做一次、只读源文件、目标非空就不动：迁移失败最多是「没导进来」，
 * 绝不会把 bz 那边已经攒了几个月的数据改坏。
 */
import type { App } from 'obsidian';
import { jsonFileStore, storageFile } from '../core/storage';
import { parseBzReviewJson } from './migrate-parse';
import type BzSettings from '../settings';

export type { ParsedBzReview } from './migrate-parse';
export { parseBzReviewJson } from './migrate-parse';

/** bz 的复习数据位置（固定，不跟它的设置走——移植时宁可找不到，也不猜错） */
export const BZ_REVIEW_PATH = 'CONFIG/STORAGE/review.json';

export interface MigrateResult {
  ok: boolean;
  message: string;
  imported?: number;
}

export async function migrateFromBz(app: App, settings: BzSettings): Promise<MigrateResult> {
  const dstPath = storageFile('review.json', (settings.storagePath || 'CONFIG/REVIEW').trim());

  const exists = async (p: string): Promise<boolean> => {
    try {
      return await app.vault.adapter.exists(p);
    } catch {
      return false;
    }
  };

  if (!(await exists(BZ_REVIEW_PATH))) {
    return { ok: false, message: '没找到 bz 的复习数据（CONFIG/STORAGE/review.json），不用导入。' };
  }
  if (await exists(dstPath)) {
    /* 只看「文件在不在」会误伤：插件启动读一次 review.json 就顺手把它建成了
       `[]`。而老用户的真实顺序是「装插件 → 设置 → 导入」，此时文件早就在了，
       于是导入对所有老用户都是死路——还会提示「你已经有复习数据了」，让人以为
       自己早就导过。所以判的是**有没有条目**，不是有没有文件。 */
    let existing = '';
    try {
      existing = await app.vault.adapter.read(dstPath);
    } catch {
      existing = '';
    }
    let hasData = false;
    try {
      const parsed = JSON.parse(existing);
      hasData = Array.isArray(parsed) ? parsed.length > 0 : !!parsed;
    } catch {
      // 目标文件是坏的：同样不覆盖，但把它当成「有数据」，让用户先自己处理
      hasData = existing.trim().length > 0;
    }
    if (hasData) {
      return { ok: false, message: `本插件已经有复习数据（${dstPath}），不覆盖。` };
    }
  }

  let raw = '';
  try {
    raw = await app.vault.adapter.read(BZ_REVIEW_PATH);
  } catch {
    return { ok: false, message: '读不了 bz 的复习数据，导入中止。' };
  }

  const parsed = parseBzReviewJson(raw);
  if (!parsed.ok) return { ok: false, message: parsed.message };
  const items = parsed.items;

  try {
    await jsonFileStore<unknown[]>(dstPath).write(items);
  } catch (e) {
    return { ok: false, message: `写入失败：${(e as Error)?.message || '未知错误'}` };
  }
  return {
    ok: true,
    message: `已从 bz 导入 ${items.length} 条复习记录。bz 那边的数据没动。`,
    imported: items.length,
  };
}
