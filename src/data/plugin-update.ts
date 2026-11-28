/* ============================================================
 * Review · 插件更新检查（data/plugin-update.ts）
 *
 * 与 bz Reader 的 data/plugin-update 同一套口径（2026-11-22）：
 *   1. 默认自动查：启动后后台查一次，24 小时最多一次；
 *   2. 有更新就弹，每个新版本只弹一次；
 *   3. 失败静默：离线、被墙、清单坏了都不打扰用户；
 *   4. 只认 Release：GitHub 的 releases/latest 直链 + 码云 release API 兜底。
 *
 * 同一份缓存还供「试用码必须最新版」判定使用：试用码不是最新版就锁高级
 * 功能，拉不到最新版也锁并提示联网——两条产品线共用一个线上版本号。
 *
 * 不下载、不替换、不碰插件目录：只提醒，装不装由用户在 Obsidian 里完成。
 * ============================================================ */
import { requestUrl } from 'obsidian';
import { compareVersions } from '../core/version';
import { noteServerDateHeader } from './trusted-clock';

/** 自动检查的间隔：24 小时 */
export const UPDATE_CHECK_GAP_MS = 24 * 60 * 60 * 1000;

/** 后台检查的超时。拉不到不打扰任何人 */
const FETCH_TIMEOUT_MS = 4_000;

/** 本插件 id：清单里的 id 必须是它，防拿错仓库 */
const PLUGIN_ID = 'bz-review';

export const UPDATE_SOURCES = {
  /** GitHub latest 直链：版本随 Release 自动跟进，无 API 限流 */
  githubManifest: 'https://github.com/yeshimei/bz-review/releases/latest/download/manifest.json',
  /** 码云没有 latest/download，先查 release JSON 再取 assets 里的清单 */
  giteeApi: 'https://gitee.com/api/v5/repos/ntbl/bz-review/releases/latest',
} as const;

/** 本地状态键。带版本号：将来换结构时老状态自动作废 */
export const UPDATE_STATE_KEY = 'bz-review:update-check:v1';

export interface UpdateState {
  /** 上次成功查到版本的时间，0 = 从没查到过 */
  checkedAt: number;
  /** 已经弹过提醒的版本；空 = 没弹过 */
  notified: string;
  /** 上次成功拿到的线上版本号；空 = 从没拿到过 */
  latest: string;
}

export const EMPTY_UPDATE_STATE: UpdateState = { checkedAt: 0, notified: '', latest: '' };

/** 可注入的 HTTP：返回文本，失败返回 null（测试用它，不打真网络） */
export type UpdateHttp = (url: string, timeoutMs: number) => Promise<string | null>;

async function requestText(url: string, timeoutMs: number): Promise<string | null> {
  let timer: number | null = null;
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = window.setTimeout(() => resolve(null), timeoutMs);
    });
    const req = requestUrl({ url, method: 'GET', throw: false }).then((resp) => {
      if (!resp || resp.status < 200 || resp.status >= 300) return null;
      /* 更新检查每天都会联网，顺带把服务器时间灌进可信时钟：
         这是「本地时间被调过」的第二条校准通道，不额外发请求。 */
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

let http: UpdateHttp = requestText;

/** 换 HTTP 实现（测试隔离）；传 null 恢复真实请求 */
export function _setUpdateHttpForTests(fn: UpdateHttp | null): void {
  http = fn ?? requestText;
}

/** 从一份 manifest 文本里取版本号；不是本插件的清单 / 坏 JSON 一律 null */
export function versionFromManifest(text: string | null): string | null {
  if (!text) return null;
  try {
    const m = JSON.parse(text) as { id?: unknown; version?: unknown };
    if (m?.id !== PLUGIN_ID) return null;
    if (typeof m.version !== 'string') return null;
    const v = m.version.trim();
    return v || null;
  } catch {
    return null;
  }
}

/** 码云 release JSON 里清单资产的下载地址；缺了返回 null */
export function giteeManifestUrl(json: string | null): string | null {
  if (!json) return null;
  try {
    const assets = (JSON.parse(json) as { assets?: unknown } | null)?.assets;
    if (!Array.isArray(assets)) return null;
    const hit = (assets as Array<{ name?: unknown; browser_download_url?: unknown }>).find(
      (a) => a?.name === 'manifest.json',
    );
    const url = hit?.browser_download_url;
    return typeof url === 'string' && url.trim() ? url.trim() : null;
  } catch {
    return null;
  }
}

/** 拉线上最新版本：GitHub 主源，失败切码云；两条都不通返回 null */
export async function fetchLatestVersion(timeoutMs = FETCH_TIMEOUT_MS): Promise<string | null> {
  try {
    const gh = versionFromManifest(await http(UPDATE_SOURCES.githubManifest, timeoutMs));
    if (gh) return gh;
    const release = await http(UPDATE_SOURCES.giteeApi, timeoutMs);
    const url = giteeManifestUrl(release);
    if (!url) return null;
    return versionFromManifest(await http(url, timeoutMs));
  } catch {
    return null;
  }
}

/** 24 小时节流：没查过、或距上次成功查到已经满 24 小时 */
export function shouldCheck(state: UpdateState, now: number): boolean {
  /* `since < 0` = 记录时刻在未来（系统时间被调到过未来 / 手改过 checkedAt）：
     当成「已过期」重查，不能让它把更新检查永久冻住。 */
  if (!state.checkedAt) return true;
  const since = now - state.checkedAt;
  return since < 0 || since >= UPDATE_CHECK_GAP_MS;
}

/** 线上比当前新才算有更新；本机版本更高（自测构建）不提示 */
export function hasUpdate(current: string, latest: string): boolean {
  const c = String(current || '').trim();
  const l = String(latest || '').trim();
  if (!c || !l) return false;
  return compareVersions(l, c) > 0;
}

/** 这个版本还没弹过才提示 */
export function shouldNotify(state: UpdateState, latest: string): boolean {
  return !!String(latest || '').trim() && state.notified !== String(latest).trim();
}

/** 解析本地状态：任何坏数据都回退到空状态，不让一份脏 JSON 挡住检查 */
export function parseUpdateState(raw: unknown): UpdateState {
  if (raw === null || raw === undefined || raw === '') return { ...EMPTY_UPDATE_STATE };
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return { ...EMPTY_UPDATE_STATE };
    }
  }
  if (!obj || typeof obj !== 'object') return { ...EMPTY_UPDATE_STATE };
  const p = obj as Partial<UpdateState>;
  return {
    checkedAt: typeof p.checkedAt === 'number' && p.checkedAt > 0 ? p.checkedAt : 0,
    notified: typeof p.notified === 'string' ? p.notified : '',
    latest: typeof p.latest === 'string' ? p.latest.trim() : '',
  };
}

export function readUpdateState(): UpdateState {
  try {
    return parseUpdateState(window.localStorage.getItem(UPDATE_STATE_KEY));
  } catch {
    return { ...EMPTY_UPDATE_STATE };
  }
}

/** 写本地状态。存不下不算错误——隐私模式里退化成每次启动重新查 */
export function writeUpdateState(state: UpdateState): void {
  try {
    window.localStorage.setItem(
      UPDATE_STATE_KEY,
      JSON.stringify({ checkedAt: state.checkedAt, notified: state.notified, latest: state.latest }),
    );
  } catch {
    /* 存不下：本次仍然可用 */
  }
}

/**
 * 拿「线上最新版」，试用判定与更新提醒共用。
 *
 * 24 小时内成功查过直接用缓存；否则重拉。拉不到时回退上次拿到的版本，
 * 从没拿到过才返回 null（调用方按「需要联网确认」处理）。
 * 并发调用共用同一个 Promise，不把两个 CDN 各刷两遍。
 */
let latestInflight: Promise<string | null> | null = null;

export function ensureLatestVersion(now = Date.now()): Promise<string | null> {
  if (latestInflight) return latestInflight;
  const state = readUpdateState();
  /* 缓存有效期同样要防「未来时间」：since < 0 时缓存视为失效，重拉。
     否则 checkedAt 被顶到未来后，线上版本永远用旧缓存，试用码的版本门失效。 */
  const since = now - state.checkedAt;
  if (state.latest && since >= 0 && since < UPDATE_CHECK_GAP_MS) {
    return Promise.resolve(state.latest);
  }
  latestInflight = (async () => {
    const latest = await fetchLatestVersion();
    if (!latest) return state.latest || null;
    writeUpdateState({ checkedAt: Date.now(), notified: state.notified, latest });
    return latest;
  })().finally(() => {
    latestInflight = null;
  });
  return latestInflight;
}
