/**
 * 回收站（批 1 地基，纯逻辑）。
 *
 * 以前移出计划只有一条几秒的 toast 撤销，错过了就只能手动改 JSON。回收站把
 * 「删掉的条目本身」留在盘上，恢复时连阶段、排期、复习历史一起回来。
 *
 * 它同时是**墓碑**的来源：跨设备合并要知道「这条是被人主动删掉的」，
 * 否则另一台设备的旧副本会把它复活（社区里那种删了又自己回来的怪事）。
 */
import { stripRuntime } from './store-format';

/** 回收站上限：只保最近这么多条，防无限增长 */
export const TRASH_LIMIT = 200;
/** 回收站条目保留天数 */
export const TRASH_TTL_DAYS = 30;

export interface TrashEntry {
  /** 身份键（= 条目的 filePath；划线卡是 reader:… 钥匙） */
  key: string;
  /** 条目 id（跨设备去重用） */
  id: string;
  /** 删除时间（毫秒） */
  at: number;
  kind: 'note' | 'card';
  /** 列表里那一行字（恢复时不必再读条目内容） */
  title: string;
  /** 原条目快照（已剥运行时字段，恢复即原样放回） */
  item: any;
}

/** 把条目放进回收站：同键去重（新删的覆盖旧的）、超上限丢掉最旧的 */
export function addToTrash(list: readonly TrashEntry[], items: readonly any[], now: Date): TrashEntry[] {
  const at = now.getTime();
  const incoming: TrashEntry[] = items.map((item) => {
    const key = String(item?.filePath ?? item?.id ?? '');
    return {
      key,
      id: String(item?.id ?? key),
      at,
      kind: item?.kind === 'card' ? 'card' : 'note',
      title: String(item?.name ?? key),
      item: stripRuntime(item ?? {}),
    };
  });
  const freshKeys = new Set(incoming.map((e) => e.key));
  const kept = list.filter((e) => !freshKeys.has(e.key));
  const merged = [...kept, ...incoming];
  return merged.length > TRASH_LIMIT ? merged.slice(merged.length - TRASH_LIMIT) : merged;
}

/** 清掉过期的（默认 30 天） */
export function pruneTrash(list: readonly TrashEntry[], now: Date, days: number = TRASH_TTL_DAYS): TrashEntry[] {
  const cutoff = now.getTime() - days * 86400000;
  return list.filter((e) => Number(e.at) > cutoff);
}

/**
 * 墓碑表：key 与 id 各记一份。
 *
 * 合并时条目按 id 对齐，而回收站记的是 filePath —— 只记一边的话，
 * 「删掉的条目」和「另一台设备的副本」永远碰不上面，删了又自己回来。
 */
export function tombstonesOf(list: readonly TrashEntry[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of list) {
    for (const k of [e?.key, e?.id]) {
      if (!k) continue;
      const prev = m.get(k) ?? 0;
      if (Number(e.at) > prev) m.set(k, Number(e.at));
    }
  }
  return m;
}

/** 从回收站取回条目（返回新列表与取出的条目；不存在的键静默忽略） */
export function takeFromTrash(
  list: readonly TrashEntry[],
  keys: readonly string[]
): { list: TrashEntry[]; restored: TrashEntry[] } {
  const want = new Set(keys);
  const restored: TrashEntry[] = [];
  const rest: TrashEntry[] = [];
  for (const e of list) (want.has(e.key) ? restored : rest).push(e);
  return { list: rest, restored };
}
