/* ============================================================
 * 样式作用域锚点（src/core/scope.ts）
 *
 * Obsidian 把所有插件的 styles.css 注入同一张样式表，选择器写裸了就会影响
 * 宿主与其它插件。构建期（scripts/css-scope.mjs）已把每条规则前缀成
 * `[data-bzrv] …`，本模块负责把 `data-bzrv` 落到**每一棵自有 DOM 树的根**上。
 *
 * 两条路径：
 *   1. 显式 markOwned：所有 body 直挂的弹层、面板、通知容器，在 appendChild
 *      之前调用——同步生效，不会出现「先渲染成无样式、下一帧才补上」的闪烁；
 *   2. installScopeGuard：MutationObserver 兜底，捕捉内联 HTML、第三方插入等
 *      漏网节点，按 id / class 的 bzrv- 前缀认领。
 *
 * 判定规则：根节点的 id 以 bzrv- 开头，或 class 里有 bzrv- 前缀的类。
 * ============================================================ */

/** 构建期前缀使用的属性名，与 scripts/css-scope.mjs 的 ANCHOR 必须一致 */
export const SCOPE_ATTR = 'data-bzrv';

/** 给一棵自有 DOM 树的根挂作用域锚点（幂等） */
export function markOwned(el: Element | null | undefined): void {
  if (!el || el.nodeType !== 1) return;
  if (!el.hasAttribute(SCOPE_ATTR)) el.setAttribute(SCOPE_ATTR, '');
}

/** 这个元素看起来属于本插件吗（按 id / class 前缀判断） */
export function isOwnedNode(el: Element): boolean {
  if (el.nodeType !== 1) return false;
  if (el.hasAttribute(SCOPE_ATTR)) return true;
  const id = el.id || '';
  if (id.startsWith('bzrv-')) return true;
  const cls = typeof el.className === 'string' ? el.className : '';
  return /(^|\s)bzrv-/.test(cls);
}

/**
 * 兜底守卫：观察 body 直接子节点的新增，给认得出来的自有节点补锚点。
 * 返回卸载函数（main.onunload 调用）。
 */
export function installScopeGuard(body: HTMLElement | null = typeof document === 'undefined' ? null : document.body): () => void {
  if (!body || typeof MutationObserver === 'undefined') return () => {};

  const mo = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of Array.from(m.addedNodes)) {
        if (node.nodeType !== 1) continue;
        const el = node as Element;
        if (isOwnedNode(el)) markOwned(el);
      }
    }
  });
  mo.observe(body, { childList: true });
  return () => mo.disconnect();
}
