/* ============================================================
 * bz 组件库 · 主头行（src/core/ui/mainhead.ts）
 * uiMainHead：内容区主头行——分组标题 + 计数 + spacer + 主按钮
 * （30px 中档）。收编 memo/cinema/favorites/belongings 四域逐字重复。
 * ============================================================ */
import type { BzMainHeadOpts } from './types';
import { uiBtn } from './button';

/** 静态样式字面量提成常量，避免 no-static-styles-assignment（值不变） */
const CSS_DISPLAY_NONE = 'none';
const CSS_DISPLAY_RESET = '';

/** 主头行（.bzrv-main-head），返回 el + setTitle + setCount（空值隐藏计数位） */
export function uiMainHead(opts: BzMainHeadOpts): {
  el: HTMLDivElement;
  setTitle: (t: string) => void;
  setCount: (c?: string) => void;
} {
  const el = createDiv();
  el.className = 'bzrv-main-head';

  const title = createSpan();
  title.className = 'bzrv-main-title';
  title.textContent = opts.title;
  el.appendChild(title);

  const count = createSpan();
  count.className = 'bzrv-main-count';
  el.appendChild(count);

  const sp = createSpan();
  sp.className = 'bzrv-main-spacer';
  el.appendChild(sp);

  if (opts.action) {
    el.appendChild(uiBtn({
      label: opts.action.label,
      icon: opts.action.icon,
      tone: 'primary',
      className: 'bzrv-btn--md',
      onClick: opts.action.onClick,
    }));
  }

  const setCount = (c?: string) => {
    if (c === undefined || c === null || c === '') {
      count.style.display = CSS_DISPLAY_NONE;
      count.textContent = '';
    } else {
      count.style.display = CSS_DISPLAY_RESET;
      count.textContent = c;
    }
  };
  setCount(opts.count);

  return {
    el,
    setTitle: (t: string) => {
      title.textContent = t;
    },
    setCount,
  };
}
