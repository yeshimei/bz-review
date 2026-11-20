/* ============================================================
 * bz · 从 bz Reader 取内容（review/reader-source.ts）
 *
 * 2026-11-21 架构口径：**复习相关的一切都归 Review，Reader 只留两个接口**。
 * 这里是 Review 侧对那两个接口的探测与类型：
 *   · reviewCatalog(bookId?)   列内容（书清单 / 某本书的划线 + 章节目录）
 *   · reviewChapterText(...)   读某章正文
 *
 * 三道守卫缺一不可：Reader 没装、装了但没加载完、老版本没有这两个方法。
 * 任一不满足都返回 null，由调用方说人话（提示升级 Reader），绝不抛错。
 * ============================================================ */
import type { PickChapter, PickMark } from './source-pick';

/** 书清单上的一行 */
export interface ReaderCatalogBook {
  id: string;
  title: string;
  author: string;
  markCount: number;
}

/** 选中某本书之后的详情：划线全量 + 章节目录 */
export interface ReaderCatalogBookDetail {
  id: string;
  title: string;
  author: string;
  marks: PickMark[];
  chapters: PickChapter[];
}

/** `reviewCatalog()` 不带书 id 给书清单；带了就给该书的详情 */
export interface ReaderCatalog {
  books: ReaderCatalogBook[];
  book?: ReaderCatalogBookDetail;
}

/** Reader 暴露在插件实例上的内容接口（Review 反向调用） */
export interface ReaderReviewApi {
  reviewCatalog(bookId?: string): Promise<ReaderCatalog>;
  reviewChapterText(bookId: string, chapterIndex: number): Promise<string>;
}

/** Reader 的插件 id（目录名可以改，id 不会） */
export const READER_PLUGIN_ID = 'bz-reader';

/**
 * 找 Reader 的内容接口。
 *
 * 和 bz-review 读 Reader 的 AI 配置同一套探法：`app.plugins.plugins['bz-reader']`，
 * 拿不到就按「老版本 Reader」降级。
 */
export function findReaderReviewApi(app: unknown): ReaderReviewApi | null {
  const holder = (app as { plugins?: { plugins?: Record<string, unknown> } } | null)?.plugins?.plugins;
  const plugin = holder?.[READER_PLUGIN_ID] as { readerApi?: unknown } | undefined;
  const api = plugin?.readerApi as ReaderReviewApi | undefined;
  if (!api) return null;
  if (typeof api.reviewCatalog !== 'function' || typeof api.reviewChapterText !== 'function') return null;
  return api;
}
