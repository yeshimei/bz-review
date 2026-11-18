/* ============================================================
 * 视觉隐藏的可访问文本（src/core/ui/sr-text.ts）
 *
 * Obsidian 把 aria-label / title 变成悬停气泡——指针一移入就冒。要给纯图标控件
 * 补读屏名字，正确做法是塞一段视觉隐藏的文本子节点，而不是挂那两个属性。
 * 本文件是这一个做法的唯一出口，组件工厂都从这里取。
 * ============================================================ */

/** 视觉隐藏的 span：读屏读得到，肉眼不见，不触发悬停气泡。 */
export function srText(text: string): HTMLSpanElement {
  const span = createEl('span');
  span.className = 'bzrv-sr-only';
  span.textContent = text;
  return span;
}

/** 把一段文本作为可访问名挂到控件上（追加隐藏子节点）。 */
export function withSrText<T extends HTMLElement>(el: T, text: string | undefined): T {
  if (text) el.appendChild(srText(text));
  return el;
}
