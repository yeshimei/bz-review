/**
 * 备份历史（可回滚时间点）的纯逻辑。
 *
 * 两类来源合成一份清单：
 *   - 自动快照 `.SNAPSHOT/review.YYYYMMDD-HHMMSS.json`（写盘前留的）
 *   - 手动备份 `export/review-backup-YYYYMMDD-HHMMSS.json`（导出命令留的）
 * 文件名里的 UTC 时间戳就是排序键，不依赖目录返回顺序；两条来源同一时间用
 * 来源前缀打破平局。CSV 不是恢复点（不能导回），一律不进清单。
 */
import { parseBackup } from './backup';
import { parseReviewFile } from './store-format';

export type RestoreSource = 'snapshot' | 'backup';

export interface RestorePoint {
  /** 文件名（在各自目录里唯一，删/读都用它） */
  name: string;
  /** 完整库内路径 */
  path: string;
  source: RestoreSource;
  /** 排序键 YYYYMMDD-HHMMSS（UTC） */
  stamp: string;
  /** 这份里有几条；读不出来给 null（不猜） */
  count: number | null;
}

const SNAPSHOT_RE = /^review\.(\d{8}-\d{6})(?:-\d+)?\.json$/;
const BACKUP_RE = /^review-backup-(\d{8}-\d{6})(?:-\d+)?\.json$/;

/** 从文件名取排序键；认不出返回 null */
export function restoreStampOf(name: string): string | null {
  const m = SNAPSHOT_RE.exec(name) || BACKUP_RE.exec(name);
  return m ? m[1] : null;
}

export function sourceOf(name: string): RestoreSource | null {
  if (SNAPSHOT_RE.test(name)) return 'snapshot';
  if (BACKUP_RE.test(name)) return 'backup';
  return null;
}

/** 把时间戳显示成人话（UTC，与命名口径一致，避免换时区多出一份「同一天」） */
export function formatRestoreTime(stamp: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(stamp);
  if (!m) return stamp;
  const [, y, mo, d, h, mi, s] = m;
  return `${y}-${mo}-${d} ${h}:${mi}:${s} UTC`;
}

/** 清单按时间倒序（新的在前）；同一秒快照在前 */
export function sortRestorePoints(points: readonly RestorePoint[]): RestorePoint[] {
  return [...points].sort((a, b) => {
    if (a.stamp !== b.stamp) return a.stamp < b.stamp ? 1 : -1;
    if (a.source !== b.source) return a.source === 'snapshot' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/** 读一份备份/快照的原文，数出条目数；坏档返回 null（不猜、不抛） */
export function countRestoreRaw(raw: string): number | null {
  let parsedRaw: unknown;
  try {
    parsedRaw = JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
  if (Array.isArray(parsedRaw)) {
    return parseReviewFile(parsedRaw).items.length;
  }
  const p = parseBackup(parsedRaw);
  return p.ok ? p.items.length : null;
}

/** 一条恢复点的人话描述（弹窗每行主文案） */
export function describeRestorePoint(p: RestorePoint): string {
  const kind = p.source === 'snapshot' ? '自动快照' : '手动备份';
  const count = p.count === null ? '条数未知' : `${p.count} 条`;
  return `${formatRestoreTime(p.stamp)} · ${kind} · ${count}`;
}
