/**
 * i18n 纯核心（src/i18n/strings.ts）
 *
 * 只做「当前语言 + 取词 + 切换通知」，**不 import obsidian**——纯渲染零件
 * （如设置页 aboutBar / 插件组）要能直接引用，测试也能在 node 环境里跑。
 * 依赖宿主的语言探测在 `./index.ts`（hostLanguageCode / initLocale）。
 *
 * 语言包是 TS 对象、编译进包体：不做运行时读盘/fetch，插件必须离线可用。
 * 中文是基准包与类型真源，英文包漏一条 `tsc` 直接红。
 */
import { EN } from './en';
import { ZH, type MsgKey } from './zh';

export type { MsgKey };

export type Locale = 'zh' | 'en';

/** 支持的语言，固定顺序（设置页按这个顺序铺按钮） */
export const LOCALES: readonly Locale[] = ['zh', 'en'];

/** 每种语言用它自己的语言标注自己（不走 t()） */
export const LOCALE_NAMES: Record<Locale, string> = {
  zh: '中文',
  en: 'English',
};

const PACKS: Record<Locale, Record<MsgKey, string>> = {
  zh: ZH,
  en: EN,
};

/** 语言包本体（测试逐包遍历用；运行期取文案用 `t`） */
export const PACK_OF: Record<Locale, Record<MsgKey, string>> = PACKS;

/** 用户偏好：跟随宿主，或手动指定 */
export type LanguagePref = 'auto' | Locale;

/** 这个值是不是我们支持的语言（`auto` 不算；设置落盘校验用） */
export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
}

/**
 * 当前语言。模块级状态而不是传参：文案散在几十个渲染器里，逐个加语言
 * 参数会把每个签名都改一遍。
 */
let current: Locale = 'zh';

const listeners = new Set<(l: Locale) => void>();

/**
 * Obsidian 语言代码 → 我们支持的语言。
 *
 * 没有对应包的语言一律退英文——英文是国际用户的兜底。
 */
export function normalizeLocale(code: string | null | undefined): Locale {
  const raw = String(code ?? '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
  if (!raw) return 'en';
  return raw.split('-')[0] === 'zh' ? 'zh' : 'en';
}

/** 当前界面语言 */
export function locale(): Locale {
  return current;
}

/**
 * 宿主原始语言码是不是**真简体中文**（购买分流用，与界面语言档位脱钩）。
 *
 * Review 只有 zh / en 两档界面，`normalizeLocale` 把 zh-TW 这类繁体折成 zh，
 * 界面仍是简体——但繁体用户没有 QQ / 微信支付，购买该走 Creem。所以付款
 * 判定不能看折叠后的界面语言，得看宿主给的原始码：简体系列（zh / zh-CN /
 * zh-Hans）算简体，繁体（地区 tw/hk/mo 或脚本 Hant）、英文、空都不算。
 */
export function isSimplifiedHostCode(code: string | null | undefined): boolean {
  const raw = String(code ?? '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
  if (!raw) return false;
  if (raw.split('-')[0] !== 'zh') return false;
  if (/^zh-(tw|hk|mo)\b/.test(raw) || raw.includes('hant')) return false;
  return true;
}

/**
 * 购买分流用的「是不是简体中文用户」。
 *
 * 手动选了语言就按手动的来：选中文走国内、选英文走海外；跟随宿主时看原始
 * 语言码是不是真简体。这样繁体宿主的 auto 用户看到简体界面、购买却走海外，
 * 与 bz Reader 的 isChineseUI() 口径一致。
 */
export function resolvePurchaseChinese(pref: LanguagePref, hostCode?: string | null): boolean {
  if (pref !== 'auto') return pref === 'zh';
  return isSimplifiedHostCode(hostCode);
}

/** 切换界面语言。返回「是否真的变了」——调用方据此决定要不要重绘。 */
export function setLocale(next: Locale): boolean {
  const code = normalizeLocale(next);
  if (code === current) return false;
  current = code;
  for (const fn of [...listeners]) {
    try {
      fn(code);
    } catch {
      /* 一个订阅者抛错不该让其余订阅者收不到通知 */
    }
  }
  return true;
}

/** 订阅语言变化，返回退订函数 */
export function onLocaleChange(fn: (l: Locale) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * 取一条文案。
 *
 * 两层防御：key 不在当前包里 → 用中文包（基准，永远有）；再没有就原样
 * 返回 key。参数缺失时保留 `{name}` 占位符。
 */
export function t(key: MsgKey, params?: Record<string, string | number>): string {
  const pack = PACKS[current] ?? ZH;
  const raw = pack[key] ?? ZH[key] ?? String(key);
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = params[name];
    return v === undefined || v === null ? whole : String(v);
  });
}

/** 偏好 + 宿主语言 → 实际界面语言（手动选择永远优先；读不到宿主语言退回中文） */
export function resolveLocale(pref: LanguagePref, hostCode?: string | null): Locale {
  if (pref !== 'auto') return normalizeLocale(pref);
  const code = String(hostCode ?? '').trim();
  return code ? normalizeLocale(code) : 'zh';
}

/** 评级短名（忘了 / 困难 / 一般 / 简单）——评级条、结果卡、统计共用这一个口径 */
const RATING_KEYS = {
  again: 'rating.again',
  hard: 'rating.hard',
  good: 'rating.good',
  easy: 'rating.easy',
} as const;

export function ratingName(r: string): string {
  return t(RATING_KEYS[r as keyof typeof RATING_KEYS] ?? 'rating.good');
}

/** 当前语言的 BCP-47 标签（日期、数字格式化用） */
export function localeTag(): string {
  return current === 'zh' ? 'zh-CN' : 'en';
}

/**
 * 更新日志用哪种语言。全仓唯一例外：日志每次发版手写，只做中英两版。
 */
export function changelogLang(): 'zh' | 'en' {
  return current === 'zh' ? 'zh' : 'en';
}
