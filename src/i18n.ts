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

export type Lang = 'zh' | 'en';

export function currentLang(): Lang {
  try {
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
