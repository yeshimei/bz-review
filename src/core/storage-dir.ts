/* ============================================================
 * 复习数据目录口径（src/core/storage-dir.ts）
 *
 * 数据目录固定为库根 `bz-review/storage`（与 bz-reader 的 `bz-reader/storage`
 * 同形制，不藏在 .obsidian 里，能被同步工具带走）。
 * 插件未发布，不做老目录（CONFIG/REVIEW）兼容回落。
 * ============================================================ */

export const DEFAULT_REVIEW_DIR = 'bz-review/storage';
