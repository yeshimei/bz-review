/**
 * 通用工具函数（Q3.js window.__utils 移植 + 原脚本内联工具）
 * 行为与 Q3.js 逐字一致（spec「Q3 core 层逐行提取」）。
 */
import { moment } from 'obsidian';
import { getApp } from './app';
import { pad2, relTime as baseRelTime, stripMdExt, localDayKey, stripTitleMarks } from './ui/str';
import { notice } from './notice';
import { t } from '../i18n/strings';

/**
 * unknown → 安全文本。primitive 直接 String（与 String(v) 逐字等价）；
 * 对象是显式 toString()（与 String(obj) 同语义，但不触发 no-base-to-string 的「默认 [object Object] 化」告警）。
 * null/undefined → 空串，与既有 `String(v ?? '')` 行为一致。
 */
function toText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  return (v as { toString(): string }).toString(); // object / symbol / function
}

/** 可 catch 的 Promise（app.openUrl / electron.shell.openExternal 的异步 rejection 兜底） */
type Catchable = { catch(onRejected: () => void): unknown };
function isCatchable(v: unknown): v is Catchable {
  return !!v && typeof (v as { catch?: unknown }).catch === 'function';
}

/** 注入 app 上 openUrl 的最小形状（openUrl 可能同步返回 void，也可能返回 Promise） */
interface UrlOpener {
  openUrl(url: string): unknown;
}

/** 桌面端 window.require('electron') 的最小形状 */
interface ElectronWindow extends Window {
  require?: (module: string) => { shell?: { openExternal(url: string): unknown } };
}

// ==================== YAML 标量转义单源（AS1/C27/一致#1 三域收编） ====================

/**
 * YAML 双引号标量转义核心（纯串进纯串出）：先 `\` 后 `"` 再换行折空格。
 * 顺序铁律：必须先转义反斜杠——否则值含 `\` 时产出 `\\"` 之类被 YAML 当转义序列
 * 解读，值读取时变形或整体解析失败（C27/AS1 同根）。
 * 三域收编（一致#1）：clipbook save 写侧（恒包裹）、auto-summary parser 重建
 * （恒包裹 + unquote 反转义对齐）、cinema 影片模板（条件包裹）此前各持一份私有实现，
 * 收编为本原语 + 两个形态出口。
 */
export function escapeYamlText(s: string): string {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\r\n]+/g, ' ');
}

/**
 * YAML 恒包裹形态：值一律输出为 `"…"` 双引号标量。
 * clipbook 写侧契约（url/author/site/summary/date 标量与 tags 数组项）与
 * auto-summary frontmatter 重建共用——读侧 unquote 反转义同源对齐（AS1）。
 */
export function yamlEscapeQuoted(v: unknown): string {
  return `"${escapeYamlText(toText(v))}"`;
}

/**
 * YAML 条件包裹形态（cinema 影片模板契约）：换行先行单行化（C3），
 * 仅含 YAML 特殊字符或空格时才双引号包裹，否则裸输出（保持既有序列化策略，
 * 不与恒包裹强并——一致#1 修法：两出口一原语）。
 */
export function yamlScalarOf(val: unknown): string {
  let s = String(val);
  if (/[\r\n]/.test(s)) s = s.replace(/[ \t]*[\r\n]+[ \t]*/g, ' ');
  if (/[:"\-#[\]{}|>'?]/.test(s) || s.includes(' ')) {
    return '"' + escapeYamlText(s) + '"';
  }
  return s;
}

/**
 * 双引号标量反转义（写侧 escapeYamlText 的逆）：`\\` → `\`、`\"` → `"`。
 * 仅处理写侧会产出的两形转义，未知转义序列（`\n` 等字面）原样保留——
 * 写侧把真换行折成空格、不产出 `\n` 转义，字面 `\n` 两字符经 `\\` 转义往返不变形（AS1）。
 */
export function unescapeYamlText(s: string): string {
  return s.replace(/\\(.)/g, (m: string, c: string) => (c === '"' || c === '\\' ? c : m));
}

/** HTML 转义 */
export function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (m) => {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    if (m === '"') return '&quot;';
    return '&#39;';
  });
}

/** pad2(n)：两位数补零（月/日/时/分/秒）；实现单源 core/ui/str（零依赖区，render 纯层
 *  白名单仅 str），此处转发保持既有 import 路径兼容（pomodoro/reading-report 等消费） */
export { pad2 };


/** 睡眠 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

// ==================== Q3 工具（window.__utils 逐字移植） ====================

/** generateId(prefix)：prefix-时间戳-随机6位 */
export function generateId(prefix?: string): string {
  prefix = prefix || 'item';
  return prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

/** extractUrlAndDisplay(c)：解析 markdown 链接 / 裸 URL，返回 {url, display} */
export function extractUrlAndDisplay(c: string): { url: string | null; display: string } {
  const m1 = c.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
  if (m1) return { url: m1[2], display: m1[1] };
  const m2 = c.match(/(https?:\/\/\S+)/i);
  if (m2) {
    const u = m2[1], d = c.replace(u, '').trim();
    return { url: u, display: d || u };
  }
  return { url: null, display: c };
}

/** formatFileSize(bytes)：K/M 缩写，0/空返回 null */
export function formatFileSize(bytes: number | null | undefined): string | null {
  if (!bytes) return null;
  const kb = bytes / 1024;
  return kb < 1024 ? kb.toFixed(0) + 'K' : (kb / 1024).toFixed(2) + 'M';
}

/**
 * formatRelativeTime(date, now)：相对时间格式化（moment）
 * 未来时间→YYYY-MM-DD [HH:mm]；今天内基础档收编 core/ui/str relTime 单源
 * （刚刚/N 分钟前/N 小时前，带空格——2026-09 跨域说法拍板）；
 * 昨天/前天/周几/MM-DD/YYYY-MM-DD 为 moment 增强档保留（行为不回退）。
 */
export function formatRelativeTime(date: Date | string | number, now: Date = new Date()): string {
  const target = moment(date);
  if (!target.isValid()) return t('util.badDate');

  // 判断原始输入是否包含时间部分（仅当传入字符串时）
  let hasExplicitTime = true; // 默认有时间
  if (typeof date === 'string') {
    hasExplicitTime = !/^\d{4}-\d{2}-\d{2}$/.test(date.trim());
  }

  const nowMoment = moment(now);
  const diffSeconds = nowMoment.diff(target, 'seconds');

  function shouldShowTime(): boolean {
    const timeStr = target.format('HH:mm');
    if (timeStr !== '00:00') return true;
    return hasExplicitTime;
  }

  // 未来时间
  if (diffSeconds < 0) {
    return target.format(shouldShowTime() ? 'YYYY-MM-DD HH:mm' : 'YYYY-MM-DD');
  }

  // 1分钟内
  if (diffSeconds < 60) return t('util.justNow');

  // 今天内（N 分钟前 / N 小时前）：转发 core/ui/str relTime 基础档（跨域单源说法）；
  // 传 now 时刻保证测试/回放注入的时钟不旁路
  if (target.isSame(nowMoment.startOf('day'), 'day')) {
    return baseRelTime(target.format('YYYY-MM-DD HH:mm:ss'), now.getTime());
  }

  // 昨天 / 前天
  const yesterdayStart = moment(now).subtract(1, 'days').startOf('day');
  const beforeYesterdayStart = moment(now).subtract(2, 'days').startOf('day');
  if (target.isSame(yesterdayStart, 'day')) {
    return shouldShowTime() ? `昨天 ${target.format('HH:mm')}` : t('util.yesterday');
  }
  if (target.isSame(beforeYesterdayStart, 'day')) {
    return shouldShowTime() ? `前天 ${target.format('HH:mm')}` : t('util.beforeYesterday');
  }

  // 本周内
  const weekStart = moment(now).startOf('week');
  if (target.isSameOrAfter(weekStart, 'day') && target.isBefore(nowMoment.startOf('day'))) {
    return shouldShowTime() ? `${target.format('ddd')} ${target.format('HH:mm')}` : target.format('ddd');
  }

  // 当年内
  const isThisYear = target.year() === nowMoment.year();
  if (isThisYear) {
    return shouldShowTime() ? target.format('MM-DD HH:mm') : target.format('MM-DD');
  }

  // 跨年
  return shouldShowTime() ? target.format('YYYY-MM-DD HH:mm') : target.format('YYYY-MM-DD');
}

/** DEFAULT_PLATFORM_MAP：默认平台映射（7 项） */
export const DEFAULT_PLATFORM_MAP: { host: string; name: string }[] = [
  { host: 'daily.zhihu.com', name: '知乎日报' },
  { host: 'zhuanlan.zhihu.com', name: '知乎专栏' },
  { host: 'zhihu.com', name: '知乎' },
  { host: 'guokrapp.guokr.com', name: '果壳' },
  { host: 'xiaoheihe.cn', name: '小黑盒' },
  { host: 'douban.com', name: '豆瓣' },
  { host: 'mp.weixin.qq.com', name: '微信公众号' },
];

/** getPlatformName(url, customMap)：按 host 匹配平台名，支持 host 后缀与 keyword */
export function getPlatformName(
  url: string | null | undefined,
  customMap?: { host?: string; keyword?: string; name: string }[]
): string | null {
  if (!url) return null;
  const map: { host?: string; keyword?: string; name: string }[] = customMap || DEFAULT_PLATFORM_MAP;
  try {
    const host = new URL(url).hostname.toLowerCase();
    for (const entry of map) {
      if (entry.host && (host === entry.host || host.endsWith('.' + entry.host))) return entry.name;
      if (entry.keyword && host.includes(entry.keyword)) return entry.name;
    }
  } catch { /* 无效 URL 返回 null */ }
  return null;
}

/** getCurrentNoteInfo()：当前打开笔记 {path, name} 或 null */
export function getCurrentNoteInfo(): { path: string; name: string } | null {
  const f = getApp().workspace.getActiveFile();
  return f ? { path: f.path, name: f.basename } : null;
}

/** getCurrentCursorPosition()：当前光标位置 {line, ch} 或 null */
export function getCurrentCursorPosition(): { line: number; ch: number } | null {
  const ed = getApp().workspace.activeEditor?.editor;
  return ed ? { line: ed.getCursor().line, ch: ed.getCursor().ch } : null;
}

/** 字节级比对（Syncthing 冲突止血「写前比对」共用：长度或任一字节不同即不等） */
export function bytesEqual(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ==================== 通用化收编（全域扫描 2026-09：各域重复实现上收） ====================

/** localDayKey / stripTitleMarks：实现单源 core/ui/str（零依赖区，A9/C3 审查收编——
 *  review/stats 等纯数据层为保 node 直测引 utils 会拖 obsidian 面，正典故落 str）；
 *  此处转发保持既有 import 路径兼容（stripMdExt / pad2 同款范式）。 */
export { localDayKey, stripMdExt, stripTitleMarks };

/** cmpZh(a, b)：中文拼音序比较器（localeCompare 'zh'；条目排序收口） */
export function cmpZh(a: string, b: string): number {
  return String(a || '').localeCompare(String(b || ''), 'zh');
}

/** parseLocalDay(s)：日期串前缀 'YYYY-MM-DD…' → 本地当日 0 点毫秒（非法返回 null）。
 *  刻意不走 new Date(str)：'YYYY-MM-DD' 会被按 UTC 解析，时区西移处周边界漂移一天。
 *  单源收编（home 深审 A1）：原宿主 home/weekly.ts（零 UI 消费的死模块），recap/aggregate
 *  跨域顶层拉它曾构成全仓唯一的域间顶层静态环（home/river → recap/aggregate → home/weekly，
 *  违反 ADR-0002）——下沉重单源后 recap 改引此处，环断；日期串工具与 localDayKey 同居。 */
export function parseLocalDay(s: unknown): number | null {
  const m = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})/.exec(toText(s));
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return new Date(y, mo - 1, d).getTime();
}

/** isUnderFolder(folder, path)：目录边界判定——path 恰为 folder 或位于其下（递归语义；蓝本 review/watch.ts） */
export function isUnderFolder(folder: string, path: string): boolean {
  const f = (folder || '').trim().replace(/\/+$/, '');
  if (!f) return false;
  return path === f || path.startsWith(f + '/');
}

/** hash31(str)：h*31 稳定字符串散列（>>>0；站标派色/派样式共用口径，charCodeAt 逐单元版） */
export function hash31(str: string): number {
  let h = 0;
  const t = String(str || '');
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

/** debounce(fn, ms)：尾触防抖，返回带 cancel() 的防抖函数（新收敛能力；既有手写定时器形态各异，暂不批量替换） */
export function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): T & { cancel(): void } {
  let t: number | undefined;
  const wrapped = (...args: Parameters<T>) => {
    if (t !== undefined) window.clearTimeout(t);
    t = window.setTimeout(() => {
      t = undefined;
      fn(...args);
    }, ms);
  };
  (wrapped as T & { cancel(): void }).cancel = () => {
    if (t !== undefined) {
      window.clearTimeout(t);
      t = undefined;
    }
  };
  return wrapped as T & { cancel(): void };
}

/** yieldToMainThread(timeoutMs)：让出主线程（requestIdleCallback 优先 + 超时兜底，退化 window.setTimeout(0)；蓝本 checkup/run.ts） */
export function yieldToMainThread(timeoutMs = 200): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve();
      return;
    }
    const idleWindow = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
    if (typeof idleWindow.requestIdleCallback === 'function') {
      idleWindow.requestIdleCallback(() => resolve(), { timeout: timeoutMs });
    } else window.setTimeout(resolve, 0);
  });
}

// ==================== 敏感操作防护（encrypt×password-vault 双域收口，全域扫描 2026-09 批次 G） ====================

/** 安全随机密码（crypto.getRandomValues 拒绝采样，与旧密码本同款） */
export function secureRandomPassword(length: number, charset: string): string {
  const n = charset.length;
  if (!(length > 0) || n === 0) return '';
  const LIMIT = Math.floor(0x100000000 / n) * n;
  let pwd = '';
  while (pwd.length < length) {
    const buf = new Uint32Array(length - pwd.length);
    crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length && pwd.length < length; i++) {
      if (buf[i] >= LIMIT) continue;
      pwd += charset.charAt(buf[i] % n);
    }
  }
  return pwd;
}

/** 复制敏感内容 + 60s 自动清空剪贴板（模块级单定时器：双域并存共用一支，后复制重置前清空） */
const CLIPBOARD_CLEAR_DELAY_MS = 60_000;
/** 剪贴板兜底 textarea 的隐藏样式（一次性内联样式，非主题静态样式） */
const CLIPBOARD_FALLBACK_CSS = 'position:fixed;opacity:0';
let clipboardClearTimer: number | null = null;

/** 取消未触发的自动清空（卸载清理用，防插件禁用后定时器仍写剪贴板） */
export function cancelClipboardClear(): void {
  if (clipboardClearTimer !== null) {
    window.clearTimeout(clipboardClearTimer);
    clipboardClearTimer = null;
  }
}

/** 对已写入敏感内容的剪贴板布防 60s 自动清空 */
export function armClipboardClear(): void {
  if (clipboardClearTimer !== null) window.clearTimeout(clipboardClearTimer);
  clipboardClearTimer = window.setTimeout(() => {
    clipboardClearTimer = null;
    try {
      void navigator.clipboard.writeText('').catch(() => {});
    } catch {
      /* 尽力而为 */
    }
  }, CLIPBOARD_CLEAR_DELAY_MS);
}

/** 复制敏感内容并布防自动清空 */
export function copySensitiveText(text: string): Promise<void> {
  try {
    return navigator.clipboard.writeText(text).then(() => armClipboardClear());
  } catch (e) {
    return Promise.reject(e instanceof Error ? e : new Error(toText(e)));
  }
}

/**
 * 复制敏感内容（含降级兜底）+ 自动清空（issue 365 收口单源）。
 * encrypt/ui（日记正文复制）与 password-vault（面板复制 + quick-pick 快速取密）
 * 原各持一份逐字雷同的「copySensitiveText 失败 → textarea+execCommand 选中法」兜底，
 * 收编为本函数；两域一律走这里，域内不再自留副本。
 * 行为口径（三份旧实现逐字等价）：
 * - navigator.clipboard.writeText 成功 → true（60s 清空随 copySensitiveText 布防）；
 * - 失败（权限拒绝/非安全上下文/clipboard 缺失）→ textarea 选中法兜底，
 *   execCommand('copy') 成功同样布防 60s 自动清空，返回其布尔结果；
 * - 兜底亦抛错 → false（不布防清空）。
 */
export async function copySensitiveWithFallback(text: string): Promise<boolean> {
  try {
    await copySensitiveText(text);
    return true;
  } catch {
    // 降级：textarea 选中法
    try {
      const ta = createEl('textarea');
      ta.value = text;
      ta.style.cssText = CLIPBOARD_FALLBACK_CSS;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      if (ok) armClipboardClear();
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * 打开外部链接（系统浏览器）单源（审查 P3 一致#14 收口）：
 * memo/ui openItem、favorites/ui openExternal、knowledge/ui _openExternal 三份私有副本
 * 收编至此，域内不再自留副本。行为口径（与 favorites 版逐字等价——三份中最完整的一份）：
 * - app.openUrl(url)（Obsidian 原生，桌面/移动均可用）成功 → 完成；
 * - openUrl 缺失/同步抛错（故意不带 ?.，缺失须落 TypeError 才进兜底链）→ electron shell.openExternal；
 *   issue 473 补：openUrl 的**异步 rejection** 同样落兜底链（此前只接同步抛错，
 *   Windows 打不开 file:/// 时 reject 无人接 → Uncaught (in promise)，用户只见 0x2 无提示）；
 * - 无 electron（移动端/jsdom）→ window.open 兜底（favorites F14：不再静默）；
 *   openExternal 的异步 rejection 同口径落 window.open；
 * - 全链失败 → 人话提示（error）。
 * app 由调用方注入（memo 传 M.appRef，favorites 传 appOf()，knowledge 传 getApp()），
 * 本函数不自取——调用时机多在面板闭包里，appRef 与面板生命周期一致更稳。
 */
export function openExternalUrl(app: unknown, url: string): void {
  try {
    const r = (app as UrlOpener).openUrl(url);
    if (isCatchable(r)) {
      r.catch(() => {
        if (!openViaElectron(url)) openViaWindow(url);
      });
      return;
    }
    return;
  } catch { /* 落 electron 兜底 */ }
  if (!openViaElectron(url)) openViaWindow(url);
}

/** electron shell.openExternal 一级兜底：已发起返回 true；openExternal 的异步
 *  rejection 落 window.open（返回的 true 只代表「已发起」）。无 electron → false。 */
function openViaElectron(url: string): boolean {
  try {
    const ew = window as ElectronWindow;
    const electron = ew.require && ew.require('electron');
    if (electron && electron.shell) {
      const p = electron.shell.openExternal(url);
      if (isCatchable(p)) p.catch(() => openViaWindow(url));
      return true;
    }
  } catch { /* 落 window.open 兜底 */ }
  return false;
}

/** window.open 末级兜底（favorites F14：失败不再静默） */
function openViaWindow(url: string): void {
  try {
    const w = window.open(url, '_blank');
    if (w) return;
  } catch { /* 环境不支持（jsdom 等）落提示 */ }
  notice('无法打开链接，请复制到浏览器打开', 'error');
}
