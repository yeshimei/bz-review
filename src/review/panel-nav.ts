/**
 * 头栏图标导航语义（2026-11-20）
 *
 * 用户口径：点图标「直接打开对应页面」。此前那套 toggle 很别扭——在某内置页点
 * 另一个图标，因为 `this.page` 非空，结果先回主列表，再点一次才打开目标页。
 * 现在统一成：点哪个进哪个，幂等；只有点「复习」页签（home）才回主列表。
 *
 * 搜索（filter）：点一下恒定展开搜索面板，连点不会再收起、也不清输入过的条件
 * （清条件是筛选区里「清除」那颗的事，和点图标无关）。
 *
 * 纯函数、无 obsidian 运行期依赖，单测直接跑。
 */

/** 头栏能点的页面；home = 顶部「复习」页签（回主列表）。与 ui.page 的类型对齐。 */
export type PanelPage = 'home' | 'settings' | 'stats' | 'achv' | 'arch' | 'books' | 'manager' | 'trash';

/** 点图标后的目标页：除 home 回主列表外，都是某个内置页 */
export type PanelTarget = Exclude<PanelPage, 'home'> | null;

/**
 * 图标点击后的目标页。
 *
 * `current` 只作语义留档（点同页也停在该页、不 toggle），不参与分支——保留它是
 * 为了让调用方一眼看清「从哪一页点过来」，以及将来若要恢复 toggle 有迹可循。
 */
export function nextPanelPage(_current: string | null | undefined, clicked: PanelPage): PanelTarget {
  return clicked === 'home' ? null : (clicked as Exclude<PanelPage, 'home'>);
}

/** 点搜索图标后的固定状态：回主列表 + 展开搜索面板 */
export const FILTER_CLICK_STATE = { page: null, filterOpen: true } as const;
