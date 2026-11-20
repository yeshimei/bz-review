/**
 * Review 的命令借道 bz-reader 复习页签（2026-11-20）
 *
 * 用户在 Reader 设置里开了「书架内显示复习」后，那张复习界面已经嵌进 Reader
 * 的书架页签里。此时 Review 自己的「打开复习」命令再开一张原生页（带左侧栏）
 * 就是重复且割裂的——应当直接亮出 Reader 那条复习页签，那里挂着同一份面板。
 *
 * 这层只做「探测 + 给出打开回调」，不碰 OpenReviewPanel 的形态分支：
 *   · 门面用 typeof 守卫，老版本 Reader 没有 readerApi、或没开嵌入，一律返回
 *     null，调用方回退到原生页，行为与上线前一致；
 *   · 判定与 Reader 侧 readerApi.reviewEmbedded() 同源，不会出现「Reader 页签
 *     没开却让命令跳过去」的矛盾。
 *
 * 纯函数、无 obsidian 运行期依赖，单测直接跑。
 */

/** Reader 暴露在插件实例上的反向门面（形状只取本模块用到的两口） */
export interface ReaderEmbedApi {
  reviewEmbedded(): boolean;
  openReviewTab(): void;
}

/** 命令借道 Reader 复习页签时要做的事 */
export interface EmbeddedReviewRoute {
  openReviewTab(): void;
}

/** Reader 的插件 id（目录名可以改，id 不会） */
const READER_PLUGIN_ID = 'bz-reader';

/**
 * 探测 Reader 是否已把复习设成内嵌页，是则给出「打开 Reader 复习页签」的回调。
 *
 * 三道守卫缺一不可：没装 Reader、Reader 老版本没有 readerApi、门面方法写坏，
 * 任一不满足都返回 null，调用方照旧开原生页。最后才问 reviewEmbedded()——
 * 它读的是 Reader 自己的开关，和 Reader 画不画页签用的是同一份判据。
 */
export function embeddedReviewRoute(app: unknown): EmbeddedReviewRoute | null {
  const holder = (app as { plugins?: { plugins?: Record<string, unknown> } } | null)?.plugins?.plugins;
  const plugin = holder?.[READER_PLUGIN_ID] as { readerApi?: unknown } | undefined;
  const api = plugin?.readerApi as ReaderEmbedApi | undefined;
  if (!api) return null;
  if (typeof api.reviewEmbedded !== 'function' || typeof api.openReviewTab !== 'function') return null;
  if (!api.reviewEmbedded()) return null;
  return { openReviewTab: () => api.openReviewTab() };
}
