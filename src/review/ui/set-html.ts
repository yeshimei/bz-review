/** HTML 字符串安全落容器：DOMParser 解析后逐节点 importNode（与 core/ui/modal 同款） */
export function setHtml(el: HTMLElement, html: string): void {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  el.replaceChildren(...Array.from(doc.body.childNodes, (n) => document.importNode(n, true)));
}
