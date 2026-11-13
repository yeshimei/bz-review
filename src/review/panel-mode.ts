/**
 * 主界面打开方式（reviewPanelMode）
 *
 * 两种形态共用同一套面板 DOM（#bzrv-mask / #bzrv-popup），区别只在宿主：
 *  - native：注册成 Obsidian 标签页（ItemView），面板撑满标签页内容区，跟着工作区
 *    一起保存/恢复，能分屏、能被「关闭标签页」正常关掉；
 *  - popup：挂在 body 上的自绘浮层（拆分前的唯一形态），压在整个工作区之上。
 *
 * 默认 native（用户 2026-11-13 拍板）：Obsidian 用户对「插件开了一个标签页」的预期
 * 比「屏幕中央弹出一块东西」更稳——前者不挡正在看的笔记，切库/切工作区也不会卡住。
 *
 * 纯函数，无 obsidian 依赖：面板宿主判断与分支都在这里收口，单测直接跑。
 */

/** 视图类型 id（main.ts 的 registerView 与 index.ts 的 getLeavesOfType 共用） */
export const REVIEW_VIEW_TYPE = 'bzrv-review-panel';

export type PanelMode = 'native' | 'popup';

/**
 * 读设置；缺省/脏值一律按 native。
 * 迁移语义：老用户 data.json 里没有这个字段，第一次升级就落到原生页——
 * 不需要写迁移代码，也不需要 prompt。
 */
export function panelModeOf(settings?: unknown): PanelMode {
  const raw = (settings as { reviewPanelMode?: unknown } | null | undefined)?.reviewPanelMode;
  return raw === 'popup' ? 'popup' : 'native';
}
