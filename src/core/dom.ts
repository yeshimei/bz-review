/**
 * DOM 工具（Q3.js window.__utils 移植）：notice/longPress/
 * createIconBtn/createOverlay——行为与 Q3 逐字一致。
 * injectStyles 已随 ticket 60 样式收敛废弃删除（铁律 9：禁运行时注入）。
 * createSiteIcon（yandex favicon 外连）已从 bz 移植遗留里删除：本仓不产该图标、
 * 也不该多一个主动外连口子。
 */
import { bindMaskDismiss } from './mask-dismiss';
import { notifyFloatClosed } from './home-return';
import { notice } from './notice';
import { allocZ, topifyZ } from './z-order';

/** 失败态/未显示态的隐藏 display（运行时赋值，非主题静态样式） */
const DISPLAY_NONE = 'none';
/** 长按手势可能收到的事件：mousedown/touchstart 及其配对事件共用同一套回调 */
export type LongPressEvent = MouseEvent | TouchEvent;

/** notice(msg, dur)：统一走自绘通知系统（自动语义归类，ticket 25 替代原生 Notice） */
export { notice };

/** 层级发号（ADR-0067 动态 z-index）：overlay 显示时发号，谁后显示谁在上 */
export { allocZ, topifyZ };

/** longPress(el, cb, dur, filter)：长按手势（mousedown/touchstart 计时，移动超 10px 取消）
 *  触屏滚动兼容：touchstart 被动监听、不 preventDefault（否则整段列表滚动被禁，memo 归档视图
 *  实测复现），长按触发后吞掉浏览器补发的合成 click（防穿透到元素内部链接/按钮）；
 *  未长按的短按由浏览器正常派发 click，不再自行补发。 */
export function longPress(
  el: HTMLElement,
  cb: (e: LongPressEvent) => void,
  dur?: number,
  filter?: (e: LongPressEvent) => boolean
): void {
  if (!dur) dur = 500;
  let timer: number | null = null, touching = false, fired = false, sx = 0, sy = 0;
  let suppressClick = false;
  const M = 10;
  function start(e: LongPressEvent) {
    if (filter && !filter(e)) return;
    const button = 'button' in e ? e.button : undefined;
    if (button !== undefined && button !== 0) return;
    fired = false;
    const touches = 'touches' in e ? e.touches : undefined;
    if (touches && touches.length) {
      const t = touches[0];
      sx = t.clientX;
      sy = t.clientY;
      touching = true;
    }
    timer = window.setTimeout(function () { timer = null; fired = true; cb(e); }, dur);
  }
  function cancel() { if (timer !== null) { window.clearTimeout(timer); timer = null; } }
  function move(e: LongPressEvent) {
    const touches = 'touches' in e ? e.touches : undefined;
    if (!timer || !touching || !touches || !touches.length) return;
    const t = touches[0];
    if (Math.abs(t.clientX - sx) > M || Math.abs(t.clientY - sy) > M) cancel();
  }
  function endFromTouch() {
    // 长按已触发 → 吞掉浏览器随后补发的合成 click（防穿透）；未长按不吞（短按 = 普通点击）
    if (fired) suppressClick = true;
    touching = false;
    cancel();
  }
  function endFromMouse() { touching = false; cancel(); }
  function onClick(e: MouseEvent) {
    if (suppressClick) {
      suppressClick = false;
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }
  el.addEventListener('mousedown', start);
  el.addEventListener('mouseup', endFromMouse);
  el.addEventListener('mouseleave', endFromMouse);
  el.addEventListener('touchstart', start, { passive: true });
  el.addEventListener('touchend', endFromTouch);
  el.addEventListener('touchmove', move, { passive: true });
  el.addEventListener('touchcancel', endFromTouch);
  // 捕获阶段拦截：必须在卡片内部链接/按钮的 handler（目标/冒泡阶段）之前执行才能防穿透
  el.addEventListener('click', onClick, true);
}

/** swallowNextClick()：拖拽收尾防线——吞掉紧随本次拖拽结束的终端 click（issue 222）。
 *  拖拽中 mousedown 落在面板、mouseup 落在遮罩/列表行时，浏览器把 click 派发到两者的
 *  公共祖先，误触发「点遮罩关闭」「行点击」等冒泡语义。capture 一次性拦截：click 触发
 *  即自毁；若未触发（如鼠标移出窗口松开）则下次 mousedown 撤防，不吞正常点击。
 *  键盘激活的 click（R12）无坐标（clientX/Y === 0）且无前置 mousedown（撤防监听不触发），
 *  直接放行不吞——否则「窗口外松手 → 回窗先键盘激活按钮」时第一次 Enter 被误吞。 */
export function swallowNextClick(): void {
  const swallow = (e: MouseEvent) => {
    // 键盘 click 无坐标：不属于拖拽残影，放行（监听保持武装等真正的终端 click）
    if (e.clientX === 0 && e.clientY === 0) return;
    document.removeEventListener('click', swallow, true);
    e.stopPropagation();
  };
  const disarm = () => {
    document.removeEventListener('click', swallow, true);
  };
  document.addEventListener('click', swallow, true);
  document.addEventListener('mousedown', disarm, { capture: true, once: true });
}

/** createIconBtn(text, title, onClick, extra)：图标按钮（普通 14px/22×26，关闭 ❌ 13px/21×25 + hover 背景） */
export function createIconBtn(
  text: string,
  title: string,
  onClick: (() => void) | null,
  extra?: string
): HTMLButtonElement {
  const b = createEl('button');
  b.textContent = text;
  /* Obsidian 会把 title / aria-label 变成悬停气泡；这里改用视觉隐藏文本，
     读屏仍读到名字，指针移上不再冒莫名其妙的小黑框。 */
  if (title) {
    const sr = createSpan();
    sr.className = 'bzrv-sr-only';
    sr.textContent = title;
    b.appendChild(sr);
  }
  // 规格：普通按钮 14px/22×26；关闭按钮 13px/21×25（--close 类，styles.css）
  b.className = text === '❌' ? 'bzrv-icon-btn bzrv-icon-btn--close' : 'bzrv-icon-btn';
  if (extra) b.style.cssText = extra;
  b.onclick = onClick;
  return b;
}

/** 存活 overlay 登记表（CB10/A1）：createOverlay 即登记（open 时机），close 幂等注销。
 *  自建遮罩弹窗（UP/RSS 管理、路径选择器等）的 close 句柄原先困在各自闭包里，域卸载与
 *  main onunload 都拿不到——统一登记后 closeAllOverlays() 一处收口，全域受益。
 *  调用方手动 mask.remove() 而不经 close 的旧登记（detach 残留）由 pruneDetached 惰性回收。 */
interface LiveOverlayEntry {
  mask: HTMLDivElement;
  popup: HTMLDivElement;
  /** close 包装（含自注销）：registerClose 覆写为调用方 close，缺省为摘除 mask+popup */
  close: () => void;
}
const liveOverlays = new Set<LiveOverlayEntry>();

/** 惰性回收：mask 与 popup 均已离场的登记视为已关（手动 remove 的旧路径），静默注销 */
function pruneDetachedOverlays(): void {
  for (const entry of liveOverlays) {
    if (!entry.mask.isConnected && !entry.popup.isConnected) liveOverlays.delete(entry);
  }
}

/** createOverlay(opts)：{maskId, popupId, onMaskClick, width, maxWidth} → {mask, popup, topify, registerClose}
 *  z-index 动态分配（ADR-0067）：创建时发号一次（创建即显示的场景够用）；
 *  show/hide 复用的面板每次显示调 topify() 重新发号，保证「谁后显示谁在上」；
 *  创建即登记进存活表（CB10/A1），close 经 registerClose 注入后幂等注销。 */
export function createOverlay(opts: {
  maskId: string;
  popupId: string;
  onMaskClick?: () => void;
  width?: string;
  maxWidth?: number;
}): { mask: HTMLDivElement; popup: HTMLDivElement; topify: () => void; registerClose: (close: () => void) => void } {
  pruneDetachedOverlays();
  const mask = createDiv();
  mask.id = opts.maskId;
  mask.className = 'bzrv-overlay-mask';
  mask.style.display = DISPLAY_NONE;
  // 点遮罩关闭：手势配对判据（见 core/mask-dismiss.ts）——跨元素松手（弹窗内选字划到
  // 遮罩、遮罩上误按滑回弹窗）不算点击，只有明确的按下+抬起都在遮罩本体上才关
  if (typeof opts.onMaskClick === 'function') bindMaskDismiss(mask, opts.onMaskClick);
  const popup = createDiv();
  popup.id = opts.popupId;
  popup.className = 'bzrv-overlay-popup';
  popup.style.display = DISPLAY_NONE;
  popup.style.width = opts.width || '90%';
  popup.style.maxWidth = (opts.maxWidth || 400) + 'px';
  topifyZ(mask, popup);
  const entry: LiveOverlayEntry = {
    mask,
    popup,
    close: () => {
      liveOverlays.delete(entry); // 幂等注销（closeAllOverlays 与调用方 close 双入口都安全）
      if (mask.isConnected) mask.remove();
      if (popup.isConnected) popup.remove();
      // 首页返回总线：从首页菜单点开的浮层，关掉即「功能闭合」（主面板内的不受影响）
      notifyFloatClosed();
    },
  };
  liveOverlays.add(entry);
  return {
    mask,
    popup,
    topify: () => topifyZ(mask, popup),
    /** 注入调用方 close（UP/RSS 管理等自带 esc 注销/单例旗标复位的收尾）：包装为
     *  「先自注销再执行」，重复触发与 closeAllOverlays 兜底都幂等 */
    registerClose: (close: () => void) => {
      entry.close = () => {
        liveOverlays.delete(entry);
        close();
        notifyFloatClosed();
      };
    },
  };
}

/** 关闭全部存活 overlay（CB10/A1，main.ts onunload 调用；幂等，无存活时 no-op）：
 *  逐个走登记的 close（含调用方注入的收尾），关一个注销一个 */
export function closeAllOverlays(): void {
  for (const entry of [...liveOverlays]) {
    try {
      entry.close();
    } catch {
      // close 抛错不阻断其余浮层收口；DOM 兜底摘除防残留
      entry.mask.remove();
      entry.popup.remove();
      liveOverlays.delete(entry);
    }
  }
}
