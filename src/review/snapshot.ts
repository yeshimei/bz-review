/**
 * 自动快照的命名与保留（批 1 地基，纯函数）。
 *
 * 为什么要有：复习数据只有一份 JSON，一次误合并、一次同步冲突就能把几个月的历史
 * 抹平。留一份「写之前长什么样」比任何事后追查都管用。
 *
 * 命名统一用 UTC，理由和坏档留档一样：文件名就是排序键，换台机器、换个时区
 * 不能变出两份「同一天」的快照。
 */

/** 保留天数 */
export const SNAPSHOT_KEEP_DAYS = 7;
/** 快照目录名（与数据文件同级的点目录，Obsidian 侧栏看不见） */
export const SNAPSHOT_DIR_NAME = '.SNAPSHOT';

/* 同秒连点备份会加 -2/-3 后缀（见 snapshot-store.writeOne）。旧正则不认这些
   带后缀的文件，导致它们被 listSnapshots 过滤掉、既回滚不到也永不清理；
   扩展为可选 -(数字) 后缀，让它们也能被识别与轮转。时间戳段仍是第 1 组。 */
const NAME_RE = /^review\.(\d{8}-\d{6})(?:-\d+)?\.json$/;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** 文件名：review.20261115-080503.json */
export function snapshotName(d: Date): string {
  return `review.${snapshotDay(d)}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}.json`;
}

/** 日期段：20261115（判断「今天已经留过」用） */
export function snapshotDay(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

export function isSnapshotName(name: string): boolean {
  return NAME_RE.test(name);
}

/** 从文件名取时间戳段（认不出返回 null，绝不猜） */
export function snapshotStamp(name: string): string | null {
  const m = NAME_RE.exec(name);
  return m ? m[1] : null;
}

function dateOfStamp(stamp: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(stamp);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const t = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  return Number.isFinite(t) ? new Date(t) : null;
}

/** 该清理哪些：只清认得出来、而且真过期的；不认识的宁可不动 */
export function pickPrunable(names: readonly string[], now: Date, keepDays: number = SNAPSHOT_KEEP_DAYS): string[] {
  const cutoff = now.getTime() - keepDays * 86400000;
  const out: string[] = [];
  for (const name of names) {
    const stamp = snapshotStamp(name);
    if (!stamp) continue;
    const d = dateOfStamp(stamp);
    if (d && d.getTime() < cutoff) out.push(name);
  }
  return out;
}

/** 最新的一份（按文件名里的时间戳排序，不依赖列表顺序） */
export function latestSnapshot(names: readonly string[]): string | null {
  let best: { name: string; stamp: string } | null = null;
  for (const name of names) {
    const stamp = snapshotStamp(name);
    if (!stamp) continue;
    if (!best || stamp > best.stamp) best = { name, stamp };
  }
  return best ? best.name : null;
}
