/* ============================================================
 * 照搬 reader 弹窗的强调色桥（src/review/ui/theme-accent.ts）
 *
 * 弹窗挂 body，不在面板容器里，拿不到面板的 --bzrv-accent。
 * 这里从 body 的计算样式读出档位色，打开弹窗时挂到 --bzs-accent，
 * CSS 里 var(--bzs-accent, 宿主色) 就能跟着设置页的强调色走。
 * ============================================================ */

export const ACCENT_VAR = '--bzs-accent';

export function shellAccentColor(
  doc: Document | undefined = typeof document === 'undefined' ? undefined : document,
): string {
  if (!doc?.body || typeof getComputedStyle !== 'function') return '';
  try {
    return String(getComputedStyle(doc.body).getPropertyValue('--bzrv-accent') ?? '').trim();
  } catch {
    return '';
  }
}
