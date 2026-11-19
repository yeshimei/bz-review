/**
 * 设置行「窄屏拆两行」标记（ticket 128 / 133，ADR-0061）。
 *
 * 纯 DOM、零宿主依赖，单独成文件供 node 单测直测；settings-modal.ts 再导出保旧 import 路径。
 * 口径：组合控件（控件区 ≥2 子元素）或**单个但很宽的控件**（分段器 / 文本框 / 下拉）都要挂
 * .bzrv-setting-split，窄屏 CSS 才会把名称+描述与控件拆成两行；开关、数字框等窄控件保持原生单行。
 * :has() 不用（Obsidian 移动端 WebView 兼容性），由 JS 在 build 后遍历挂类。
 * 幂等；路径选择器行豁免，其移动端单行由 .bzrv-path-picker-setting-row 的兜底 CSS 保证。
 */

/** 单个就足以把名称列挤没的宽控件 */
const WIDE_CONTROL_SELECTOR =
  '.bzrv-segmented, input[type="text"], input[type="search"], input[type="url"], select, textarea';

export function markSettingSplitRows(container: HTMLElement): void {
  container.querySelectorAll('.setting-item').forEach((el) => {
    const row = el as HTMLElement;
    if (row.classList.contains('bzrv-path-picker-setting-row')) return;
    const ctl = row.querySelector('.setting-item-control');
    if (!ctl) return;
    const split = ctl.children.length >= 2 || !!ctl.querySelector(WIDE_CONTROL_SELECTOR);
    row.classList.toggle('bzrv-setting-split', split);
  });
}
