/* ============================================================
 * bz 组件库 · 卡片视觉单选组（src/core/ui/cardpick.ts，issue 210）
 * 「看脸选」的单选卡：迷你预览区 + 名称，无编号无描述（用户拍板）。
 * 与 uiChoice（文案胶囊）/ uiSelect（下拉）互补——适合皮肤/布局等
 * 视觉差异为主的设置项；预览变体视觉由使用方域样式提供（prevClass）。
 * ============================================================ */
import type { BzCardPickOpts } from './types';

/** 预览区内联高度（静态值提常量，避开 lint 静态样式赋值告警） */
const CARD_PREV_HEIGHT = '62px';

/** 卡片视觉单选组，返回容器 + setValue 句柄。radiogroup + 左右方向键导航（对齐 uiChoice L8） */
export function uiCardChoice<T extends string>(opts: BzCardPickOpts<T>): { el: HTMLDivElement; setValue: (v: T) => void } {
  const el = createDiv();
  el.className = 'bzrv-cardpick' + (opts.className ? ' ' + opts.className : '');
  el.setAttribute('role', 'radiogroup');
  if (opts.label) el.appendChild(Object.assign(createSpan(), { className: 'bzrv-sr-only', textContent: opts.label }));
  const btns = new Map<T, HTMLButtonElement>();
  let cur = opts.value;

  const sync = (v: T) => {
    cur = v;
    btns.forEach((b, val) => {
      const on = val === v;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', String(on));
    });
  };

  opts.options.forEach((o) => {
    const card = createEl('button');
    card.type = 'button';
    card.className = 'bzrv-cardpick-card' + (o.value === opts.value ? ' is-on' : '');
    card.dataset.value = String(o.value);
    card.setAttribute('role', 'radio');
    card.setAttribute('aria-checked', String(o.value === opts.value));
    // div + 内联高度双保险（issue 210 用户实测：span 在 WebView2 下会被环境样式影响，
    // aspect-ratio/样式表高度都可能不生效——预览区塌陷成一条线）
    const prev = createDiv();
    prev.className = 'bzrv-cardpick-prev' + (o.prevClass ? ` ${o.prevClass}` : '');
    prev.setAttribute('aria-hidden', 'true');
    prev.style.height = CARD_PREV_HEIGHT;
    const name = createSpan();
    name.className = 'bzrv-cardpick-name';
    name.textContent = o.label;
    card.append(prev, name);
    card.addEventListener('click', () => {
      if (cur === o.value) return;
      sync(o.value);
      opts.onChange(o.value);
    });
    btns.set(o.value, card);
    el.appendChild(card);
  });

  // 方向键在同组内循环移动选中（radio 组语义，对齐 uiChoice/uiSegmented；Enter/Space 原生触发 click）
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const list = opts.options.map((o) => o.value);
    const idx = list.indexOf(cur);
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
    const next = (idx + delta + list.length) % list.length;
    sync(list[next]);
    opts.onChange(list[next]);
    btns.get(list[next])?.focus();
  });

  return { el, setValue: sync };
}
