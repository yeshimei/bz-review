/* ============================================================
 * 嵌入 bz-reader 时点宿主「复习」页签回主列表（review/embedded-home.ts）
 *
 * 独立 Review 的顶部「复习」页签走 bindPanelHead 的 home 分支回三列卡牌队列。
 * 嵌进 Reader 后那颗页签由宿主画、Review 自己的被 CSS 收起，于是点宿主页签时
 * 面板可能还停在数据/设置等内置页——这里补上那条缺失的返回路径。
 *
 * 只挂在宿主头栏那一颗页签上，cleanup 必须解绑（离开复习页后 Review 面板还在，
 * 宿主换页再点别的同名元素不该误触发）。纯 DOM 接线、无 obsidian 依赖。
 * ============================================================ */

/** bz-reader 书架头栏里的复习页签（data-act 是动作、data-p 是目标页） */
export const REVIEW_STUDY_TAB_SELECTOR = '[data-act="study"][data-p="review"]';

/**
 * 在宿主动作栏所在的头栏里找到复习页签，点击时回调 onHome；返回解绑函数。
 * 宿主结构变了（找不到头栏/页签）就安静返回空操作，不让嵌入流程崩掉。
 */
export function bindStudyReviewTab(actionsHost: HTMLElement, onHome: () => void): () => void {
  const head = actionsHost.parentElement;
  if (!head || typeof head.querySelector !== 'function') return () => {};
  const tab = head.querySelector<HTMLElement>(REVIEW_STUDY_TAB_SELECTOR);
  if (!tab) return () => {};
  const handler = (): void => onHome();
  tab.addEventListener('click', handler);
  return () => tab.removeEventListener('click', handler);
}
