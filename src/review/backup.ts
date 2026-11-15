/**
 * 备份导出与恢复（批 4，纯函数）。
 *
 * 数据只在库里那一份 JSON 上：库坏了、同步冲突了、换电脑忘了拷，就什么都没了。
 * 导出成一个自带版本号的文件，用户能自己存网盘；恢复时走「先快照再覆盖」，
 * 恢复本身也能反悔。
 *
 * JSON 是给机器读的（完整恢复），CSV 是给人看的（Excel 里核对、交给别人），
 * 所以 CSV 只导出常见几列，不假装能原样导回来。
 */
import { REVIEW_SCHEMA_VERSION } from './store-format';
import { stripRuntime } from './store-format';
import type { ReviewItem } from './data';

export interface BackupFile {
  plugin: 'bz-review';
  schema: number;
  exportedAt: string;
  count: number;
  items: any[];
}

export function buildBackup(items: readonly ReviewItem[], now: Date = new Date()): BackupFile {
  const clean = items.map((i) => stripRuntime(i as any));
  return {
    plugin: 'bz-review',
    schema: REVIEW_SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    count: clean.length,
    items: clean,
  };
}

export type BackupParse = { ok: true; items: any[] } | { ok: false; error: string };

/**
 * 读备份文件。
 *
 * 兼容三种形态：本插件导出的、裸数组、带 items 的老壳——都不认就明确报错，
 * 不返回空数组：空数组恢复一次，用户的计划就真的空了。
 */
export function parseBackup(raw: unknown): BackupParse {
  if (Array.isArray(raw)) return { ok: true, items: raw as any[] };
  if (raw && typeof raw === 'object') {
    const obj = raw as { items?: unknown; plugin?: unknown; schema?: unknown };
    if (obj.plugin && obj.plugin !== 'bz-review') return { ok: false, error: '这不是复习计划导出的备份' };
    if (Array.isArray(obj.items)) return { ok: true, items: obj.items as any[] };
  }
  return { ok: false, error: '文件里没有复习数据' };
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const CSV_COLUMNS = [
  'id',
  'kind',
  'filePath',
  'name',
  'stage',
  'phase',
  'stability',
  'difficulty',
  'nextReviewDate',
  'totalReviews',
  'lastReviewed',
  'lastDifficulty',
] as const;

/**
 * 导出 CSV（给人看的那一份；不做导回）。
 *
 * 带 UTF-8 BOM + CRLF：Windows 版 Excel 打开 CSV 不看内容只看这两样——
 * 没有 BOM 中文整列乱码，只有 LF 会全挤在一行。「给人看」那份的意义就在这里。
 */
export function toCsv(items: readonly ReviewItem[]): string {
  const head = CSV_COLUMNS.join(',');
  const rows = items.map((it) =>
    CSV_COLUMNS.map((c) => {
      if (c === 'kind') return csvCell(it.kind === 'card' ? 'card' : 'note');
      if (c === 'name') return csvCell(it.name || it.card?.text?.slice(0, 40) || '');
      return csvCell((it as any)[c]);
    }).join(',')
  );
  return '\uFEFF' + [head, ...rows].join('\r\n') + '\r\n';
}

/** 导出文件名（带时间，连点两次也不会互相覆盖） */
export function backupFileName(now: Date, ext: 'json' | 'csv'): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `review-backup-${stamp}.${ext}`;
}
