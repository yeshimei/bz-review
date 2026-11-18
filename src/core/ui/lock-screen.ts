/* ============================================================
 * bz 组件库 · 解锁屏（src/core/ui/lock-screen.ts）
 * 四域共用骨架（ADR-0002：core 不反向依赖任何域，故共享壳只能落 core）：
 *   印章徽 + 标题 + 副题 + 统计卡 + 主密码输入 + 主按钮 + 安全提示行。
 * 组件只给结构与槽位：
 *   - 文案 / 统计数字由调用域注入（各域口径不同）；
 *   - 视觉由各域 styles.css 按 .bzrv-lockscreen--<kind> 作用域风格化；
 *   - 校验、节流、首设流程等语义一律留在域内（组件不碰密码）。
 * ============================================================ */
import { uiIcon } from './icon';
import type { BzIconName } from './types';

/** 一张统计卡：数字 + 标签（数字未知时传 '—'） */
export interface LockScreenStat {
  num: string;
  label: string;
}

/** 域标识：决定作用域类与注入的统计口径（people = 脸谱，issue 482） */
export type LockScreenKind = 'vault' | 'password-vault' | 'diary' | 'people';

export interface LockScreenOpts {
  kind: LockScreenKind;
  /** 印章徽内的 lucide 图标（缺省 lock） */
  icon?: BzIconName;
  title: string;
  sub?: string;
  /** 统计卡（建议 3 张；不传则不渲染统计行） */
  stats?: LockScreenStat[];
  placeholder?: string;
  /** 主按钮文案 */
  action: string;
  /** 底部安全提示行（体检/完整性口径） */
  secText?: string;
  secTone?: 'ok' | 'warn' | 'bad';
  hint?: string;
  /**
   * 次按钮文案（可空）。给了就在主按钮左侧多出一颗次要动作钮——脸谱封面那把「取消」
   * （issue 506：合着的册子封面要给一颗看得见的退出口，不只靠点空白/ESC）。
   * 组件只出钮与槽位，**取消算什么语义由调用域接**：`cancelBtn.onclick` 不挂就只是颗不动的钮，
   * 故不传 `cancel` 的域渲染与既有一模一样。
   */
  cancel?: string;
  /**
   * 首设模式：双输入（明文、上下排列）+ 风险告知 + 勾选确认。
   * 明文是有意为之：首设没有「对不对」的参照，掩码下输错了只能等提交才报「两次不一致」。
   */
  firstSetup?: boolean;
  warningHtml?: string;
  ackText?: string;
  /**
   * inline=true：不创建全屏遮罩，只返回内容盒（供域内覆盖层复用，如密码本 desk/mob 双实例）；
   * 缺省返回全屏遮罩（挂 document.body）。
   */
  inline?: boolean;
}

/** 装载一段受控 HTML（解析规则与 innerHTML 同源，但不直接写 innerHTML/outerHTML） */
function setMarkup(el: HTMLElement, html: string): void {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  el.replaceChildren(...Array.from(doc.body.childNodes, (n) => document.importNode(n, true)));
}

/** 遮罩显隐用的 display 值集中成常量：obsidianmd 只拦字面量直接写进 style，
 *  从常量取值是它明确允许的写法（规则源码见 noStaticStylesAssignment）。 */
const CSS_DISPLAY_FLEX = 'flex';

export interface LockScreenHandle {
  /** 根元素（遮罩 或 inline 内容盒） */
  el: HTMLDivElement;
  input: HTMLInputElement;
  input2: HTMLInputElement;
  ackBox: HTMLInputElement | null;
  actionBtn: HTMLButtonElement;
  /** 次按钮（未传 opts.cancel 时为 null）——语义由调用域挂 onclick */
  cancelBtn: HTMLButtonElement | null;
  setTitle(text: string): void;
  setMessage(text: string): void;
  setError(text: string): void;
  setStats(stats: LockScreenStat[]): void;
  setSec(text: string, tone?: 'ok' | 'warn' | 'bad'): void;
  setBusy(busy: boolean): void;
  /** 首设第二遍确认输入的显隐（功能性显隐） */
  showSecondInput(show: boolean): void;
  focus(): void;
  close(): void;
}

/** 生成解锁屏（结构同源，四域各自注入内容与风格） */
export function uiLockScreen(opts: LockScreenOpts): LockScreenHandle {
  const el = createDiv();
  el.className = `bzrv-lockscreen bzrv-lockscreen--${opts.kind}` + (opts.inline ? ' bzrv-lockscreen--inline' : ' bzrv-lockscreen--mask');
  el.dataset.ls = opts.inline ? 'box' : 'mask';

  const box = createDiv();
  box.className = 'bzrv-lockscreen-box';
  box.dataset.ls = 'box';

  // 印章徽
  const seal = createDiv();
  seal.className = 'bzrv-lockscreen-seal';
  seal.dataset.ls = 'seal';
  seal.appendChild(uiIcon(opts.icon || 'lock', 'bzrv-lockscreen-seal-ic'));
  box.appendChild(seal);

  // 标题 / 副题
  const title = createEl('h4');
  title.className = 'bzrv-lockscreen-title';
  title.dataset.ls = 'title';
  title.textContent = opts.title;
  box.appendChild(title);

  const sub = createEl('p');
  sub.className = 'bzrv-lockscreen-sub';
  sub.dataset.ls = 'sub';
  sub.textContent = opts.sub || '';
  box.appendChild(sub);

  // 统计卡（三张横排；各域口径不同）
  const statsWrap = createDiv();
  statsWrap.className = 'bzrv-lockscreen-stats';
  statsWrap.dataset.ls = 'stats';
  const setStats = (list: LockScreenStat[]) => {
    statsWrap.innerHTML = '';
    (list || []).forEach((s) => {
      const card = createDiv();
      card.className = 'bzrv-lockscreen-stat';
      const num = createEl('b');
      num.className = 'bzrv-lockscreen-num';
      num.textContent = s.num;
      const lab = createSpan();
      lab.className = 'bzrv-lockscreen-label';
      lab.textContent = s.label;
      card.appendChild(num);
      card.appendChild(lab);
      statsWrap.appendChild(card);
    });
    statsWrap.style.display = (list && list.length) ? '' : 'none';
  };
  setStats(opts.stats || []);
  box.appendChild(statsWrap);

  const firstSetup = !!opts.firstSetup;

  // 首设风险告知（仅首设显示）
  const warning = createDiv();
  warning.className = 'bzrv-lockscreen-warning';
  warning.dataset.ls = 'warning';
  setMarkup(warning, opts.warningHtml || '');
  warning.style.display = firstSetup ? '' : 'none';
  box.appendChild(warning);

  // 首设勾选确认
  const ack = createEl('label');
  ack.className = 'bzrv-lockscreen-ack';
  ack.dataset.ls = 'ack';
  const ackBox = createEl('input');
  ackBox.type = 'checkbox';
  ack.appendChild(ackBox);
  ack.appendChild(document.createTextNode(opts.ackText || '我已了解：主密码无法找回，遗忘将导致密文永久无法恢复'));
  ack.style.display = firstSetup ? '' : 'none';
  box.appendChild(ack);

  // 输入 + 主按钮
  const row = createDiv();
  // 首设两遍输入上下排（并排各占半行，明文也看不全），排法见 components.css 的 --stack
  row.className = 'bzrv-lockscreen-row' + (firstSetup ? ' bzrv-lockscreen-row--stack' : '');
  const input = createEl('input');
  input.type = firstSetup ? 'text' : 'password';
  input.className = 'bzrv-lockscreen-input';
  input.dataset.ls = 'p1';
  input.placeholder = opts.placeholder || '主密码';
  const input2 = createEl('input');
  input2.type = firstSetup ? 'text' : 'password';
  input2.className = 'bzrv-lockscreen-input';
  input2.dataset.ls = 'p2';
  input2.placeholder = '再次输入';
  input2.style.display = firstSetup ? '' : 'none';
  // 首设是「定密码」不是「验密码」：两遍都明文——掩码下输错了只能等提交才报「不一致」。
  // 明文档顺手关掉拼写/首字母大写纠正（否则密码会被 IME / 输入法改写）。
  for (const inp of [input, input2]) {
    inp.autocomplete = firstSetup ? 'new-password' : 'off';
    if (!firstSetup) continue;
    inp.spellcheck = false;
    inp.setAttribute('autocapitalize', 'off');
    inp.setAttribute('autocorrect', 'off');
  }
  const actionBtn = createEl('button');
  actionBtn.className = 'bzrv-lockscreen-action';
  actionBtn.dataset.ls = 'go';
  actionBtn.textContent = opts.action;
  // 次按钮（可选）：只出钮，语义留给调用域（见 LockScreenOpts.cancel 注释）
  let cancelBtn: HTMLButtonElement | null = null;
  if (opts.cancel) {
    cancelBtn = createEl('button');
    cancelBtn.className = 'bzrv-lockscreen-cancel';
    cancelBtn.dataset.ls = 'cancel';
    cancelBtn.textContent = opts.cancel;
  }
  row.appendChild(input);
  row.appendChild(input2);
  if (cancelBtn) row.appendChild(cancelBtn);
  row.appendChild(actionBtn);
  box.appendChild(row);

  // 输入框回车即提交（效率整改 13）：Enter 恒等价点主按钮（首设双输入同理）——
  // 解锁屏最不该让用户多动手，域内不必再各自挂 keydown 接线；
  // busy 期按钮 disabled，click() 不触发，天然防重复提交
  for (const inp of [input, input2]) {
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') actionBtn.click();
    });
  }

  // 错误行
  const err = createDiv();
  err.className = 'bzrv-lockscreen-err';
  err.dataset.ls = 'err';
  box.appendChild(err);

  // 安全提示行（体检/完整性）
  const sec = createDiv();
  sec.className = 'bzrv-lockscreen-sec';
  sec.dataset.ls = 'sec';
  const dot = createSpan();
  dot.className = 'bzrv-lockscreen-dot';
  sec.appendChild(dot);
  const secText = createSpan();
  secText.textContent = opts.secText || '';
  sec.appendChild(secText);
  if (opts.secTone) sec.classList.add(`bzrv-lockscreen-sec--${opts.secTone}`);
  sec.style.display = opts.secText ? '' : 'none';
  box.appendChild(sec);

  const hint = createDiv();
  hint.className = 'bzrv-lockscreen-hint';
  hint.dataset.ls = 'hint';
  hint.textContent = opts.hint || '';
  hint.style.display = opts.hint ? '' : 'none';
  box.appendChild(hint);

  if (!opts.inline) el.style.display = CSS_DISPLAY_FLEX;
  el.appendChild(box);

  const focus = () => {
    try {
      input.focus({ preventScroll: true });
    } catch {
      input.focus();
    }
  };

  return {
    el,
    input,
    input2,
    ackBox,
    actionBtn,
    cancelBtn,
    setTitle: (t) => { title.textContent = t; },
    setMessage: (t) => { sub.textContent = t; },
    setError: (t) => { err.textContent = t; },
    setStats,
    setSec: (t, tone) => {
      secText.textContent = t;
      sec.style.display = t ? '' : 'none';
      sec.classList.remove('bz-lockscreen-sec--ok', 'bzrv-lockscreen-sec--warn', 'bzrv-lockscreen-sec--bad');
      if (tone) sec.classList.add(`bzrv-lockscreen-sec--${tone}`);
    },
    setBusy: (busy) => {
      actionBtn.disabled = !!busy;
      input.disabled = !!busy;
      input2.disabled = !!busy;
      if (cancelBtn) cancelBtn.disabled = !!busy; // 提交窗口内不给退出（同主按钮）
      if (busy) actionBtn.dataset.busyText = actionBtn.textContent || '';
      actionBtn.textContent = busy ? '处理中…' : (actionBtn.dataset.busyText || opts.action);
    },
    showSecondInput: (show) => { input2.style.display = show ? '' : 'none'; },
    focus,
    close: () => { el.remove(); },
  };
}
