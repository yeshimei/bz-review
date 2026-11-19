/* ============================================================
 * 复习数据目录口径（src/core/storage-dir.ts）
 *
 * 新装用户：库根 `bz-review/storage`（与 bz-reader 的 `bz-reader/storage` 同形制，
 * 不藏在 .obsidian 里，能被同步工具带走）。
 * 老用户：数据还在 `CONFIG/REVIEW/review.json`。启动时新目录空、老目录有数据，
 * 就自动指回老目录，绝不让用户升级后看到空面板。
 * ============================================================ */

export const DEFAULT_REVIEW_DIR = 'bz-review/storage';
export const LEGACY_REVIEW_DIR = 'CONFIG/REVIEW';

export interface StartupDirArgs {
  /** data.json 里读到的目录（可能为空） */
  configured: string;
  /** 新目录里有没有复习数据 */
  newHasData: boolean;
  /** 老目录里有没有复习数据 */
  legacyHasData: boolean;
}

/**
 * 启动时的目录裁定：只在新目录空、且用户没自己选过目录时才回落老目录。
 * 纯函数，读写盘留给调用方。
 */
export function startupStorageDir(args: StartupDirArgs): string {
  const configured = String(args.configured || '').trim();
  if (configured && configured !== DEFAULT_REVIEW_DIR) return configured;
  if (!args.newHasData && args.legacyHasData) return LEGACY_REVIEW_DIR;
  return configured || DEFAULT_REVIEW_DIR;
}
