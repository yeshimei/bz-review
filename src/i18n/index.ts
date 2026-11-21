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
import { resolveLocale, setLocale, type LanguagePref, type Locale } from './strings';

export * from './strings';

/** 宿主当前的界面语言代码，读不到给空串 */
export function hostLanguageCode(): string {
  try {
    return String(getLanguage() ?? '');
  } catch {
    return '';
  }
}

/** 偏好 + 宿主语言 → 实际界面语言（插件 onload 调一次） */
export function initLocale(pref: LanguagePref, hostCode?: string | null): Locale {
  const next = resolveLocale(pref, hostCode);
  setLocale(next);
  return next;
}
