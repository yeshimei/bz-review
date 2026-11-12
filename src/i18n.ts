/**
 * 界面语言（src/i18n.ts）
 *
 * 轻量双语：中文（基准）与英文。Obsidian 的界面语言存在 localStorage.language，
 * 没有则看 moment 的 locale：
 *   t('开始复习', 'Start review')  —— 运行时取值，切换语言后重开视图即生效。
 *
 * 复习面板内部的存量文案目前仍是中文直写（从 bz 搬来，量大），新写的入口、
 * 命令与设置页走这里；双语化按模块逐步收口。
 */
import { moment } from 'obsidian';
import { tryGetSettings } from './core/settings-provider';

export type Lang = 'zh' | 'en';

export function currentLang(): Lang {
  try {
    /* 插件设置里的语言优先（auto = 跟随 Obsidian）。
       原来这里只读 localStorage，设置页那个「语言」下拉改了没有任何效果——
       是个纯死字段，用户选了 en 界面还是中文。 */
    const want = String((tryGetSettings() as { language?: string } | null)?.language ?? 'auto').toLowerCase();
    if (want === 'zh' || want === 'en') return want;
    const stored = window.localStorage.getItem('language');
    if (stored) return String(stored).toLowerCase().startsWith('zh') ? 'zh' : 'en';
    const ml = String((moment as unknown as { locale?: () => string })?.locale?.() || 'zh-cn').toLowerCase();
    return ml.startsWith('zh') ? 'zh' : 'en';
  } catch {
    return 'zh';
  }
}

export function isEnglish(): boolean {
  return currentLang() === 'en';
}

/** 双语取值 */
export function t(zh: string, en: string): string {
  return isEnglish() ? en : zh;
}
