/**
 * review.json 的形态与跨端合并（批 1 地基，纯函数）。
 *
 * 形态刻意**保持不变**（还是纯数组），只在条目上加 `updatedAt`，版本号与
 * 写入时间放到旁挂的 review-meta.json。理由：旧版插件读到 `{items:[…]}` 会
 * 当成空数组，接着任何一次落盘就把整个计划清空——两台设备版本不一致时这条
 * 路非常真实。宁可少一点形式上的整齐，也不能让「回退一个版本」变成数据事故。
 *
 * 为什么合并要这么保守：宁可多留一份 `.CONFLICT` 副本、多弹一句提示，也不能
 * 静默把另一台设备刚复习完的记录抹掉——社区里「卡片凭空消失」是最劝退的一类事故。
 *
 * 时间戳只盖在**真正改过的条目**上（见 stampChangedItems）。要是每次落盘给全员盖章，
 * 本机的旧副本就会永远显得比另一台新，改动方向被彻底掩盖。
 */

/** 数据结构版本（写在 review-meta.json；review.json 本身仍是数组，旧版插件照读） */
export const REVIEW_SCHEMA_VERSION = 2;

/** 旁挂元数据：版本号 + 最后一次写入时间 */
export interface ReviewMeta {
  schema: number;
  updatedAt: string;
}

export function reviewMeta(now: Date): ReviewMeta {
  return { schema: REVIEW_SCHEMA_VERSION, updatedAt: now.toISOString() };
}

/** loadItems 派生、不落盘的运行时字段（比对内容时必须剔除，否则一次列表刷新就算全员改动） */
const RUNTIME_FIELDS = ['file', 'isCompleted', 'isOverdue', 'isMissing', 'currentStage', 'totalStages'] as const;
type RuntimeField = typeof RUNTIME_FIELDS[number];

/** 落盘条目的通用形态。旧版/脏数据字段可能缺失、值类型不定，故值一律 unknown。
 *  只在此文件内部使用：调用方各自有更精确的类型（ReviewItem 等），传进来时按 unknown 收窄。 */
type ReviewRecord = Record<string, unknown>;

/** unknown → 键值表（非对象按空表处理，调用方据此安全读属性） */
function asRecord(value: unknown): ReviewRecord {
  return value && typeof value === 'object' ? (value as ReviewRecord) : {};
}

/** 身份字段（id/filePath）→ 字符串。只对基础类型取值，脏对象不当身份（避免 '[object Object]' 假键）。 */
function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  return '';
}

/** 剥掉运行时字段（写盘白名单口径，单源在这里） */
export function stripRuntime<T>(item: T): Omit<T, RuntimeField> {
  const out: ReviewRecord = {};
  for (const [k, v] of Object.entries(asRecord(item))) {
    if ((RUNTIME_FIELDS as readonly string[]).includes(k)) continue;
    out[k] = v;
  }
  return out as Omit<T, RuntimeField>;
}

/** 条目身份：优先 id（同一条目改名后仍是它），退回 filePath */
export function itemKey(item: unknown): string {
  const r = asRecord(item);
  const id = textOf(r.id).trim();
  if (id) return id;
  return textOf(r.filePath).trim();
}

/** 深度排序键，去掉键顺序差异造成的「假改动」 */
function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return (value as unknown[]).map(canonicalValue);
  if (value && typeof value === 'object') {
    const out: ReviewRecord = {};
    const src = value as ReviewRecord;
    for (const k of Object.keys(src).sort()) out[k] = canonicalValue(src[k]);
    return out;
  }
  return value;
}

/** 内容指纹：剔除运行时字段与 updatedAt 后比较（updatedAt 本身不是内容） */
export function contentFingerprint(item: unknown): string {
  const body: ReviewRecord = { ...asRecord(stripRuntime(item ?? {})) };
  delete body.updatedAt;
  return JSON.stringify(canonicalValue(body));
}

function updatedMs(item: unknown): number {
  const v = asRecord(item).updatedAt;
  const t =
    typeof v === 'string' || typeof v === 'number'
      ? new Date(v).getTime()
      : v instanceof Date
        ? v.getTime()
        : 0;
  return Number.isFinite(t) ? t : 0;
}

/**
 * 条目键 → 内容指纹。合并的「基准」就是上一次读盘时算出的这张表：
 * 有了它才知道「另一边到底动没动」，而不是只看「两边现在不一样」。
 */
export function fingerprintsOf(items: readonly unknown[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const it of items) {
    const k = itemKey(it);
    if (k && !m.has(k)) m.set(k, contentFingerprint(it));
  }
  return m;
}

/**
 * 解析磁盘原文（已 JSON.parse 的对象）：
 * - 裸数组 → 旧版，items 原样；
 * - `{items:[...]}` → 新版；
 * - 其它形态 → broken（调用方留档后自行决定，不在这里造数据）。
 *
 * items 用 unknown[]：调用方按自己的精确类型（ReviewItem）收窄，不把 any 泄漏出去。
 */
export interface ParsedReviewFile {
  items: unknown[];
  /** 磁盘上是旧版裸数组（读取照常，下次写入升级） */
  legacyArray: boolean;
  /** 既不是数组也不是带 items 的对象：当坏档处理，但不擅自覆盖 */
  broken: boolean;
}

export function parseReviewFile(raw: unknown): ParsedReviewFile {
  if (Array.isArray(raw)) return { items: raw as unknown[], legacyArray: true, broken: false };
  if (raw && typeof raw === 'object' && Array.isArray((raw as ReviewRecord).items)) {
    return { items: (raw as ReviewRecord).items as unknown[], legacyArray: false, broken: false };
  }
  return { items: [], legacyArray: false, broken: true };
}

/** 写盘用的数组形态：剥运行时字段，别的原样（含逐条 updatedAt） */
export function serializeReviewItems(items: readonly unknown[]): ReviewRecord[] {
  return items.map((i) => asRecord(stripRuntime(i)));
}

/**
 * 只给内容真变了的条目盖 updatedAt。
 *
 * 老数据没有 updatedAt → 视为「未知时间」，一旦与磁盘不同就盖戳；
 * 与磁盘一模一样的条目保留原时间戳（这样另一台设备的改动才判得出新旧）。
 */
export function stampChangedItems(next: readonly unknown[], disk: readonly unknown[], now: Date): ReviewRecord[] {
  const iso = now.toISOString();
  const diskByKey = new Map<string, unknown>();
  for (const it of disk) {
    const k = itemKey(it);
    if (k && !diskByKey.has(k)) diskByKey.set(k, it);
  }
  return next.map((item) => {
    const r = asRecord(item);
    const old = diskByKey.get(itemKey(item));
    if (!old) return { ...r, updatedAt: iso };
    if (contentFingerprint(old) !== contentFingerprint(item)) return { ...r, updatedAt: iso };
    return { ...r, updatedAt: r.updatedAt || asRecord(old).updatedAt };
  });
}

export interface MergeOptions {
  now: Date;
  /** 回收站墓碑：key → 删除时间（毫秒）。比条目时间新的墓碑算「真删了」 */
  tombstones?: Map<string, number>;
  /**
   * 上次读盘时的内容指纹（key → 指纹，见 `fingerprintsOf`）。
   *
   * 没有它就只能比「两边现在一不一样」——本机刚改的那条必然和盘上旧值不同，
   * 于是每次评级都被判成「别的设备改过」，弹出警告并留一份 .bak（真机实测事故）。
   * 给了基准才能分清：盘上还是老样子（只有本机动过，不算冲突）、盘上变了但本机没动
   * （采用远端）、两边都变了（这才是冲突）。
   */
  base?: ReadonlyMap<string, string>;
}

export interface MergeResult {
  items: ReviewRecord[];
  /** 两边都改过、只能留一份的条目（调用方留档 + 提示） */
  conflicts: string[];
  /** 被墓碑挡下的远端条目（同样是冲突信号；本机这次自己删的不算，见 selfDeleted） */
  revived: string[];
}

/**
 * 磁盘现状（remote）与本机待写（local）合并。
 *
 * 优先级：墓碑 > 更新的 updatedAt > 本机；
 * 顺序：沿用本机顺序，远端独有的追加在尾部（队列顺序不因同步而乱跳）。
 */
export function mergeReviewItems(
  local: readonly unknown[],
  remote: readonly unknown[],
  opts: MergeOptions
): MergeResult {
  const tombstones = opts.tombstones ?? new Map<string, number>();
  const conflicts: string[] = [];
  const revived: string[] = [];
  const out: ReviewRecord[] = [];

  const index = (arr: readonly unknown[]): Map<string, unknown> => {
    const m = new Map<string, unknown>();
    for (const it of arr) {
      const k = itemKey(it);
      if (k && !m.has(k)) m.set(k, it);
    }
    return m;
  };
  const localMap = index(local);
  const remoteMap = index(remote);

  /* 墓碑既可能按 id 记，也可能按 filePath 记（回收站存的是路径）——
     两边都要查，否则「删掉的条目」与「另一台设备的副本」永远碰不上面。 */
  const deletedAt = (key: string, item: unknown): number | undefined => {
    let best: number | undefined;
    const r = asRecord(item);
    for (const k of [key, textOf(r.filePath), textOf(r.id)]) {
      if (!k) continue;
      const t = tombstones.get(k);
      if (t !== undefined && (best === undefined || t > best)) best = t;
    }
    return best;
  };
  const isBuried = (key: string, item: unknown): boolean => {
    const t = deletedAt(key, item);
    return t !== undefined && updatedMs(item) <= t;
  };

  /**
   * 这一条是不是**本次**本机自己删掉的。
   *
   * 移出计划的动作序是：读盘 → 删条目 → 写回收站墓碑 → 写回。写回时盘上还留着那条，
   * 本机已经不是它了，墓碑又是刚刚盖的——只按「盘上有、本机没有、墓碑更新」判断，
   * 同一台机器的删除会被判成「别的设备想复活它」，每移出一条就弹一次冲突警告、
   * 留一份 .bak（2026-11-19 真机事故，截图里的「在别的设备上也被改过（1 条）」）。
   * 基准（`fingerprintsOf` 那次读盘的结果，见 MergeOptions.base）里本来就有这条，
   * 说明它是在这一个事务里被本机删掉的，不算远端冲突；基准里没有、盘上却冒出来的
   * 那份副本才真的是远端动静。
   */
  const selfDeleted = (key: string): boolean => !!opts.base?.has(key);

  const keys: string[] = [];
  for (const k of localMap.keys()) keys.push(k);
  for (const k of remoteMap.keys()) if (!localMap.has(k)) keys.push(k);

  for (const key of keys) {
    const l = localMap.get(key);
    const r = remoteMap.get(key);
    const buriedL = l ? isBuried(key, l) : false;
    const buriedR = r ? isBuried(key, r) : false;
    if (r && buriedR && !l && !selfDeleted(key)) revived.push(key);
    if (!l && !r) continue;
    if (l && buriedL && !r) continue;
    if (!l) {
      if (!buriedR) out.push(asRecord(r));
      continue;
    }
    if (!r || buriedR) {
      if (!buriedL) out.push(asRecord(l));
      continue;
    }
    const fpL = contentFingerprint(l);
    const fpR = contentFingerprint(r);
    if (fpL === fpR) {
      out.push(asRecord(updatedMs(r) > updatedMs(l) ? r : l));
      continue;
    }
    /* 两边内容不同，未必是冲突：先问基准——盘上这一条还是上次读到的样子，
       说明只有本机动过（最常见的路径：用户刚评完这条）；反过来本机没动、
       盘上变了，说明是另一台设备的改动，直接采用远端。两条都不成立才是真冲突。 */
    const baseFp = opts.base?.get(key);
    if (baseFp !== undefined) {
      if (fpR === baseFp) {
        out.push(asRecord(l));
        continue;
      }
      if (fpL === baseFp) {
        out.push(asRecord(r));
        continue;
      }
    }
    conflicts.push(key);
    out.push(asRecord(updatedMs(r) > updatedMs(l) ? r : l));
  }

  return { items: out, conflicts, revived };
}
