/**
 * 原生目录选择器的纯逻辑（core/folder-pick-logic.ts，零宿主依赖，供 node 单测直测）。
 *
 * 2026-11-20 起目录弹窗换成 Obsidian 自己的 FuzzySuggestModal（仿 bz-reader 的
 * core/folder-pick.ts），这里只放与 DOM / Modal 无关的口径：项的标注、多选累加、提示文案。
 * Modal 本体在 folder-pick.ts，只能真机验。
 */

/** 库根的展示标签（vault 根在 Obsidian 里 path 为空串） */
export const ROOT_LABEL = '（库根目录）';

/** FuzzySuggestModal 每一项的可搜索文本：带当前 / 已选标注，标注也参与模糊匹配。 */
export function folderItemText(path: string, current: readonly string[], mode: 'single' | 'multi'): string {
  const label = path === '' ? ROOT_LABEL : path;
  if (mode === 'single' && current[0] === path) return `${label}（当前）`;
  if (mode === 'multi' && current.includes(path)) return `${label}（已选）`;
  return label;
}

/** 多选：点一个目录 = 已选则移除、未选则追加到末尾（保持选择顺序）。返回新数组，不改原数组。 */
export function togglePicked(selected: readonly string[], path: string): string[] {
  return selected.includes(path) ? selected.filter((p) => p !== path) : [...selected, path];
}

/** 搜索框占位提示：多选时告知可连续选、按 Esc 完成，并带出已选数量。 */
export function folderPickPlaceholder(mode: 'single' | 'multi', pickedCount: number): string {
  return mode === 'multi'
    ? pickedCount > 0
      ? `搜索目录… 已选 ${pickedCount} 个，按 Esc 完成`
      : '搜索目录… 可连续选，按 Esc 完成'
    : '搜索目录…';
}
