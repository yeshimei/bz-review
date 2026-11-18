/* ============================================================
 * bz 组件库 · 统计卡（src/core/ui/stat.ts）
 * uiStat：数字 + 标签统计卡（默认中性 / 语义 tone / --click 可点筛选）。
 * 收编 bookshelf/belongings 两份近似拷贝与 recap/home/review 简版。
 * ============================================================ */
import type { BzStatOpts } from './types';
import { uiIcon } from './icon';

/** 统计卡（.bzrv-stat） */
export function uiStat(opts: BzStatOpts): HTMLDivElement {
  const el = createDiv();
  const cls = ['bzrv-stat'];
  if (opts.tone) cls.push(`bzrv-stat--${opts.tone}`);
  if (opts.click) cls.push('bzrv-stat--click');
  el.className = cls.join(' ');

  const label = createSpan();
  label.className = 'bzrv-stat-label';
  if (opts.icon) label.appendChild(uiIcon(opts.icon));
  label.appendChild(document.createTextNode(opts.label));
  el.appendChild(label);

  const num = createSpan();
  num.className = 'bzrv-stat-num';
  num.textContent = String(opts.num);
  el.appendChild(num);

  if (opts.hint) {
    const hint = createSpan();
    hint.className = 'bzrv-stat-hint';
    hint.textContent = opts.hint;
    el.appendChild(hint);
  }

  if (opts.onClick) {
    // --click 档键盘可达（R11）：role=button + Tab 焦点 + Enter/Space 复用回调
    el.setAttribute('role', 'button');
    el.tabIndex = 0;
    el.addEventListener('click', opts.onClick);
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      opts.onClick?.();
    });
  }
  return el;
}
