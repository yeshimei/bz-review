/**
 * i18n 入口（src/i18n/index.ts）
 *
 * 纯核心在 `./strings`（不 import obsidian，纯渲染零件与测试可直接用）；
 * 这里只补两件需要宿主的事：读 Obsidian 的界面语言、按设置初始化。
 *
 * 为什么拆两道：`settings-page-pure` 这类「只吃参数、吐字符串」的零件一旦
 * 拉进 obsidian，测试就得挂 mock；而宿主探测又确实只有入口层该做。
 */
import { getLanguage } from 'obsidian';
import { resolveLocale, resolvePurchaseChinese, setLocale, type LanguagePref, type Locale } from './strings';

export * from './strings';

/** 宿主当前的界面语言代码，读不到给空串 */
export function hostLanguageCode(): string {
  try {
    return String(getLanguage() ?? '');
  } catch {
    return '';
  }
}

/* 购买分流要的原始信号：用户偏好 + 宿主原始语言码。界面 locale 只有 zh/en
   两档（繁体折成 zh），不能拿它判国内外，所以这里单独记住原始码。 */
let languagePref: LanguagePref = 'auto';
let hostCodeRaw = '';

/** 偏好 + 宿主语言 → 实际界面语言（插件 onload 调一次） */
export function initLocale(pref: LanguagePref, hostCode?: string | null): Locale {
  languagePref = pref;
  hostCodeRaw = String(hostCode ?? '');
  const next = resolveLocale(pref, hostCode);
  setLocale(next);
  return next;
}

/**
 * 购买分流用：是不是简体中文用户。
 * 手动选中文走国内、选英文走海外；auto 看宿主原始码是不是真简体。
 */
export function isChinesePurchase(): boolean {
  return resolvePurchaseChinese(languagePref, hostCodeRaw);
}
