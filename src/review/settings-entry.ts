/**
 * 「打开 Review 设置页」的分流入口（src/review/settings-entry.ts）
 *
 * 两条路，按 Reader 有没有把复习设成书架内嵌页来选：
 *   · 内嵌：用户在 Reader 的书架里用复习，设置页要落在**那个内嵌面板**上——
 *     先亮出 Reader 的复习页签（reviewApi.openReviewTab），它渲染时会把 Review
 *     面板 embedInto 进去；随后在同一个 UIManager 单例上 openSettings。
 *   · 独立：没有 Reader / 没开内嵌，直接在自己的面板上 openSettings（现有口径）。
 *
 * 内嵌页签是异步渲染的（Reader 那边 setViewState().then(revealLeaf)），所以亮出
 * 之后要轮询等面板真的挂进去；最多等 EMBED_WAIT_MS，超时就按当前形态开设置——
 * 面板没嵌进去时 openSettings 自然落在独立浮层上，不会点了没反应。
 *
 * 纯函数 + 依赖注入，不 import obsidian、不碰模块级单例，node 测试直接跑。
 */

/** 内嵌就绪的等待上限（超时按独立形态开设置） */
export const EMBED_WAIT_MS = 1000;
/** 轮询间隔：一帧多点 */
const POLL_MS = 40;

/** 分流结果，测试据此断言走的是哪条路 */
export type SettingsOpenRoute = 'embedded' | 'standalone';

/** 外部依赖（执行壳注入） */
export interface SettingsEntryDeps {
  /** Reader 内嵌复习页的借道回调；null = 没开内嵌 */
  route: { openReviewTab(): void } | null;
  /** 内嵌面板是否已经挂进 Reader 宿主 */
  embeddedReady(): boolean;
  /** 在面板单例上打开设置页（内嵌 / 独立都是同一个调用） */
  openSettings(): void;
  now(): number;
  sleep(ms: number): Promise<void>;
  maxWaitMs?: number;
}

/**
 * 分流并打开设置页；返回实际走的路。
 *
 * 没有内嵌时立即开（同步 path 也在 await 里，调用方统一 await 即可）。
 * 有内嵌时先亮出 Reader 复习页签，轮询等面板挂进去再开设置；超时按独立开。
 */
export async function openSettingsFromHost(deps: SettingsEntryDeps): Promise<SettingsOpenRoute> {
  const maxWait = deps.maxWaitMs ?? EMBED_WAIT_MS;

  if (!deps.route) {
    deps.openSettings();
    return 'standalone';
  }

  deps.route.openReviewTab();

  const started = deps.now();
  while (!deps.embeddedReady() && deps.now() - started < maxWait) {
    await deps.sleep(POLL_MS);
  }

  /* 无论嵌入就绪与否都开设置：面板单例此刻要么在 Reader 复习页签里（内嵌），
     要么还挂在 body 上（独立浮层）——两种都是用户能看见的设置面板。 */
  deps.openSettings();
  return deps.embeddedReady() ? 'embedded' : 'standalone';
}
