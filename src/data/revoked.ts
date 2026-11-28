/* ============================================================
 * bz Review · 激活码停用名单（src/data/revoked.ts）
 *
 * 激活码是**离线签名**的：签名只证明「这枚码是作者发的」，证明不了
 * 「它现在还有效」。退款、公开分享、倒卖出去的码，签名全都合法。
 * 停用名单补的就是这一段——作者把码号写进公开的 docs/revoked.json，
 * 插件联网取回来，命中就降级。
 *
 * 三条硬约束（与 bz Reader 同口径）：
 *   1. **只存码号，不存码原文**：名单是公开文件，贴原文等于把码公开。
 *      老码（BZR1，payload 里没有 id）退回存码的摘要。
 *   2. **必须验签**：否则代理 / 机场 / 公共 WiFi 能塞一份假名单，把所有
 *      付费用户打回基础版——那是比盗版更糟的事故。验签不过一律当「没拉到」。
 *   3. **拉不到就放行**：离线用户本来就不该被这道门卡住。代价是「屏蔽
 *      两个域名」就能绕过，这是离线授权的天花板，不假装能补。
 *
 * ── 名单装两种码号（2026-11-22 定） ─────────────────────────────
 * Review 能激活两类码，所以它的名单要同时认这两种号：
 *   · `REV-2026-0001`  Review 自己发的码（BZP2 前缀）
 *   · `BZR-AF-2026-0176` 赞助人 / 专属定制码（BZR2 前缀，与 Reader 通用）
 *
 * 赞助人码一枚能在两个插件都激活，**封它得在两边名单各写一次**：
 * Review 这份管 Review 的降级，Reader 那份管 Reader 的降级。只写一边
 * 不是「封了一半」，是「看起来封了、其实另一个插件照常用」——比不封更糟。
 * `scripts/revoke-license.mjs` 看到 `BZR-` 开头会提醒这件事。
 *
 * 本地只存两样东西：
 *   · `code`——当前已被判死的那枚码原文。断网重启也能立刻降级，并且
 *     它让这枚码「贴不回来」（激活入口先查这里，不必等网络）。
 *   · `at`——见过的最大名单版本。防重放：拿一份几天前的旧名单回来，
 *     被封的码会复活，所以旧名单直接丢掉。
 * 名单内容本身不落盘：每次启动重拉。
 * ============================================================ */
import { requestUrl } from 'obsidian';
import { b64urlToBytes, parseLicense, verifySignedBytes } from './license';
import { noteServerDateHeader } from './trusted-clock';

/** 两条下载通道：GitHub raw 主源、码云 raw 国内直连 */
export const REVOKED_URLS: readonly string[] = [
  'https://raw.githubusercontent.com/yeshimei/bz-review/master/docs/revoked.json',
  'https://gitee.com/ntbl/bz-review/raw/master/docs/revoked.json',
];

/** 本地状态键。带版本号：将来换结构时老状态自动作废 */
export const REVOKED_STATE_KEY = 'bz-review:revoked:v1';

/**
 * 自动核对的间隔（与 Reader 同口径）：只在启动时查一次，**24 小时内不重复**。
 *
 * 反复启停 Obsidian、切库、插件重载都不该把两个 CDN 当接口刷。用户想立刻
 * 生效就点设置页那枚「核对」——那条路 force，不走这个间隔。
 */
export const REVOKED_CHECK_GAP_MS = 24 * 60 * 60 * 1000;

/** 激活时等名单的上限。激活是用户主动等待，可以比后台宽 */
export const REVOKED_ACTIVATE_TIMEOUT_MS = 8_000;

/** 后台拉取的超时。拉不到不打扰任何人 */
const FETCH_TIMEOUT_MS = 4_000;

/** 老码摘要长度（sha256 十六进制前 16 位 = 64 bit，够防撞） */
const HASH_LEN = 16;

/** 名单结构。`sig` 覆盖固定拼接串，不签 JSON 原文（换行与键序都会漂） */
export interface RevokedDoc {
  v: 1;
  updatedAt: number;
  ids: string[];
  hashes: string[];
  sig: string;
}

export type RevokedHttp = (url: string, timeoutMs: number) => Promise<string | null>;

/** clear = 名单拉到了且没有这枚码；hit = 命中；unknown = 没拉到 / 验签不过 / 旧名单；skipped = 24 小时内已经查过 */
export type RevokedVerdict = 'clear' | 'hit' | 'unknown' | 'skipped';

interface State {
  /** 已被判死的码原文；空 = 没有 */
  code: string;
  /** 见过的最大名单版本（updatedAt） */
  at: number;
  /** 上次成功拉到名单的时刻（0 = 从没成功过）：24 小时节流用它 */
  checkedAt: number;
  /**
   * 这枚码被判死的时刻（0 = 没判死过）。与 `at` 不是一回事：
   * `at` 是名单版本号，用来防重放；这个才是「什么时候被停的」，
   * 探针要靠它算「封了几天了、还有几台在用」。
   */
  deadAt: number;
}

const EMPTY: State = { code: '', at: 0, checkedAt: 0, deadAt: 0 };

let cached: State | null = null;
let inflight: Promise<RevokedVerdict> | null = null;

/* ── 本地状态 ─────────────────────────────────────────────── */

function readState(): State {
  try {
    const raw = window.localStorage.getItem(REVOKED_STATE_KEY);
    if (!raw) return EMPTY;
    const o = JSON.parse(raw) as Partial<State> | null;
    return {
      code: typeof o?.code === 'string' ? o.code : '',
      at: typeof o?.at === 'number' && Number.isFinite(o.at) && o.at > 0 ? o.at : 0,
      checkedAt:
        typeof o?.checkedAt === 'number' && Number.isFinite(o.checkedAt) && o.checkedAt > 0
          ? o.checkedAt
          : 0,
      deadAt:
        typeof o?.deadAt === 'number' && Number.isFinite(o.deadAt) && o.deadAt > 0 ? o.deadAt : 0,
    };
  } catch {
    return EMPTY;
  }
}

function writeState(s: State): void {
  try {
    window.localStorage.setItem(REVOKED_STATE_KEY, JSON.stringify(s));
  } catch {
    /* 隐私模式 / 无 localStorage：本次会话内存里还有，写不进去不算错误 */
  }
}

function st(): State {
  if (!cached) cached = readState();
  return cached;
}

/** 在当前状态上改几个字段，四件套只在一处列，别每处手抄一遍 */
function stateWith(patch: Partial<State>): State {
  return { ...st(), ...patch };
}

/** 统一落盘：内存与 localStorage 一步不落 */
function commitState(next: State): void {
  cached = next;
  writeState(next);
}

/** 当前已被判死的码（同步，给 entitlement 的每帧判定用） */
export function revokedCode(): string {
  return st().code;
}

/** 见过的最大名单版本（0 = 从没拉到过） */
export function revokedSeenAt(): number {
  return st().at;
}

/** 上次成功核对名单的时刻（0 = 从没成功过） */
export function revokedCheckedAt(): number {
  return st().checkedAt;
}

/** 记下这枚码已停用。`at` 只往大里走，别被旧名单顶回去 */
export function markRevoked(code: string, at: number): void {
  const cur = st();
  const clean = code.trim();
  commitState(
    stateWith({
      code: clean,
      at: Math.max(at, cur.at),
      /* 同一枚码再判一次不刷新时刻：探针要的是「第一次被判死是什么时候」 */
      deadAt: cur.code === clean && cur.deadAt > 0 ? cur.deadAt : Date.now(),
    }),
  );
}

/** 解封（名单里已经没有这枚码了）：清掉码，但版本号留着防重放 */
export function clearRevoked(): void {
  if (!st().code) return;
  commitState(stateWith({ code: '', deadAt: 0 }));
}

/** 这枚码被判死的时刻（0 = 没判死过） */
export function revokedDeadAt(): number {
  return st().deadAt;
}

/* ── 解析与验签 ───────────────────────────────────────────── */

/**
 * 签名覆盖的固定串。两端必须一字不差，所以**不用 JSON 原文**——
 * 键序、缩进、换行只要有一处不同，验签就会永远过不去。
 * 两份数组各排一次序：作者手改名单时顺序无关。
 *
 * 前缀沿用 Reader 的 `bzr-revoked`：签名串只是两端约定，两个仓库共用
 * 同一份脚本逻辑（私钥不同，名单不可互换），改前缀只会多一处不一致的来源。
 */
export function revokedSignText(doc: Pick<RevokedDoc, 'v' | 'updatedAt' | 'ids' | 'hashes'>): string {
  /* 大小写也在这里抹平：作者手写名单时可能写小写，解析端会转成大写，
     两端各转一次才是同一个串——否则「名单写小写、签名照小写签」，
     验签时用大写重算就永远过不去。 */
  const ids = doc.ids.map((x) => x.trim().toUpperCase()).sort();
  const hashes = doc.hashes.map((x) => x.trim().toLowerCase()).sort();
  return ['bzr-revoked', String(doc.v), String(doc.updatedAt), ids.join(','), hashes.join(',')].join(
    '\n',
  );
}

/**
 * 码号形态：`REV-2026-0001`（Review 自己）或 `BZR-AF-2026-0176`（赞助人码）。
 *
 * 两种前缀都要认——认不出 `BZR-` 就等于赞助人码在 Review 里封不掉，
 * 而那恰好是唯一一种「一枚码两插件通用」的码。
 */
const ID_RE = /^(BZR|REV)-[A-Z0-9][A-Z0-9-]{2,39}$/;
const HASH_RE = /^[0-9a-f]{16,64}$/;

/**
 * 远端文本 → 名单。`null` = 整份不可用。
 *
 * 单条坏（码号格式不对 / 摘要不是十六进制）只丢那一条，不整份作废；
 * 空数组合法（真的没人被封）。`sig` 缺了整份不可用——没签名的名单
 * 一分钱都不值。
 *
 * 注意：丢包会改掉签名串（签名覆盖的是过滤后的列表），所以**名单里
 * 出现格式不对的码号时，整份验签必然失败**。脚本写进去的号都过
 * `ID_RE`，这条只在手改文件写错字时才会撞上——那种情况下失败是对的。
 */
export function parseRevoked(raw: unknown): RevokedDoc | null {
  let doc: unknown = raw;
  if (typeof raw === 'string') {
    try {
      doc = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
  const o = doc as Record<string, unknown>;
  if (o.v !== 1) return null;
  if (typeof o.updatedAt !== 'number' || !Number.isFinite(o.updatedAt) || o.updatedAt <= 0) return null;
  if (!Array.isArray(o.ids) || !Array.isArray(o.hashes)) return null;
  if (typeof o.sig !== 'string' || !o.sig) return null;

  const ids: string[] = [];
  for (const x of o.ids) {
    if (typeof x !== 'string') continue;
    const id = x.trim().toUpperCase();
    if (!ID_RE.test(id) || ids.includes(id)) continue;
    ids.push(id);
  }
  const hashes: string[] = [];
  for (const x of o.hashes) {
    if (typeof x !== 'string') continue;
    const h = x.trim().toLowerCase();
    if (!HASH_RE.test(h) || hashes.includes(h)) continue;
    hashes.push(h);
  }
  return { v: 1, updatedAt: o.updatedAt, ids, hashes, sig: o.sig };
}

/** 验签。任何异常都算「不过」，不能把「验不了」当成「验过了」 */
export async function verifyRevoked(doc: RevokedDoc): Promise<boolean> {
  try {
    const bytes = new TextEncoder().encode(revokedSignText(doc));
    return await verifySignedBytes(bytes, b64urlToBytes(doc.sig));
  } catch {
    return false;
  }
}

/** 码原文的 sha256 前 16 位：老码没有码号，只能按摘要封 */
export async function codeHash(code: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code.trim()));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, HASH_LEN);
}

/**
 * 这枚码在不在名单里。
 *
 * 新码按码号比（大小写不敏感）；BZR1 老码没有 id，退回摘要。
 * 名单里两条都没写时直接 false，连摘要都不用算。
 */
export async function revokedHit(code: string, doc: RevokedDoc): Promise<boolean> {
  const payload = parseLicense(code)?.payload;
  const id = typeof payload?.id === 'string' ? payload.id.trim().toUpperCase() : '';
  if (id) return doc.ids.includes(id);
  if (doc.hashes.length === 0) return false;
  return doc.hashes.includes(await codeHash(code));
}

/* ── 拉取 ─────────────────────────────────────────────────── */

/** `?t=` 破缓存：两个域名各自会缓存一份，旧名单会把已封的码救活 */
function bust(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;
}

async function requestText(url: string, timeoutMs: number): Promise<string | null> {
  let timer: number | null = null;
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = window.setTimeout(() => resolve(null), timeoutMs);
    });
    const req = requestUrl({ url, method: 'GET', throw: false }).then((resp) => {
      if (!resp || resp.status < 200 || resp.status >= 300) return null;
      /* 顺手校时：停用名单是激活时必经的联网请求，响应头的 Date 是
         不受本地系统时钟影响的真实时间。拿它把可信时间的锚点顶正，
         「激活前先把时间调早」就绕不过去了。拿不到也不影响名单判定。 */
      noteServerDateHeader(resp.headers);
      return resp.text;
    });
    return await Promise.race([req, timeout]);
  } catch {
    return null;
  } finally {
    if (timer !== null) window.clearTimeout(timer);
  }
}

let http: RevokedHttp = requestText;

/**
 * 两个源并发，都拿回来再挑。
 *
 * 不走「先回者胜」：停用名单的正确性比速度重要——若一个源被污染成旧名单
 * （或一份伪造的旧内容），先回者胜会把已封的码放出来。这里只认验签通过
 * 且 `updatedAt` 最大的那一份。
 */
async function pull(timeoutMs: number): Promise<RevokedDoc | null> {
  const texts = await Promise.all(
    REVOKED_URLS.map((u) => http(bust(u), timeoutMs).catch(() => null)),
  );
  let best: RevokedDoc | null = null;
  for (const text of texts) {
    if (text == null) continue;
    const doc = parseRevoked(text);
    if (!doc) continue;
    if (!(await verifyRevoked(doc))) continue;
    if (!best || doc.updatedAt > best.updatedAt) best = doc;
  }
  return best;
}

/* ── 对外 ─────────────────────────────────────────────────── */

/**
 * 拉一次名单并判定这枚码。**激活入口用它，不节流**。
 *
 * unknown 的语义是「这次没结论」，不是「这枚码有问题」：网络挂了、两个源
 * 都没回、验签不过、拿到的比本地见过的还旧——全都归这里。调用方按「必须
 * 联网」处理，但不要在界面上说「码无效」。
 */
export async function checkRevoked(
  code: string,
  timeoutMs = REVOKED_ACTIVATE_TIMEOUT_MS,
): Promise<RevokedVerdict> {
  const clean = code.trim();
  if (!clean) return 'unknown';

  const doc = await pull(timeoutMs);
  if (!doc) return 'unknown';

  const seen = revokedSeenAt();
  /* 旧名单：拿一份几天前的合法名单回来就能让已封的码复活，直接丢掉 */
  if (doc.updatedAt < seen) return 'unknown';

  /* 拉到可用的名单 = 这次核对成功：版本号与「上次核对时间」一起更新。
     24 小时节流只看 checkedAt，所以失败（网络/验签/旧名单）不会把下一次
     自动核对推迟一天。 */
  commitState(stateWith({ at: Math.max(seen, doc.updatedAt), checkedAt: Date.now() }));

  if (await revokedHit(clean, doc)) {
    markRevoked(clean, doc.updatedAt);
    return 'hit';
  }
  /* 名单里已经没有它了（作者解封）：本地标记要跟着清，否则解封也回不来 */
  if (revokedCode() === clean) clearRevoked();
  return 'clear';
}

/**
 * 自动核对（启动时调一次）。**24 小时内不重复**：成功拉到过名单就把
 * checkedAt 写下来，插件反复加载、切库、重载都不会再打 CDN。
 *
 * `force` 给设置页那枚「核对」按钮用：用户主动要最新结果，跳过 24 小时。
 * 返回值里的 `skipped` = 这 24 小时内已经查过，不是失败。
 */
export async function refreshRevoked(
  code: string,
  opts: { force?: boolean } = {},
): Promise<RevokedVerdict> {
  if (inflight) return inflight;
  const clean = code.trim();
  if (!clean) return 'unknown';

  const now = Date.now();
  if (!opts.force && now - revokedCheckedAt() < REVOKED_CHECK_GAP_MS) return 'skipped';

  inflight = (async () => {
    try {
      return await checkRevoked(clean, FETCH_TIMEOUT_MS);
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/* ── 测试 ─────────────────────────────────────────────────── */

/** 清空会话状态（**不动** localStorage：持久化用例要用它） */
export function _resetRevokedForTests(): void {
  cached = null;
  inflight = null;
  http = requestText;
}

/** 换掉 HTTP 通道（传 null 恢复生产实现） */
export function _setRevokedHttpForTests(fn: RevokedHttp | null): void {
  http = fn || requestText;
}
