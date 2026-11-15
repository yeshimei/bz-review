/**
 * review.json 的形态与跨端合并（批 1 地基，纯函数）。
 *
 * 为什么改形态：文件以前是一个裸数组，没有任何版本号与写入时间。两台设备同时改，
 * 后写者整份覆盖前者；改成 `{version, updatedAt, items}` 后至少能回答
 * 「这份是哪个版本、什么时候写的」，读侧也兼容老数组（老用户不用手动迁移）。
 *
 * 为什么合并要这么保守：宁可多留一份 `.CONFLICT` 副本、多弹一句提示，也不能
 * 静默把另一台设备刚复习完的记录抹掉——社区里「卡片凭空消失」是最劝退的一类事故。
 *
 * 时间戳只盖在**真正改过的条目**上（见 stampChangedItems）。要是每次落盘给全员盖章，
 * 本机的旧副本就会永远显得比另一台新，改动方向被彻底掩盖。
 */

/** 当前数据文件版本；读到裸数组视同旧版，下次落盘自动升级 */
export const REVIEW_FILE_VERSION = 2;

/** loadItems 派生、不落盘的运行时字段（比对内容时必须剔除，否则一次列表刷新就算全员改动） */
const RUNTIME_FIELDS = ['file', 'isCompleted', 'isOverdue', 'isMissing', 'currentStage', 'totalStages'] as const;

export interface ReviewFileV2 {
  version: number;
  updatedAt: string;
  items: unknown[];
}

export interface ParsedReviewFile {
  items: any[];
  /** 磁盘上是旧版裸数组（读取照常，下次写入升级） */
  legacyArray: boolean;
  /** 既不是数组也不是带 items 的对象：当坏档处理，但不擅自覆盖 */
  broken: boolean;
}

/** 剥掉运行时字段（写盘白名单口径，单源在这里） */
export function stripRuntime<T extends Record<string, any>>(item: T): Omit<T, typeof RUNTIME_FIELDS[number]> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(item)) {
    if ((RUNTIME_FIELDS as readonly string[]).includes(k)) continue;
    out[k] = v;
  }
  return out as Omit<T, typeof RUNTIME_FIELDS[number]>;
}

/** 条目身份：优先 id（同一条目改名后仍是它），退回 filePath */
export function itemKey(item: any): string {
  const id = String(item?.id ?? '').trim();
  if (id) return id;
  return String(item?.filePath ?? '').trim();
}

/** 深度排序键，去掉键顺序差异造成的「假改动」 */
function canonicalValue(value: any): any {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const k of Object.keys(value).sort()) out[k] = canonicalValue(value[k]);
    return out;
  }
  return value;
}

/** 内容指纹：剔除运行时字段与 updatedAt 后比较（updatedAt 本身不是内容） */
export function contentFingerprint(item: any): string {
  const body = stripRuntime(item ?? {}) as Record<string, any>;
  delete body.updatedAt;
  return JSON.stringify(canonicalValue(body));
}

function updatedMs(item: any): number {
  const t = item?.updatedAt ? new Date(item.updatedAt).getTime() : 0;
  return Number.isFinite(t) ? t : 0;
}

/**
 * 解析磁盘原文（已 JSON.parse 的对象）：
 * - 裸数组 → 旧版，items 原样；
 * - `{items:[...]}` → 新版；
 * - 其它形态 → broken（调用方留档后自行决定，不在这里造数据）。
 */
export function parseReviewFile(raw: unknown): ParsedReviewFile {
  if (Array.isArray(raw)) return { items: raw, legacyArray: true, broken: false };
  if (raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown }).items)) {
    return { items: (raw as { items: unknown[] }).items as any[], legacyArray: false, broken: false };
  }
  return { items: [], legacyArray: false, broken: true };
}

export function wrapReviewFile(items: readonly any[], now: Date): ReviewFileV2 {
  return { version: REVIEW_FILE_VERSION, updatedAt: now.toISOString(), items: items.map((i) => stripRuntime(i)) };
}

/**
 * 只给内容真变了的条目盖 updatedAt。
 *
 * 老数据没有 updatedAt → 视为「未知时间」，一旦与磁盘不同就盖戳；
 * 与磁盘一模一样的条目保留原时间戳（这样另一台设备的改动才判得出新旧）。
 */
export function stampChangedItems(next: readonly any[], disk: readonly any[], now: Date): any[] {
  const iso = now.toISOString();
  const diskByKey = new Map<string, any>();
  for (const it of disk) {
    const k = itemKey(it);
    if (k && !diskByKey.has(k)) diskByKey.set(k, it);
  }
  return next.map((item) => {
    const old = diskByKey.get(itemKey(item));
    if (!old) return { ...item, updatedAt: iso };
    if (contentFingerprint(old) !== contentFingerprint(item)) return { ...item, updatedAt: iso };
    return { ...item, updatedAt: item.updatedAt || old.updatedAt };
  });
}

export interface MergeOptions {
  now: Date;
  /** 回收站墓碑：key → 删除时间（毫秒）。比条目时间新的墓碑算「真删了」 */
  tombstones?: Map<string, number>;
}

export interface MergeResult {
  items: any[];
  /** 两边都改过、只能留一份的条目（调用方留档 + 提示） */
  conflicts: string[];
  /** 被墓碑挡下的远端条目（同样是冲突信号） */
  revived: string[];
}

/**
 * 磁盘现状（remote）与本机待写（local）合并。
 *
 * 优先级：墓碑 > 更新的 updatedAt > 本机；
 * 顺序：沿用本机顺序，远端独有的追加在尾部（队列顺序不因同步而乱跳）。
 */
export function mergeReviewItems(
  local: readonly any[],
  remote: readonly any[],
  opts: MergeOptions
): MergeResult {
  const tombstones = opts.tombstones ?? new Map<string, number>();
  const conflicts: string[] = [];
  const revived: string[] = [];
  const out: any[] = [];

  const index = (arr: readonly any[]): Map<string, any> => {
    const m = new Map<string, any>();
    for (const it of arr) {
      const k = itemKey(it);
      if (k && !m.has(k)) m.set(k, it);
    }
    return m;
  };
  const localMap = index(local);
  const remoteMap = index(remote);

  const deletedAt = (key: string): number | undefined => tombstones.get(key);
  const isBuried = (key: string, item: any): boolean => {
    const t = deletedAt(key);
    return t !== undefined && updatedMs(item) <= t;
  };

  const keys: string[] = [];
  for (const k of localMap.keys()) keys.push(k);
  for (const k of remoteMap.keys()) if (!localMap.has(k)) keys.push(k);

  for (const key of keys) {
    const l = localMap.get(key);
    const r = remoteMap.get(key);
    const buriedL = l ? isBuried(key, l) : false;
    const buriedR = r ? isBuried(key, r) : false;
    if (r && buriedR && !l) revived.push(key);
    if (!l && !r) continue;
    if (l && buriedL && !r) continue;
    if (!l) {
      if (!buriedR) out.push(r);
      continue;
    }
    if (!r || buriedR) {
      if (!buriedL) out.push(l);
      continue;
    }
    if (contentFingerprint(l) === contentFingerprint(r)) {
      out.push(updatedMs(r) > updatedMs(l) ? r : l);
      continue;
    }
    conflicts.push(key);
    out.push(updatedMs(r) > updatedMs(l) ? r : l);
  }

  return { items: out, conflicts, revived };
}
