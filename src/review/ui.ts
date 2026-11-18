/**
 * 复习计划 UI（2026-09-04 拍板形态重写：三区队列面板；issue 253 起 markup 单源自 render.ts）
 *
 * 用户拍板（原型 rp1x 评审结论）：
 *  - 桌面右上角无设置按钮；「归档 / 统计」改为非按钮 → 沉到面板底部一条弱化信息行
 *  - 移动端无设置按钮（顶栏仅 ✕）；归档/统计同走移动归档钮 + 统计弹窗
 *  - 全部 emoji 换 lucide 图标
 *  - 三区列：已逾期 / 今天到期 / 未来；只有到期（逾期/今天）条目可点击开始答题（sprint）
 *  - 「开始本轮」= 逾期 + 今天批量进入做题冲刺（forceQuizForReview 关闭时 = 普通跳转复习）
 *  - 面板容器沿用 #bzrv-mask/#bzrv-popup id 几何契约，壳类接组件库
 *    .bzrv-panel-overlay/.bzrv-panel-frame（ADR-0094）；内容区三区队列渲染
 *  - 整窗冲刺由 SprintSession 驱动，宿主为 #bzrv-entries 内容区
 *
 * issue 253（V1 原型为真理，旧评审壳（已退役）行为单源化）：
 *  - markup 全部出自 ./render（queueViewHtml / 冲刺视图 / 难度弹窗 / 评级条），本文件只做
 *    生命周期/事件委托/数据流；旧评审壳（已退役）经 prototype-behavior.js 跑同一份 ui.ts
 *  - V1 增量落地：卡片「待重做」红 tag 显性化；归档态状态条改绿点「已完成复习」；
 *    列内排序 置顶 → R 升序 → 到期（render.sortColumn）
 *
 * 深审批 C（2026-09-19）：
 *  - U4/A4/E7/U10 难度弹窗迁 openFlowDialog choice 形态（ESC/遮罩/焦点 core 单源收口 +
 *    1-4 快捷键 + onSelect promise 兜底），旧自绘 .difficulty-dialog 不再产出
 *  - E1/C1 抽屉「移出复习计划」免确认直达 notifyUndo（效率整改 5 口径）
 *  - E6 队列重建前记录三区列滚位与焦点控件，重建后还原
 *  - C15 构造期 allocZ 删（ADR-0067 仅显示时 topifyZ 发号）；ESC 层 id 改 'bzrv-review-main'
 *
 * 公共面（对外契约不变）：UIManager / reviewSettingsSchema（re-export）/ isPlayable / isDueToday
 */
import { Modal, TFile, type App } from 'obsidian';
import { topifyZ, allocZ } from '../core/z-order';
import { bindMaskDismiss } from '../core/mask-dismiss';
import { trapPanelFocus } from '../core/ui/focus-trap';
import { notice, notifyUndo, notifySaveError, notifyActionError } from '../core/notice';
import { openFlowDialog } from '../core/flow-dialog';
import { escManager } from '../core/esc-manager';
import { getSettings, tryGetSettings, panelSizePersist } from '../core/settings-provider';
import { createAI } from '../core/ai';
import { isMobileEnv } from '../core/mobile';
import { uiEmpty, mountIcons, uiResizable } from '../core/ui';
import { DEFAULT_W } from './fsrs';
import type { ReviewItem } from './data';
import { ReviewDataManager } from './data';
import {
  queueViewHtml, reviewBarHtml, trashViewHtml,
  booksViewHtml, managerViewHtml, panelHeadHtml,
  isPlayable as isPlayableRender,
} from './render';
import { loadTrash } from './trash-store';
import type { TrashEntry } from './trash';
import {
  motionQueueBoot, motionChargeStrip, motionDrawCard, motionTeardown, motionRatingBar,
} from './motion';
import { DEFAULT_R_THRESHOLD, isDueToday } from './queue';
import { ratingForKey } from './keys';
import { applyFilter, collectFacets, describeFilter, isEmptyFilter, type ItemFilter } from './deck';
import { removeNote as planRemoveNote, removeCard as planRemoveCard } from './plan-ops';
import { canUseCapability, capabilityBlock } from '../data/entitlement';
import { bookSummariesOf } from './book-summary';
import { setSuspended, buryItem, unsuspendAndUnbury, hiddenNotice } from './card-manager';
import { SprintSession } from './sprint';
import type { SprintMode } from './sprint';
import { CardSession } from './card-session';
import { generateFlashcard } from './flashcard';
import { cardModeOf, cardQuizRatioOf, modeOfCard } from './card-ai';
import { confirmBeforeRound, needsCardConfirm } from './card-flow';
import { openCardEditor } from './card-edit';
import { getCardQuiz, saveCardQuiz } from './card-quiz-store';
import { isCardItem } from './data';
import type { ReviewCard } from './data';
import type { QuizQuestion } from './quiz-core/manager';
import type { QuizMasterUI } from './quiz-core/session';

import { markOwned } from '../core/scope';
export { reviewSettingsSchema } from './settings-schema';
// item 6：isDueToday 下沉 queue.ts 纯函数（ui 保留 re-export 签名兼容）
export { isDueToday };
// issue 253：isPlayable 实现迁 render.ts（ui 保留 re-export 签名兼容）
export { isPlayableRender as isPlayable };

/** 到期可做题判定（render 实现；本文件内部沿用旧名） */
const isPlayable = isPlayableRender;

/** 桌面面板拖拽缩放限界（ADR-0084；只挂 #bzrv-popup，移动端真全屏不挂） */
const PANEL = { MIN_W: 640, MIN_H: 440, MAX_W: 1280, MAX_H: 880 };

/** 面板显隐用的 display 值集中成常量：obsidianmd 只拦「字面量直接写进 style」，
 *  从常量取值是它明确允许的写法（规则源码见 noStaticStylesAssignment），行为与原先逐字相同。 */
const CSS_DISPLAY_NONE = 'none';
const CSS_DISPLAY_BLOCK = 'block';
const CSS_DISPLAY_FLEX = 'flex';

/**
 * 把 render.ts 产出的 HTML 字符串落到容器：DOMParser 解析后逐节点 importNode 装入，
 * 解析规则与 innerHTML 赋值同源，但不直接写 innerHTML/outerHTML。
 * 调用点需在替换后重新 querySelector（节点已是新实例），与原来的逻辑一致。
 */
function setMarkup(el: HTMLElement, html: string): void {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  el.replaceChildren(...Array.from(doc.body.childNodes, (n) => document.importNode(n, true)));
}

/** 手动排期的日期输入：Obsidian Modal 承载，交互与原生 prompt 等价（预填、回车/确定、取消）。 */
function promptDate(app: App, message: string, initial: string): Promise<string | null> {
  return new Promise((resolve) => {
    const modal = new Modal(app);
    let settled = false;
    const finish = (v: string | null): void => {
      if (settled) return;
      settled = true;
      resolve(v);
      modal.close();
    };
    modal.titleEl.setText('手动排期');
    modal.contentEl.createDiv().setText(message);
    const input = modal.contentEl.createEl('input');
    input.type = 'text';
    input.value = initial;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(input.value);
      }
    });
    const row = modal.contentEl.createDiv();
    const ok = row.createEl('button');
    ok.textContent = '确定';
    ok.addEventListener('click', () => finish(input.value));
    const cancel = row.createEl('button');
    cancel.textContent = '取消';
    cancel.addEventListener('click', () => finish(null));
    modal.onClose = () => finish(null);
    modal.open();
    input.focus();
  });
}

// issue 253：到期标签/可做题判定等纯口径随 markup 一并迁 render.ts（dueLabelOf/isPlayable/stageTagHtml/stageNum）

/** E6 焦点记忆：面板内焦点控件 → data-* 特征键（data-id=… / data-act=…），null = 无可记忆焦点 */
function captureFocusKey(scope: HTMLElement): string | null {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement) || !scope.contains(el)) return null;
  for (const attr of ['data-id', 'data-act']) {
    const v = el.getAttribute(attr);
    if (v != null) return `${attr}=${v}`;
  }
  return null;
}

/** E6 焦点还原：按特征键在重建后的容器内找回同位控件并聚焦（找不到则静默放弃） */
function restoreFocusKey(scope: HTMLElement, key: string): void {
  const eq = key.indexOf('=');
  const el = scope.querySelector<HTMLElement>(`[${key.slice(0, eq)}="${CSS.escape(key.slice(eq + 1))}"]`);
  el?.focus({ preventScroll: true });
}

export class UIManager {
  app: App;
  dataManager: ReviewDataManager;
  /** R 展示口径权重源（item 12：与调度排期同读拟合权重；ensureReview 注入 reviewApp.currentW，缺省回退默认） */
  wSource: () => number[] = () => DEFAULT_W;
  mask: HTMLElement | null = null;
  popup: HTMLElement | null = null;
  /** 内容区容器（队列/冲刺共用宿主） */
  entriesContainer: HTMLElement | null = null;
  /** 当前冲刺会话（内容区被占用时队列交互禁用） */
  private sprint: SprintSession | null = null;
  /** 划线卡复习会话（与 sprint 互斥：两者都占用内容区） */
  private cardSession: CardSession | null = null;
  /** 冲刺入口 in-flight 防抖（双击/并发触发只放行一次，防双开会话双倍 AI 调用） */
  private sprintStarting = false;
  showArchived = false;
  /** 回收站视图开关（与归档互斥：两个都是「另一种列表」，同时开没有意义） */
  showTrash = false;
  /** 回收站条目缓存（进入视图前由 refreshPanel 刷新） */
  private trashEntries: TrashEntry[] = [];
  /** 回收站条数（底部入口按它决定显不显示） */
  private trashCount = 0;
  /** 当前筛选（批 4b）；面板关掉再开仍然保留——用户刚筛完不想又重设一遍 */
  private filter: ItemFilter = {};
  /** 筛选区就地展开（批 8：不再弹原生弹窗，省一次「点开-填-应用-关掉」的来回） */
  private filterOpen = false;
  /** 打字时重绘要把光标放回关键字框（否则每敲一个字就掉焦点） */
  private keepFilterFocus = false;
  /** 关键字输入的防抖句柄 */
  private filterTimer: number | null = null;
  /** 面板内置页（批 8）：数据 / 设置；null = 队列主列表 */
  /* 内置页（批 8 起）：数据 / 设置 / 已完成。三页共用同一个内容区与「返回」头行，
     不再各开一套弹窗（用户 2026-11-15 口径：全部内置到面板，入口在右上角）。 */
  private page: 'stats' | 'settings' | 'arch' | 'books' | 'manager' | null = null;
  /** 卡片管理器自己的筛选（与队列筛选互不干扰） */
  private mgrFilter: ItemFilter = {};
  /** 管理器搜索框重绘后要把光标放回去 */
  private mgrKeepFocus = false;
  /** 批量选择模式 */
  private selectMode = false;
  /** 已选条目（filePath） */
  private selected = new Set<string>();
  private escHandle: { unregister: () => void } | null = null;
  /** 动效 boot 消费标志：showMain 置位，首个 renderEntries 消费（后台刷新静默不重播） */
  private motionBootPending = false;
  /** 桌面拖拽缩放句柄（ADR-0084/ADR-0094）：壳常驻 DOM，showMain 幂等挂 / hideMain 摘；null = 未挂 */
  private panelResizeDetach: { flush: () => void; detach: () => void } | null = null;
  /** 面板宿主：null = 浮层挂在 body；Obsidian 视图的 contentEl = 原生页（reviewPanelMode） */
  private hostEl: HTMLElement | null = null;
  /** 原生页模式下「关闭」的出口（关掉所在标签页）；浮层模式为 null */
  onRequestClose: (() => void) | null = null;
  /** 关标签页途中：挡 hideMain → detach → onClose → hideMain 的递归 */
  private closingView = false;

  constructor(app: App, dataManager: ReviewDataManager) {
    this.app = app;
    this.dataManager = dataManager;
    this.createMainUI();
    this.registerEscLayer();
  }

  get inSprint(): boolean {
    return !!this.sprint;
  }

  /** 当前是否挂在 Obsidian 视图里（原生页模式）：决定遮罩、拖拽缩放、焦点圈闭是否参与 */
  get hostedInView(): boolean {
    return !!this.hostEl && this.hostEl !== document.body;
  }

  /** 面板此刻是否可见。原生页模式下遮罩是 none，不能拿 mask 的 display 当判据 */
  get isShown(): boolean {
    if (!this.popup) return false;
    return this.hostedInView
      ? this.popup.style.display !== CSS_DISPLAY_NONE
      : this.mask?.style.display === CSS_DISPLAY_BLOCK;
  }

  /**
   * 把面板壳挪进 Obsidian 视图（原生页模式）。幂等：重复调用只补类名。
   * 壳是同一对节点，挪动不重建——队列滚位、会话状态、事件监听全部保留。
   */
  mountInto(host: HTMLElement): void {
    this.createMainUI();
    if (!this.mask || !this.popup) return;
    this.closingView = false;
    this.hostEl = host;
    // 挪动不重建，锚点本就在；再挂一次是防「节点被第三方重建后丢了作用域」
    markOwned(this.mask);
    markOwned(this.popup);
    host.appendChild(this.mask);
    host.appendChild(this.popup);
    this.mask.classList.add('bzrv-panel-in-view');
    this.popup.classList.add('bzrv-panel-in-view');
    // 撑满标签页时没有可拖的边：摘掉浮层用的缩放句柄（尺寸记忆留给浮层）
    this.panelResizeDetach?.detach();
    this.panelResizeDetach = null;
  }

  /** 把面板壳迁回 body（浮层模式 / 视图关闭）。之后 hostedInView 为 false */
  detachToBody(): void {
    if (!this.mask || !this.popup) return;
    markOwned(this.mask);
    if (this.mask.parentElement !== document.body) document.body.appendChild(this.mask);
    markOwned(this.popup);
    if (this.popup.parentElement !== document.body) document.body.appendChild(this.popup);
    this.mask.classList.remove('bzrv-panel-in-view');
    this.popup.classList.remove('bzrv-panel-in-view');
    this.hostEl = null;
    this.onRequestClose = null;
    this.panelResizeDetach?.detach();
    this.panelResizeDetach = null;
  }

  /**
   * 所在视图关闭时调用：只收场，不再回头去关标签页。
   * 若面板已经被 detachToBody 迁走（切模式），这里什么都不做——此时显示状态
   * 由紧随其后的 showMain 决定，提前 hide 会把刚打开的面板藏起来。
   */
  releaseView(): void {
    this.closingView = false;
    this.onRequestClose = null;
    if (!this.hostedInView) return;
    motionTeardown();
    this.panelResizeDetach?.detach();
    this.panelResizeDetach = null;
    if (this.popup) this.popup.style.display = CSS_DISPLAY_NONE;
    if (this.mask) this.mask.style.display = CSS_DISPLAY_NONE;
    this.detachToBody();
  }

  // ================= 面板构建 =================

  createMainUI(): void {
    if (this.mask && document.body.contains(this.mask)) return;
    // 面板壳接组件库（ADR-0094）：遮罩 = .bzrv-panel-overlay、面板 = .bzrv-panel-frame；
    // id 几何（居中定位/宽高/动画）仍由 #bzrv-mask/#bzrv-popup 域内规则接管
    this.mask = createDiv();
    this.mask.id = 'bzrv-mask';
    this.mask.classList.add('bzrv-panel-overlay');
    this.mask.style.display = CSS_DISPLAY_NONE;
    // C15（ADR-0067）：构造期不发号——display:none 壳不占号，showMain 时 topifyZ 统一发号
    // 点遮罩关闭：手势配对判据（core/mask-dismiss）——遮罩与面板并列挂 body，
    // 套上判据是防以后把面板挪进遮罩时静默回退（届时不再误关）
    bindMaskDismiss(this.mask, () => {
      if (!this.sprint) this.hideMain();
    });

    this.popup = createDiv();
    this.popup.id = 'bzrv-popup';
    this.popup.classList.add('bzrv-panel-frame');
    this.popup.classList.add('bzrv-main-panel');
    // ≤768px 弹窗满宽近全屏：挂顶距工具类（44px 避让 Obsidian 移动端头，components.css 统一档）
    this.popup.classList.add('bzrv-panel-mtop');
    this.popup.style.display = CSS_DISPLAY_NONE;
    const content = createDiv();
    content.id = 'bzrv-entries';
    this.popup.appendChild(content);
    this.entriesContainer = content;

    markOwned(this.mask);
    markOwned(this.popup);
    document.body.appendChild(this.mask);
    document.body.appendChild(this.popup);
  }

  private registerEscLayer(): void {
    if (this.escHandle) return;
    // U5/C7：层 id 统一 `bz-<域>` 约定（原 'review-main' 无前缀）
    this.escHandle = escManager.register('bzrv-review-main', {
      isVisible: () => this.isShown,
      close: () => this.hideMain(),
    });
  }

  // ================= 显示/隐藏 =================

  async showMain(): Promise<void> {
    this.createMainUI();
    if (!this.mask || !this.popup) return;
    this.closingView = false;
    /* 关面板时停在回收站，下次打开还停在回收站会很奇怪——每次打开都从队列开始。
       选择模式同理：跨会话保留选择只会造成误删，一律清掉。筛选保留。 */
    this.showTrash = false;
    this.selectMode = false;
    this.selected.clear();
    if (this.hostedInView) {
      /* 原生页：遮罩不参与（标签页里没有「点外面关掉」这回事），面板直接占满内容区。
         拖拽缩放与焦点圈闭也一并跳过——那是浮层才需要的两件事。 */
      this.mask.style.display = CSS_DISPLAY_NONE;
      this.popup.style.display = CSS_DISPLAY_FLEX;
    } else {
      topifyZ(this.mask, this.popup);
      this.mask.style.display = CSS_DISPLAY_BLOCK;
      this.popup.style.display = CSS_DISPLAY_FLEX;
      // 桌面拖动缩放（ADR-0084）+ 尺寸记忆（ADR-0094）：壳常驻 DOM，showMain 幂等挂 / hideMain 摘
      if (!isMobileEnv() && !this.panelResizeDetach) {
        this.panelResizeDetach = uiResizable(this.popup, {
          minW: PANEL.MIN_W, minH: PANEL.MIN_H,
          maxW: PANEL.MAX_W, maxH: PANEL.MAX_H,
          persist: panelSizePersist('reviewPanelWidth', 'reviewPanelHeight', PANEL.MIN_W, PANEL.MIN_H),
        });
      }
      // 打开即入焦 + Tab 圈闭（呈报#13 F3+H3 全域范式，core trapPanelFocus 单源）
      trapPanelFocus(this.popup);
    }
    this.motionBootPending = true; // 动效首屏编排由紧随的 renderEntries 消费
    await this.showQueue();
  }

  hideMain(): void {
    if (this.sprint) return; // 冲刺中不响应遮罩关闭
    motionTeardown(); // 动效延时编排随面板收场
    // 拖拽缩放随面板隐藏摘除（防抖尾值 detach 内自动 flush，尺寸不丢）
    this.panelResizeDetach?.detach();
    this.panelResizeDetach = null;
    if (this.hostedInView) {
      /* 原生页：关面板 = 关掉所在标签页。closingView 挡住「onClose 又回来调 hideMain」；
         没有出口（视图已被外部关掉）时退化成只隐藏，不能卡死成关不掉的面板。 */
      if (this.closingView) return;
      const close = this.onRequestClose;
      if (!close) {
        if (this.popup) this.popup.style.display = CSS_DISPLAY_NONE;
        return;
      }
      this.closingView = true;
      close();
      return;
    }
    if (this.mask) this.mask.style.display = CSS_DISPLAY_NONE;
    if (this.popup) this.popup.style.display = CSS_DISPLAY_NONE;
  }

  destroy(): void {
    // 先置空再销毁：destroy → finish → onExit → showQueue 不再对同一会话二次 destroy
    const sprint = this.sprint;
    this.sprint = null;
    sprint?.destroy();
    motionTeardown();
    // 卸载时不再回头去关标签页（视图由 main.onunload 统一 detach），直接走隐藏分支
    this.onRequestClose = null;
    this.hideMain();
    if (this.escHandle) {
      this.escHandle.unregister();
      this.escHandle = null;
    }
    if (this.mask) this.mask.remove();
    if (this.popup) this.popup.remove();
    this.mask = null;
    this.popup = null;
    this.entriesContainer = null;
    this.hostEl = null;
  }

  // ================= 队列渲染（三区） =================

  /** 读盘并渲染三区队列（外部刷新入口） */
  async refreshPanel(): Promise<void> {
    if (this.sprint) return;
    /* 卡片会话正接管内容区：这时候重画队列会把它冲掉（评级会顺手调本方法，
       等于每评一张就把会话打回队列）。会话结束时 onExit 自己会重画。 */
    if (this.cardSession) return;
    /* 面板没开着就别读盘渲染。评级、移出、导入这些动作会顺手调这里刷新，
       关着的时候白读一次盘、白渲染一遍，还要还原滚位和焦点。
       判据走 isShown：原生页模式遮罩是 none，拿 mask 的 display 会让队列永不刷新。 */
    if (!this.isShown) return;
    const items = await this.dataManager.loadItems();
    /* 回收站条数一起读：底部入口要靠它决定显不显示，回收站视图也直接用这份。
       一个几百字节的小文件，比「进回收站再读一次、回来再读一次」省一次闪烁。 */
    this.trashEntries = await loadTrash(this.app);
    this.trashCount = this.trashEntries.length;
    this.renderEntries(items);
  }

  /** 渲染队列视图（冲刺态不响应）。
   *  E6：重建前记录三区列各 scrollTop 与面板内焦点控件（data-* 定位），重建后还原——
   *  翻篇/冲刺回收等一切刷新不再把滚位打回顶部、不再丢键盘焦点。 */
  renderEntries(items: ReviewItem[]): void {
    if (this.sprint) return;
    const container = this.entriesContainer;
    if (!container) return;
    /* 内置页（数据 / 设置）先占位：它们不是列表，也不该被三区列的刷新冲掉 */
    if (this.page) {
      this.renderPage(container, items);
      return;
    }
    if (this.showTrash) {
      this.renderTrash(container);
      return;
    }
    const focusKey = captureFocusKey(container);
    const scrollTops = new Map<string, number>();
    container.querySelectorAll<HTMLElement>('.bzrv-q-col').forEach((col) => {
      scrollTops.set(col.className, col.scrollTop);
    });
    const prevBegin = container.querySelector<HTMLElement>('[data-act="begin"]');
    /* 筛选只作用于列表（批 4b）：数据一条没少，只是不显示。
       「开始本轮」仍按到期走——筛选是查看工具，不该悄悄改变复习范围。 */
    const visible = applyFilter(items, this.filter);
    const filtering = !isEmptyFilter(this.filter);
    // 牌组下拉取全量（不是筛过的结果），否则选完一个牌组，别的牌组就从下拉里消失了
    setMarkup(container, this.queueViewHtml(visible, collectFacets(items).decks));
    /* 「开始本轮」节点复用：面板刚打开那一两秒里队列常被再刷一次（样式落盘 / 逾期检查 /
       外层动作回调）。如果这次重绘正好落在按下与松开之间，旧按钮已经被换成新节点，
       click 事件（要求 down/up 落在同一元素）就整个丢掉——用户看到的是一次点了没反应。
       把旧节点塞回原位，监听器和按压态都还在，这一下点得住。 */
    const nextBegin = container.querySelector<HTMLElement>('[data-act="begin"]');
    if (prevBegin && nextBegin) nextBegin.replaceWith(prevBegin);
    if (!visible.length && filtering) {
      /* 有数据但筛没了：说清楚是筛掉的，别让用户以为计划空了 */
      const host = container.querySelector('[data-empty-host]');
      if (host) {
        host.appendChild(
          uiEmpty({
            icon: 'list-filter',
            title: '没有符合筛选的条目',
            desc: `当前条件：${describeFilter(this.filter)}`,
          })
        );
      }
    } else if (!visible.length) {
      // item 10：空库两条路引导（组件库 uiEmpty 工厂）
      const host = container.querySelector('[data-empty-host]');
      if (host) {
        const acts = createDiv();
        acts.className = 'bzrv-btn-row';
        const addBtn = createEl('button');
        addBtn.className = 'bzrv-btn bzrv-btn--primary';
        addBtn.dataset.act = 'add-current';
        addBtn.textContent = '把当前笔记加入复习';
        const helpBtn = createEl('button');
        helpBtn.className = 'bzrv-btn bzrv-btn--ghost';
        helpBtn.dataset.act = 'watch-help';
        helpBtn.textContent = '如何配置监听文件夹';
        acts.appendChild(addBtn);
        acts.appendChild(helpBtn);
        host.appendChild(
          uiEmpty({
            icon: 'inbox',
            title: '复习计划还是空的',
            desc: '添加监听文件夹后新笔记自动加入',
            actions: acts,
          })
        );
      }
    }
    mountIcons(container);
    /* 关键字是边打边筛的，重绘会把输入框换成新节点：把光标放回去，否则敲一个字掉一次焦点 */
    if (this.keepFilterFocus) {
      const q = container.querySelector<HTMLInputElement>('[data-fld="q"]');
      if (q) {
        q.focus();
        q.setSelectionRange(q.value.length, q.value.length);
      }
      this.keepFilterFocus = false;
    }
    // E6 还原：先滚位（focus 用 preventScroll 不扰动），后焦点
    container.querySelectorAll<HTMLElement>('.bzrv-q-col').forEach((col) => {
      const top = scrollTops.get(col.className);
      if (top != null) col.scrollTop = top;
    });
    if (focusKey) restoreFocusKey(container, focusKey);
    this.bindQueueEvents(container, visible);
    // 动效：仅首屏编排（boot 消费即熄）；刷新渲染静默（E6 滚位/焦点还原不受扰动）
    if (this.motionBootPending) {
      this.motionBootPending = false;
      motionQueueBoot(container);
    }
  }
  /** 内置页（批 8）：数据 / 设置 / 已完成——同一个内容区，头行换成「返回 + 标题」 */
  private renderPage(container: HTMLElement, items: ReviewItem[]): void {
    const title = this.page === 'stats'
      ? '数据'
      : this.page === 'arch'
        ? '已完成'
        : this.page === 'books'
          ? '按书档案'
          : this.page === 'manager'
            ? '卡片管理器'
            : '设置';
    setMarkup(container, `<div class="bzrv-q-view bzrv-page">
      ${panelHeadHtml({ activePage: this.page ?? undefined, title })}
      <div class="bzrv-page-body" data-page-body></div>
    </div>`);
    /* 头行图标是 <i data-lucide> 占位：不 mount 就是四个空壳，真机上只剩高亮那枚
       有底色的方块看得见（主队列渲染有 mountIcons，内置页这条路径漏了）。 */
    mountIcons(container);
    this.bindPanelHead(container);
    const body = container.querySelector<HTMLElement>('[data-page-body]');
    if (!body) return;
    void this.fillPage(body, items);
  }

  /** 填内置页内容（动态 import：统计/设置都不在主包里） */
  private async fillPage(body: HTMLElement, items: ReviewItem[]): Promise<void> {
    if (this.page === 'arch') {
      this.fillArchPage(body, items);
      return;
    }
    if (this.page === 'books') {
      this.fillBooksPage(body, items);
      return;
    }
    if (this.page === 'manager') {
      this.fillManagerPage(body, items);
      return;
    }
    if (this.page === 'settings') {
      const [{ reviewSettingsSchema }, { renderSettingsInto }] = await Promise.all([
        import('./settings-schema'),
        import('../core/settings-schema'),
      ]);
      if (this.page !== 'settings' || !body.isConnected) return;
      const wrap = createDiv();
      wrap.className = 'bzrv-settings-content';
      renderSettingsInto(wrap, reviewSettingsSchema({ app: this.app, dataManager: this.dataManager }));
      body.appendChild(wrap);
      return;
    }
    const [{ paintStatsInto }, { forecastLoad }, { forecastToText }] = await Promise.all([
      import('./stats-ui'),
      import('./queue'),
      import('./report'),
    ]);
    if (this.page !== 'stats' || !body.isConnected) return;
    const holder = createDiv();
    holder.className = 'bzrv-stats-body';
    body.appendChild(holder);
    let w: number[] | undefined;
    let fit: Parameters<typeof paintStatsInto>[5] = null;
    try {
      const appMod = await import('./app');
      w = appMod.reviewApp.currentW();
      fit = typeof appMod.reviewApp.fitMeta === 'function' ? appMod.reviewApp.fitMeta() : null;
    } catch {
      w = undefined;
    }
    paintStatsInto(holder, this.app, this.dataManager, items, w, fit);
    /* 未来负荷：以前是命令面板里的一个 Modal，这里直接排进数据页 */
    const fc = createDiv();
    fc.className = 'bzrv-page-forecast';
    const pre = createEl('pre');
    pre.textContent = forecastToText(forecastLoad(items, 30), 21);
    fc.appendChild(pre);
    const tip = createEl('p');
    tip.textContent = '峰值太高说明那天排太满：可以在设置里调「复习间隔缩放」，或用「休假到」把节奏压后。';
    fc.appendChild(tip);
    holder.appendChild(fc);
    const row = createDiv();
    row.className = 'bzrv-btn-row';
    const btn = createEl('button');
    btn.className = 'bzrv-btn';
    btn.textContent = '看记忆分析';
    btn.addEventListener('click', () => {
      void (async () => {
        const { openReviewAnalysis } = await import('./analysis/index');
        await openReviewAnalysis(this.app);
      })();
    });
    row.appendChild(btn);
    /* 数据页顺带放两个高级档入口：可用就进页，不可用给解锁按钮并弹能力位文案。
       门控只锁入口与内容，基础版的统计 / 负荷 / 分析一切照旧。 */
    const bookCap = canUseCapability('bookReport');
    const bookBtn = createEl('button');
    bookBtn.className = 'bzrv-btn';
    bookBtn.textContent = bookCap ? '按书档案' : '解锁按书报告';
    bookBtn.addEventListener('click', () => {
      if (!bookCap) {
        notice(capabilityBlock('bookReport').message, 'warning');
        return;
      }
      this.page = 'books';
      void this.refreshPanel();
    });
    row.appendChild(bookBtn);
    const mgrCap = canUseCapability('cardManager');
    const mgrBtn = createEl('button');
    mgrBtn.className = 'bzrv-btn';
    mgrBtn.textContent = mgrCap ? '卡片管理器' : '解锁卡片管理器';
    mgrBtn.addEventListener('click', () => {
      if (!mgrCap) {
        notice(capabilityBlock('cardManager').message, 'warning');
        return;
      }
      this.page = 'manager';
      void this.refreshPanel();
    });
    row.appendChild(mgrBtn);
    holder.appendChild(row);
  }

  /** 「按书档案」内置页（高级档 bookReport）：分组列表 + 一键导出 Markdown。 */
  private fillBooksPage(body: HTMLElement, items: ReviewItem[]): void {
    const wrap = createDiv();
    wrap.className = 'bzrv-book-page';
    if (!canUseCapability('bookReport')) {
      const btn = createEl('button');
      btn.className = 'bzrv-btn bzrv-btn--primary';
      btn.textContent = '解锁按书报告';
      btn.addEventListener('click', () => notice(capabilityBlock('bookReport').message, 'warning'));
      wrap.appendChild(btn);
      body.appendChild(wrap);
      return;
    }
    setMarkup(wrap, booksViewHtml(bookSummariesOf(items)));
    const row = createDiv();
    row.className = 'bzrv-btn-row';
    const exp = createEl('button');
    exp.className = 'bzrv-btn';
    exp.textContent = '导出按书报告（Markdown）';
    exp.addEventListener('click', () => void this.exportBookReport(items));
    row.appendChild(exp);
    wrap.appendChild(row);
    body.appendChild(wrap);
  }

  /** 从面板里导出按书报告；空库给空态文案，不弹「导出成功」骗人。 */
  private async exportBookReport(items: ReviewItem[]): Promise<void> {
    try {
      const { exportBookReportMarkdown } = await import('./export-actions');
      const path = await exportBookReportMarkdown(this.app, items);
      notice(path ? `按书报告已导出：${path}` : '还没有复习数据，没有可导出的按书报告。', path ? 'success' : 'warning');
    } catch (e) {
      notifySaveError(e, '导出按书报告');
    }
  }

  /** 「卡片管理器」内置页（高级档 cardManager）：全部条目的挂起 / 埋藏 / 恢复 / 排期 / 移出。 */
  private fillManagerPage(body: HTMLElement, items: ReviewItem[]): void {
    const wrap = createDiv();
    wrap.className = 'bzrv-mgr-page';
    if (!canUseCapability('cardManager')) {
      const btn = createEl('button');
      btn.className = 'bzrv-btn bzrv-btn--primary';
      btn.textContent = '解锁卡片管理器';
      btn.addEventListener('click', () => notice(capabilityBlock('cardManager').message, 'warning'));
      wrap.appendChild(btn);
      body.appendChild(wrap);
      return;
    }
    setMarkup(wrap, managerViewHtml(items, {
      filter: this.mgrFilter,
      decks: collectFacets(items).decks,
    }));
    body.appendChild(wrap);
    /* 五颗操作按钮是 <i data-lucide> 占位，不 mountIcons 就是五个空白方框——
       面板其它内置页都在渲染后兑现，这里漏了，真机第一眼看不到任何按钮。 */
    mountIcons(wrap);
    if (this.mgrKeepFocus) {
      const q = wrap.querySelector<HTMLInputElement>('[data-fld="mgr-q"]');
      if (q) {
        q.focus();
        q.setSelectionRange(q.value.length, q.value.length);
      }
      this.mgrKeepFocus = false;
    }
    this.bindManagerEvents(wrap, items);
  }

  /** 管理器事件：搜索防抖 + 三个筛选下拉 + 每行五个动作。 */
  private bindManagerEvents(root: HTMLElement, items: ReviewItem[]): void {
    const rerender = (): void => {
      void this.refreshPanel();
    };
    const q = root.querySelector<HTMLInputElement>('[data-fld="mgr-q"]');
    q?.addEventListener('input', () => {
      this.mgrFilter.query = q.value;
      this.mgrKeepFocus = true;
      if (this.filterTimer) window.clearTimeout(this.filterTimer);
      this.filterTimer = window.setTimeout(() => {
        this.filterTimer = null;
        rerender();
      }, 200);
    });
    for (const [fld, key] of [
      ['mgr-kind', 'kind'],
      ['mgr-deck', 'deck'],
      ['mgr-status', 'status'],
    ] as const) {
      const sel = root.querySelector<HTMLSelectElement>(`[data-fld="${fld}"]`);
      sel?.addEventListener('change', () => {
        const value = sel.value;
        if (key === 'kind') this.mgrFilter.kind = value as ItemFilter['kind'];
        else if (key === 'deck') this.mgrFilter.deck = value;
        else this.mgrFilter.status = value as ItemFilter['status'];
        rerender();
      });
    }
    const applyHidden = async (it: ReviewItem, kind: 'suspend' | 'bury' | 'restore'): Promise<void> => {
      if (!this.dataManager) return;
      const next =
        kind === 'suspend'
          ? setSuspended(it, true)
          : kind === 'bury'
            ? buryItem(it, 1)
            : unsuspendAndUnbury(it);
      try {
        await this.dataManager.updateItem(it.filePath, (d) => {
          /* 先清两个标记，再按纯函数结果写回；恢复时 next 没这两个字段，正好清干净 */
          delete d.suspended;
          delete d.buriedUntil;
          if (next.suspended) d.suspended = true;
          if (next.buriedUntil) d.buriedUntil = next.buriedUntil;
        });
        notice(
          kind === 'restore' ? '已恢复：这条回到本轮队列，排期没有变。' : hiddenNotice(kind === 'suspend' ? 'suspended' : 'buried'),
          'success'
        );
        await this.refreshPanel();
      } catch (e) {
        notifySaveError(e, kind === 'restore' ? '恢复条目' : '更新条目状态');
      }
    };
    const remove = async (it: ReviewItem): Promise<void> => {
      if (!this.dataManager) return;
      try {
        /* 卡片走 plan-ops.removeCard（连题库一起清），笔记走 removeNote；两者都进回收站 */
        if (it.kind === 'card') await planRemoveCard(this.dataManager, it.filePath);
        else await planRemoveNote(this.dataManager, it.filePath);
        await this.refreshPanel();
        notifyUndo(`已移出「${it.name}」`, () => {
          void (async () => {
            try {
              await this.dataManager.restoreItem(it);
              await this.refreshPanel();
            } catch (e) {
              notifySaveError(e, '恢复复习条目');
            }
          })();
        });
      } catch (e) {
        notifySaveError(e, '移出复习条目');
      }
    };
    const schedule = async (it: ReviewItem): Promise<void> => {
      if (!this.dataManager) return;
      try {
        const { openFlowDialog } = await import('../core/flow-dialog');
        const choice = await openFlowDialog({
          title: '手动排期',
          message: `给「${it.name}」安排下次复习：可以指定具体日期，或整体顺延 7 天。`,
          actions: [
            { label: '指定日期', value: 'date', cta: true },
            { label: '顺延 7 天', value: 'postpone' },
            { label: '取消', value: 'cancel' },
          ],
        });
        if (choice === 'postpone') {
          const n = await this.dataManager.postponeItems([it.filePath], 7);
          notice(n ? '已顺延 7 天' : '没找到这条', n ? 'success' : 'warning');
        } else if (choice === 'date') {
          const fallback = it.nextReviewDate ? new Date(it.nextReviewDate).toISOString().slice(0, 10) : '';
          const raw = await promptDate(this.app, '下次复习日期（YYYY-MM-DD）：', fallback);
          if (!raw) return;
          const t = Date.parse(raw);
          if (!Number.isFinite(t)) {
            notice('日期看不懂，请用 YYYY-MM-DD 这种写法', 'warning');
            return;
          }
          const ok = await this.dataManager.setNextReview(it.filePath, new Date(t).toISOString());
          notice(ok ? '已改期' : '没找到这条', ok ? 'success' : 'warning');
        }
        if (choice === 'date' || choice === 'postpone') await this.refreshPanel();
      } catch (e) {
        notifySaveError(e, '手动排期');
      }
    };
    root.querySelectorAll<HTMLElement>('.bzrv-mgr-row[data-path]').forEach((row) => {
      const it = items.find((x) => x.filePath === row.dataset.path || x.id === row.dataset.id);
      if (!it) return;
      /* 编辑 / 重新生成从复习界面挪到这里（2026-11-19）：复习时只管回忆，
         要改内容或换 AI 文本，来管理器这一行做。 */
      row.querySelector<HTMLElement>('[data-act="mgr-edit"]')?.addEventListener('click', () => {
        const card = it.card;
        if (!card) return;
        openCardEditor(this.app, it, (values) => {
          void (async () => {
            try {
              await this.dataManager?.updateCard(card.key, { text: values.text, comment: values.comment, manual: true });
              notice('已保存，之后不会被 AI 自动改写', 'success');
              await this.refreshPanel();
            } catch (e) {
              notifySaveError(e, '保存卡片修改');
            }
          })();
        });
      });
      row.querySelector<HTMLElement>('[data-act="mgr-regen"]')?.addEventListener('click', () => {
        void (async () => {
          const { regenerateCardContent } = await import('./index');
          notice('正在重新生成…', 'info');
          const ok = await regenerateCardContent(it.filePath);
          notice(ok ? '已重新生成' : '这次没生成出来（看看 AI 配置）', ok ? 'success' : 'warning');
          if (ok) await this.refreshPanel();
        })();
      });
      row.querySelector<HTMLElement>('[data-act="mgr-suspend"]')?.addEventListener('click', () => void applyHidden(it, 'suspend'));
      row.querySelector<HTMLElement>('[data-act="mgr-bury"]')?.addEventListener('click', () => void applyHidden(it, 'bury'));
      row.querySelector<HTMLElement>('[data-act="mgr-restore"]')?.addEventListener('click', () => void applyHidden(it, 'restore'));
      row.querySelector<HTMLElement>('[data-act="mgr-schedule"]')?.addEventListener('click', () => void schedule(it));
      row.querySelector<HTMLElement>('[data-act="mgr-delete"]')?.addEventListener('click', () => void remove(it));
    });
  }

  /**
   * 「已完成」内置页（2026-11-15）：右上角那颗文件夹+勾不再是「把队列切成单列」的
   * 开关，而是一页真正列完所有复习过的条目，并且每条都能一键移回计划继续排。
   *
   * 以前它只是队列的一个视图切换：看着像归档，其实和列表共用同一批到期数据，
   * 用户根本分不清「已完成」是筛选还是归档。现在它有自己的页、自己的动作。
   */
  private fillArchPage(body: HTMLElement, items: ReviewItem[]): void {
    const done = items.filter((i) => i.completed || i.isCompleted);
    const wrap = createDiv();
    wrap.className = 'bzrv-arch-list';

    if (!done.length) {
      wrap.appendChild(
        uiEmpty({
          icon: 'folder-check',
          title: '还没有复习完的条目',
          desc: '走到最后阶段的条目会收在这里，随时能移回计划',
        })
      );
      body.appendChild(wrap);
      mountIcons(wrap);
      return;
    }

    for (const it of done) {
      const row = createDiv();
      row.className = 'bzrv-arch-row';

      const name = createSpan();
      name.className = 'bzrv-arch-name';
      name.textContent = it.name || it.filePath;
      row.appendChild(name);

      if (it.card) {
        const tag = createSpan();
        tag.className = 'bzrv-q-tag is-kind-card';
        tag.textContent = '划线卡';
        row.appendChild(tag);
      }

      const btn = createEl('button');
      btn.className = 'bzrv-btn bzrv-btn--ghost';
      btn.textContent = '移回计划';
      btn.addEventListener('click', () => {
        void (async () => {
          try {
            await this.dataManager?.updateItem(it.filePath, (entry) => {
              entry.completed = false;
              entry.stage = 0;
              entry.phase = 'ladder';
              entry.pendingRedo = false;
              entry.nextReviewDate = new Date().toISOString();
            });
            notice(`「${it.name || it.filePath}」已移回复习计划`);
            await this.refreshPanel();
          } catch (e) {
            notifySaveError(e, '移回复习计划');
          }
        })();
      });
      row.appendChild(btn);
      wrap.appendChild(row);
    }

    body.appendChild(wrap);
  }

  /** 回收站视图（与队列共用内容区；条目来自 refreshPanel 刷新的缓存） */
  private renderTrash(container: HTMLElement): void {
    setMarkup(container, trashViewHtml(this.trashEntries));
    if (!this.trashEntries.length) {
      const host = container.querySelector('[data-empty-host]');
      if (host) {
        host.appendChild(
          uiEmpty({
            icon: 'trash-2',
            title: '回收站是空的',
            desc: '移出复习计划的条目会先来这里，30 天内都能恢复',
          })
        );
      }
    }
    mountIcons(container);
    container.querySelector('[data-act="close"]')?.addEventListener('click', () => this.hideMain());
    const back = (): void => {
      this.showTrash = false;
      void this.refreshPanel();
    };
    container.querySelectorAll('[data-act="trash-back"]').forEach((el) => el.addEventListener('click', back));
    container.querySelector('[data-act="trash-clear"]')?.addEventListener('click', () => void this.clearTrashFlow());
    container.querySelectorAll<HTMLElement>('[data-restore]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        /* 卡片本身没绑点击（回收站里点一下不该发生任何事），这里 stopPropagation
           只是防以后给行加动作时误触 */
        e.stopPropagation();
        void this.restoreTrashKey(btn.dataset.restore || '');
      });
    });
    container.querySelector('[data-act="trash-restore-all"]')?.addEventListener('click', () => void this.restoreAllTrash());
  }

  /** 批量移出（批 4b）：先进回收站，误删可捞回来 */
  private async batchRemove(): Promise<void> {
    const keys = [...this.selected];
    if (!keys.length) {
      notice('先点几张卡片选中', 'warning');
      return;
    }
    const v = await openFlowDialog({
      title: `移出 ${keys.length} 条？`,
      message: '移出后先进回收站，30 天内都能恢复，排期与复习历史一并保留。',
      actions: [
        { label: '取消', value: 'cancel' },
        { label: '移出', value: 'ok', cta: true, danger: true },
      ],
    });
    if (v !== 'ok') return;
    try {
      const n = await this.dataManager.removeItems(keys);
      notice(`已移出 ${n} 条，可在回收站恢复`, 'success');
      this.selected.clear();
      this.selectMode = false;
    } catch (e) {
      notifySaveError(e, '移出复习计划');
    }
    await this.refreshPanel();
  }

  /** 批量顺延（批 4b）：出差一周回来再说的场景 */
  private async batchPostpone(): Promise<void> {
    const keys = [...this.selected];
    if (!keys.length) {
      notice('先点几张卡片选中', 'warning');
      return;
    }
    try {
      const n = await this.dataManager.postponeItems(keys, 7);
      notice(`已把 ${n} 条顺延 7 天`, 'success');
      this.selected.clear();
      this.selectMode = false;
    } catch (e) {
      notifySaveError(e, '批量顺延');
    }
    await this.refreshPanel();
  }

  /** 全部恢复（清空回收站之前的那条退路） */
  private async restoreAllTrash(): Promise<void> {
    const keys = this.trashEntries.map((e) => e.key);
    if (!keys.length) return;
    try {
      const n = await this.dataManager.restoreFromTrash(keys);
      notice(n ? `已恢复 ${n} 条` : '没有可恢复的条目', n ? 'success' : 'warning');
      if (n) {
        const { reviewApp } = await import('./app');
        await reviewApp.applyReviewStyles(this.app);
      }
    } catch (e) {
      notifySaveError(e, '恢复复习条目');
    }
    await this.refreshPanel();
  }

  /** 恢复一条（逐条恢复：来这里的用户通常只想捞回刚误删的那一条） */
  private async restoreTrashKey(key: string): Promise<void> {
    if (!key) return;
    try {
      const n = await this.dataManager.restoreFromTrash([key]);
      if (!n) {
        notice('这条已经不在回收站了', 'warning');
      } else {
        notice('已恢复，排期和复习历史都回来了', 'success');
        const { reviewApp } = await import('./app');
        await reviewApp.applyReviewStyles(this.app);
      }
    } catch (e) {
      notifySaveError(e, '恢复复习条目');
    }
    await this.refreshPanel();
  }

  /** 清空回收站（不可恢复，先问一句） */
  private async clearTrashFlow(): Promise<void> {
    const count = this.trashEntries.length;
    if (!count) return;
    const v = await openFlowDialog({
      title: '清空回收站？',
      message: `这 ${count} 条会被彻底删掉，排期与复习历史一起消失。`,
      actions: [
        { label: '取消', value: 'cancel' },
        { label: '清空', value: 'ok', cta: true, danger: true },
      ],
    });
    if (v !== 'ok') return;
    try {
      await this.dataManager.clearTrash();
      notice('回收站已清空', 'success');
    } catch (e) {
      notifySaveError(e, '清空回收站');
    }
    await this.refreshPanel();
  }

  /** 切回队列视图（冲刺结束回调）；遇仍活动的会话先销毁再置空（防孤儿 ESC 层） */
  async showQueue(): Promise<void> {
    if (!this.entriesContainer) return;
    const active = this.sprint;
    this.sprint = null;
    active?.destroy();
    this.cardSession?.destroy();
    this.cardSession = null;
    await this.refreshPanel();
  }

  // ================= 队列视图 HTML（markup 单源：render.queueViewHtml，issue 253） =================

  /** R 阈值提前复习判定（item 6：与开始本轮同口径；wSource=拟合权重） */
  private rThreshold(): number {
    const s = tryGetSettings();
    return Number(s?.reviewRThreshold) || DEFAULT_R_THRESHOLD;
  }

  private queueViewHtml(items: ReviewItem[], decks: string[] = []): string {
    return queueViewHtml(items, {
      showArchived: this.showArchived,
      rThreshold: this.rThreshold(),
      w: this.wSource(),
      trashCount: this.trashCount,
      filterText: describeFilter(this.filter),
      selectMode: this.selectMode,
      selected: this.selected,
      filterOpen: this.filterOpen && !this.showArchived,
      filter: this.filter,
      activePage: this.page ?? undefined,
      decks,
    });
  }

  // ================= 设置层（不再注册原生设置页） =================

  /**
   * 打开设置（批 8：改成面板内置页，不再是浮层弹窗）。
   *
   * 与 bz Reader 同一形态：用户在哪用这个插件，就在哪改它的设置。原生设置页
   * 那套 PluginSettingTab 已删——两处设置最容易长出「同一个开关两个名字」。
   */
  async openSettings(): Promise<void> {
    this.page = 'settings';
    void this.showMain();
    await this.refreshPanel();
  }

  /** 打开「数据」内置页（命令与右上角那颗图钉共用一条路，不再有第二套弹窗） */
  async openData(): Promise<void> {
    this.page = 'stats';
    void this.showMain();
    await this.refreshPanel();
  }

  /** 打开「已完成」内置页 */
  async openArchive(): Promise<void> {
    this.page = 'arch';
    void this.showMain();
    await this.refreshPanel();
  }

  /** 打开「按书档案」内置页（review-book-report 命令走这里） */
  async openBooks(): Promise<void> {
    this.page = 'books';
    void this.showMain();
    await this.refreshPanel();
  }

  /** 打开「卡片管理器」内置页（review-card-manager 命令走这里） */
  async openManager(): Promise<void> {
    this.page = 'manager';
    void this.showMain();
    await this.refreshPanel();
  }

  /**
   * 头行四个图标的点击（2026-11-19 口径：点一下高亮进页，再点一下回主列表）。
   * 主队列与内置页共用 panelHeadHtml，所以绑定也共用这一份，不再各写一套。
   */
  private bindPanelHead(container: HTMLElement): void {
    const go = (page: 'settings' | 'stats' | 'arch'): void => {
      this.page = this.page === page || this.page ? null : page;
      void this.refreshPanel();
    };
    container.querySelector('[data-act="settings"]')?.addEventListener('click', () => go('settings'));
    container.querySelector('[data-act="data"]')?.addEventListener('click', () => go('stats'));
    container.querySelector('[data-act="arch"]')?.addEventListener('click', () => go('arch'));
    container.querySelector('[data-act="filter"]')?.addEventListener('click', () => {
      if (this.page) {
        this.page = null;
      } else {
        this.filterOpen = !this.filterOpen;
        this.keepFilterFocus = this.filterOpen;
      }
      void this.refreshPanel();
    });
  }

  // ================= 队列事件 =================

  private bindQueueEvents(container: HTMLElement, items: ReviewItem[]): void {
    this.bindPanelHead(container);
    /* 「开始本轮」用 data-bound 防重绑：这个按钮在重绘时会被上一轮的节点顶回来
       （见 renderEntries 里的节点复用），若每次渲染都 addEventListener，同一个节点上
       会叠出两三份监听，一次点击跑两遍 beginRound。 */
    const beginBtn = container.querySelector<HTMLElement>('[data-act="begin"]');
    if (beginBtn && beginBtn.dataset.bound !== '1') {
      beginBtn.dataset.bound = '1';
      beginBtn.addEventListener('click', () => {
        const strip = container.querySelector<HTMLElement>('.bzrv-q-strip');
        if (strip) motionChargeStrip(strip); // 蓄力涟漪：出发的召唤感
        void this.beginRound();
      });
    }
    // 回收站入口（只在有内容时渲染）：与归档互斥，进回收站先把归档关掉
    container.querySelector('[data-act="trash"]')?.addEventListener('click', () => {
      this.showTrash = true;
      this.showArchived = false;
      void this.refreshPanel();
    });
    // 累计/连续 chip = 直开记忆分析特刊（2026-09-23 拍板：去掉中间统计弹窗与「记忆分析」
    // 入口字样；analysis/ 动态 import 不拖主包，空库/无动画宿主在层内回落经典统计）
    container.querySelector('[data-act="stats"]')?.addEventListener('click', () => {
      void (async () => {
        const { openReviewAnalysis } = await import('./analysis/index');
        await openReviewAnalysis(this.app);
      })();
    });
    // item 10：空态两条路（把当前笔记加入复习 / 监听文件夹配置说明）
    container.querySelector('[data-act="add-current"]')?.addEventListener('click', () => void this.addCurrentNote());
    container.querySelector('[data-act="watch-help"]')?.addEventListener('click', () => void this.showWatchHelp());
    // 筛选（批 8：就地展开，不再弹原生弹窗）的图标绑定已并入 bindPanelHead；
    // 下面只管筛选区里的关键字与三个下拉。
    // 筛选区控件：关键字防抖 220ms，三个下拉即时生效（没有「应用」这一步）
    container.querySelectorAll<HTMLElement>('[data-fld]').forEach((el) => {
      const fld = el.dataset.fld || '';
      if (el.instanceOf(HTMLInputElement)) {
        el.addEventListener('input', () => {
          this.filter.query = el.value;
          this.keepFilterFocus = true;
          if (this.filterTimer) window.clearTimeout(this.filterTimer);
          this.filterTimer = window.setTimeout(() => void this.refreshPanel(), 220);
        });
      } else if (el.instanceOf(HTMLSelectElement)) {
        el.addEventListener('change', () => {
          if (fld === 'kind') this.filter.kind = el.value as ItemFilter['kind'];
          else if (fld === 'deck') this.filter.deck = el.value;
          else if (fld === 'status') this.filter.status = el.value as ItemFilter['status'];
          this.selected.clear();
          void this.refreshPanel();
        });
      }
    });
    // 「清除」在筛选区和筛选中条上各有一颗，两颗都要绑
    container.querySelectorAll('[data-act="filter-clear"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.filter = {};
        this.keepFilterFocus = this.filterOpen;
        void this.refreshPanel();
      });
    });
    container.querySelector('[data-act="filter-close"]')?.addEventListener('click', () => {
      this.filterOpen = false;
      void this.refreshPanel();
    });
    container.querySelector('[data-act="select"]')?.addEventListener('click', () => {
      this.selectMode = !this.selectMode;
      this.selected.clear();
      void this.refreshPanel();
    });
    // 头行没有「批量」之后，底栏这颗是唯一入口
    container.querySelector('[data-act="batch"]')?.addEventListener('click', () => {
      this.selectMode = !this.selectMode;
      this.selected.clear();
      void this.refreshPanel();
    });
    container.querySelector('[data-act="batch-cancel"]')?.addEventListener('click', () => {
      this.selectMode = false;
      this.selected.clear();
      void this.refreshPanel();
    });
    container.querySelector('[data-act="batch-delete"]')?.addEventListener('click', () => void this.batchRemove());
    container.querySelector('[data-act="batch-postpone"]')?.addEventListener('click', () => void this.batchPostpone());

    // 搜索框已退役（issue 254 迭代拍板）
    // 卡片点击（到期条目 → 单条冲刺；.no = 未来/不可做，div 无 disabled 用类排除）
    container.querySelectorAll<HTMLElement>('.bzrv-q-card[data-id]').forEach((card) => {
      const activate = () => {
        const path = card.dataset.path || '';
        /* 选择模式下点卡片 = 勾选，不打开笔记：打开笔记会把面板顶掉，等于选不了第二条 */
        if (this.selectMode) {
          if (!path) return;
          if (this.selected.has(path)) this.selected.delete(path);
          else this.selected.add(path);
          card.classList.toggle('is-picked', this.selected.has(path));
          const check = card.querySelector<HTMLElement>('.bzrv-q-check');
          if (check) {
            check.classList.toggle('is-on', this.selected.has(path));
            check.textContent = this.selected.has(path) ? '✓' : '';
          }
          const strip = container.querySelector<HTMLElement>('.bzrv-q-strip.is-batch strong');
          if (strip) strip.textContent = `已选 ${this.selected.size} 条`;
          return;
        }
        const it = items.find((x) => x.id === card.dataset.id);
        if (it && isPlayable(it)) {
          motionDrawCard(card); // 抽卡手感：先一记「抽走」再切题面
          void this.beginSingle(it);
        }
      };
      card.addEventListener('click', activate);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activate();
        }
      });
    });
    /* 挂着的卡（文件缺失）：点下去原来毫无反应，右键菜单里的「打开原文」也用不了，
       条目就成了一颗看得见摸不着的死钉子。给一个明确出口——问一句要不要移出。 */
    container.querySelectorAll<HTMLElement>('.bzrv-q-card.missing[data-id]').forEach((card) => {
      const handle = (): void => {
        const it = items.find((x) => x.id === card.dataset.id);
        if (!it) return;
        void openFlowDialog({
          title: '这篇笔记不在了',
          message: `「${it.name}」的文件找不到（可能被删除、改名或移走了）。要把它移出复习计划吗？移出后可以重新加入。`,
          actions: [
            { label: '留着', value: 'cancel' },
            { label: '移出', value: 'ok', cta: true, danger: true },
          ],
        }).then(async (v) => {
          if (v !== 'ok' || !this.dataManager) return;
          try {
            await planRemoveNote(this.dataManager, it.filePath);
            notice('已移出复习计划', 'success');
          } catch (e) {
            notifySaveError(e, '移出复习计划');
          }
          await this.refreshPanel();
        });
      };
      card.addEventListener('click', handle);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handle();
        }
      });
    });
    // 右键/长按抽屉（保留既有统一抽屉：打开原文/查看历史/移出）
    container.querySelectorAll('.bzrv-q-card[data-id]').forEach((card) => {
      this.attachDrawer(card as HTMLElement, items);
    });
  }

  // ================= 空态两条路（item 10） =================

  /** 把当前笔记加入复习（空库引导动作；命令同语义） */
  private async addCurrentNote(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      notice('请先打开一个笔记', 'warning');
      return;
    }
    const { reviewApp } = await import('./app');
    try {
      await reviewApp.addCurrentToReview(file);
      await this.refreshPanel();
      await reviewApp.applyReviewStyles(this.app);
    } catch (e: unknown) {
      // C9：动作失败提示走 core 单源（不再手拼「X失败：msg，请重试」）
      notifyActionError(e, '加入复习计划');
    }
  }

  /** 配置监听文件夹说明（空库引导动作；设置面板路径指路） */
  private async showWatchHelp(): Promise<void> {
    await openFlowDialog({
      title: '配置监听文件夹',
      message: '打开 设置 → 复习计划 → 监听文件夹，添加文件夹后，其中新建的笔记会自动加入复习计划；已存在的笔记可在添加时选择一并加入。',
      actions: [{ label: '知道了', value: 'ok', cta: true }],
    });
  }

  // ================= 冲刺入口（连接 app 编排） =================

  private async beginRound(): Promise<void> {
    if (this.sprintStarting) return; // 双击/并发防抖：只放行一次
    this.sprintStarting = true;
    try {
      const { reviewApp } = await import('./app');
      await reviewApp.autoJumpOverdue();
    } finally {
      this.sprintStarting = false;
    }
  }

  private async beginSingle(item: ReviewItem): Promise<void> {
    if (this.sprintStarting) return; // 双击/并发防抖：只放行一次
    this.sprintStarting = true;
    try {
      /* 划线卡没有文件可开，走自己的会话；别让它掉进做题冲刺（那里一进
         就去读笔记的题库，卡片会拿到空题、被当成「本篇没题」跳过） */
      if (isCardItem(item)) {
        await this.startCardRound([item]);
        return;
      }
      const { reviewApp } = await import('./app');
      await reviewApp.startSingleSprint(item);
    } finally {
      this.sprintStarting = false;
    }
  }

  /**
   * 划线卡复习：宿主内容区交给卡片会话。
   *
   * 与做题冲刺互斥——两者都接管 `#bzrv-entries`，旧的不销毁就会
   * 出现「卡片盖着题面、ESC 关错层」。
   *
   * `onDone`：整轮卡片走完后调用（「开始本轮」据此接上同批的笔记复习）。
   */
  async startCardRound(queue: ReviewItem[], onDone?: () => void): Promise<void> {
    const container = this.entriesContainer;
    if (!container || !queue.length) return;
    /* 二次确认放在所有销毁动作**之前**：用户点取消时面板里该是什么还是什么，
       不能先把上一轮的会话拆掉、再问「要不要开始」。 */
    if (!(await this.confirmCardStart(queue))) return;
    const prevSprint = this.sprint;
    this.sprint = null;
    prevSprint?.destroy();
    this.cardSession?.destroy();
    const { reviewApp } = await import('./app');
    const mode = cardModeOf();
    /* 生成完把卡的最新内容换进队列——否则界面还拿着进会话时的旧卡（问答/挖空/题库都是空的） */
    const refreshCard = async (item: ReviewItem): Promise<void> => {
      const fresh = await this.dataManager?.loadItems();
      const latest = fresh?.find((i) => i.filePath === item.filePath);
      if (latest?.card) item.card = latest.card;
    };
    const session = new CardSession({
      app: this.app,
      host: container,
      queue,
      mode,
      ratio: cardQuizRatioOf(),
      onRate: async (item, rating) => {
        await reviewApp.markReview(item.filePath, rating, { autoPending: true });
      },
      /* 抽认卡：卡上没有问句时（加入时没配 AI / 生成失败）现场补一次。
         拿到合格问句就存进卡里，下次直接复用；拿不到返回 null，会话退回内置提示。 */
      ask: async (item) => {
        if (cardModeOf() !== 'flashcard') return null;
        const card = item.card;
        if (!card) return null;
        const res = await generateFlashcard(card, () => createAI());
        if (!res) return null;
        try {
          await this.dataManager?.updateCard(card.key, { qa: { q: res.q, a: res.a, at: Date.now() } });
        } catch {
          /* 存不上也照常显示这一次 */
        }
        return res;
      },
      /* 做题：题库在加入计划时就生成好了，这里只读 */
      loadQuiz: async (item) => {
        try {
          return await getCardQuiz(item.filePath);
        } catch {
          return null;
        }
      },
      /* 缺内容时现场补一次（改复习方式后的存量卡全靠这条）：
         内容原本只在「加入那一刻」生成，用户之后从抽认卡改成填空 / 做题，
         存量卡一张都不会补，整轮复习全是「先看原文」。生成后把最新内容换进队列，
         否则界面还显示旧的。 */
      ensureContent: async (item) => {
        /* 手改过的卡不自动补：用户刚写的内容不该被后台生成顶掉（批 2）。
           内容是齐的，直接说「有了」，会话照常往下走。 */
        if (item.card?.manual) return true;
        const { regenerateCardContent } = await import('./index');
        const ok = await regenerateCardContent(item.filePath);
        if (ok) await refreshCard(item);
        return ok;
      },
      /* 重新生成：两个 AI 方式都能点，生成完把卡的最新内容换进队列（否则界面还显示旧的） */
      regenerate: async (item) => {
        const { regenerateCardContent } = await import('./index');
        const ok = await regenerateCardContent(item.filePath);
        if (ok) await refreshCard(item);
        return ok;
      },
      /* 手改卡片：落盘时打 manual 标记，之后后台预生成不再碰它（点「重新生成」仍可覆盖） */
      onEdit: async (item, values) => {
        const key = item.card?.key;
        if (!key) return;
        await this.dataManager?.updateCard(key, { text: values.text, comment: values.comment, manual: true });
        await refreshCard(item);
      },
      onExit: (completed) => {
        this.cardSession = null;
        void this.showQueue();
        /* 中途 ESC 退出不接下一批——用户明显是想停下 */
        if (completed) onDone?.();
      },
    });
    this.cardSession = session;
    session.start();
  }

  /**
   * 开卡前的二次确认（2026-11-15）。
   *
   * 只在**单张开卡**时问：整轮十几张卡逐张弹框会把人烦死，而且那本来就不是
   * 「我想先看一眼这张卡」的语境。抽认卡让改问句和原文、做题卡让删题，
   * 其余方式没有可改的东西就不弹空框。返回 false = 用户取消了，别开会话。
   */
  private async confirmCardStart(queue: ReviewItem[]): Promise<boolean> {
    if (queue.length !== 1) return true;
    if (!(getSettings()).reviewCardConfirm) return true;
    const item = queue[0];
    const card = item.card;
    if (!card) return true;
    const mode = modeOfCard(card);
    if (!needsCardConfirm(mode)) return true;

    const questions = mode === 'quiz' ? ((await getCardQuiz(card.key)) ?? undefined) : undefined;
    /* 题库还没生成（没配 AI / 加入时生成失败）：没有可删的题，弹出来只会看到一个
       空列表和一个点不动的「开始」。交给会话自己去补内容 / 降级看全文。 */
    if (mode === 'quiz' && !questions?.length) return true;
    const res = await confirmBeforeRound({
      item,
      mode,
      questions,
      regenerateQuiz:
        mode === 'quiz'
          ? async () => {
              const { regenerateCardContent } = await import('./index');
              await regenerateCardContent(item.filePath);
              return (await getCardQuiz(card.key)) ?? null;
            }
          : undefined,
      regenerateAsk:
        mode === 'flashcard'
          ? async () => {
              try {
                return await generateFlashcard(card, () => createAI());
              } catch {
                return null;
              }
            }
          : undefined,
    });
    if (!res.go) return false;

    if (mode === 'flashcard') {
      const patch: Partial<ReviewCard> = {};
      const nextText = typeof res.text === 'string' ? res.text : card.text;
      if (nextText !== card.text) patch.text = nextText;
      const nextQ = String(res.question ?? '').trim();
      if (nextQ && nextQ !== card.qa?.q) patch.qa = { q: nextQ, a: nextText, at: Date.now() };
      if (Object.keys(patch).length) {
        patch.manual = true; // 手改过就不要再被后台预生成顶掉
        try {
          await this.dataManager?.updateCard(card.key, patch);
          Object.assign(card, patch);
        } catch (e) {
          notifySaveError(e, '保存卡片修改');
        }
      }
      return true;
    }

    /* 做题卡：删题只在确认时生效。全删光就不让开始——不然进会话拿不到题，
       会被当成「本篇没题」直接跳过，用户以为自己白点了一次。 */
    const left = res.questions ?? [];
    if (!left.length) {
      notice('这一轮的题都删掉了：先点「重新生成整份题库」，或把删掉的补回来');
      return false;
    }
    if (left.length !== (questions?.length ?? 0)) {
      try {
        await saveCardQuiz(card.key, left);
      } catch (e) {
        notifySaveError(e, '保存题库');
      }
    }
    return true;
  }

  /** 队列里所有到期卡片（给「开始本轮」按类型分流用） */
  cardQueueOf(items: ReviewItem[]): ReviewItem[] {
    return items.filter((i) => isCardItem(i) && isPlayable(i));
  }

  /** 供 app 编排：进入做题冲刺会话（宿主接管内容区）。
   *  互斥：进入前强制销毁旧会话（防孤儿冲刺 ESC 层 + 旧题面覆盖队列视图）。 */
  startSprint(opts: {
    queue: ReviewItem[];
    mode: SprintMode;
    quiz: QuizMasterUI | null;
    /** item 8：连续复习天数（结算屏展示；由 app 层 computeStats 算好传入） */
    streakDays?: number;
    fetchQuestions: (item: ReviewItem) => Promise<QuizQuestion[] | null>;
    onPassed: (item: ReviewItem, rating: string, entry: { acc: number; wrong: number }) => Promise<string | void>;
    onFailed: (item: ReviewItem, rating: string, entry: { acc: number; wrong: number }) => Promise<void>;
  }): Promise<'done' | 'quit' | 'fail'> {
    const container = this.entriesContainer;
    if (!container) return Promise.resolve('quit');
    const old = this.sprint;
    this.sprint = null;
    old?.destroy();
    this.sprint = new SprintSession({
      app: this.app,
      host: container,
      queue: opts.queue,
      mode: opts.mode,
      quiz: opts.quiz,
      streakDays: opts.streakDays,
      fetchQuestions: opts.fetchQuestions,
      onPassed: opts.onPassed,
      onFailed: opts.onFailed,
      onExit: () => {
        void this.showQueue();
      },
    });
    return this.sprint.start();
  }

  // ================= 难度弹窗（评分命令用；U4/A4/E7/U10 迁 openFlowDialog choice 形态） =================

  /** 四档评级 + 取消：ESC/遮罩/焦点圈闭/关闭还原焦点全由 core flow-dialog 单源收口
   *  （旧自绘 .difficulty-dialog 的 ESC 关错层、外点穿透、companion 残留随之消亡）。
   *  1-4 直达档位（对齐做题模式键盘化拍板）；onSelect 的 promise 兜底 catch + notifySaveError。 */
  showDifficultyDialog(item: ReviewItem, onSelect?: (diff: string) => void): void {
    const report = (diff: string): void => {
      if (!onSelect) return;
      try {
        // 调用方（bz-review-rate 命令）实为 async 回调：签名 void 但运行时返回 promise，
        // 兜底 catch 防 unhandled rejection（U10）
        const r = onSelect(diff) as unknown;
        if (r instanceof Promise) r.catch((e: unknown) => notifySaveError(e, '标记复习'));
      } catch (e) {
        notifySaveError(e, '标记复习');
      }
    };
    // 1-4 快捷键：flow-dialog 多动作按钮 id 契约 `bz-flow-dialog-action-<i>`；修饰键组合不劫持；
    // settle 后按钮 DOM 已移除，getElementById 自然失配（监听随 promise 结算统一摘除）
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const i = ['1', '2', '3', '4'].indexOf(e.key);
      if (i < 0) return;
      const btn = document.getElementById(`bz-flow-dialog-action-${i}`);
      if (btn) {
        e.preventDefault();
        btn.click();
      }
    };
    document.addEventListener('keydown', onKey);
    void openFlowDialog({
      title: `标记复习：${item.name}`,
      message: '选择本次复习的难度（快捷键 1-4）',
      actions: [
        { label: '忘了（Again）', value: 'again' },
        { label: '困难（Hard）', value: 'hard' },
        { label: '一般（Good）', value: 'good' },
        { label: '简单（Easy）', value: 'easy' },
        { label: '取消', value: 'cancel' },
      ],
    }).then((v) => {
      document.removeEventListener('keydown', onKey);
      if (v && v !== 'cancel') report(v);
    });
  }

  // ================= 抽屉（右键/长按） =================

  private attachDrawer(card: HTMLElement, items: ReviewItem[]): void {
    const item = items.find((x) => x.id === card.dataset.id);
    if (!item) return;
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      void this.openDrawer(item, e.clientX, e.clientY);
    });
  }

  private async openDrawer(item: ReviewItem, x: number, y: number): Promise<void> {
    const { openItemMenu, resetItemMenuClickGuard } = await import('../core/item-actions');
    const actions: ItemActionLite[] = [
      /* 划线卡没有文件可开，换成「重新生成」——AI 内容在加入时生成一次，
         想换只能从这里（或复习会话里）点。 */
      ...(isCardItem(item)
        ? [
            {
              icon: 'refresh-cw',
              label: '重新生成 AI 内容',
              onClick: () => {
                void (async () => {
                  const { regenerateCardContent } = await import('./index');
                  notice('正在重新生成…', 'info');
                  const ok = await regenerateCardContent(item.filePath);
                  notice(
                    ok ? '已重新生成' : '这次没生成出来（看看 AI 配置）',
                    ok ? 'success' : 'warning'
                  );
                  if (ok) await this.refreshPanel();
                })();
              },
            } as ItemActionLite,
          ]
        : [
            {
              icon: 'file-text',
              label: '打开原文',
              onClick: () => void this.openItemFile(item),
            },
          ]),
      {
        icon: 'history',
        label: '查看历史',
        onClick: () => {
          void (async () => {
            const { showTimeline } = await import('./stats-ui');
            void showTimeline(this.app, this.dataManager, item);
          })();
        },
      },
      {
        icon: 'trash-2',
        label: '移出复习计划',
        kind: 'danger',
        onClick: () => {
          // E1/C1（效率整改 5 口径）：撤销链已在位（notifyUndo + restoreItem 原样插回），
          // 删除免确认直达——不再弹 openFlowDialog 双保险
          void (async () => {
            try {
              /* 卡片走 plan-ops.removeCard：顺手把题库一起清掉，不然反复加/移同一段
                 划线，旧题会一直堆在 review-quiz.json 里 */
              if (isCardItem(item)) {
                const { removeCard } = await import('./plan-ops');
                await removeCard(this.dataManager, item.filePath);
              } else {
                await this.dataManager.removeItem(item.filePath);
              }
              await this.refreshPanel();
              const { reviewApp } = await import('./app');
              await reviewApp.applyReviewStyles(this.app);
              notifyUndo(`已移出「${item.name}」`, () => {
                void (async () => {
                  try {
                    await this.dataManager.restoreItem(item);
                    await this.refreshPanel();
                    const { reviewApp: ra } = await import('./app');
                    await ra.applyReviewStyles(this.app);
                  } catch (e) {
                    notifySaveError(e, '恢复复习条目');
                  }
                })();
              });
            } catch (e) {
              notifySaveError(e, '移出复习条目');
            }
          })();
        },
      },
    ];
    // 跟手菜单直开（2026-09-23 修复「要按两次右键」：原先误调 attachItemActions——那是给卡片
    // 绑定监听的辅助，首按只挂监听不弹层，二按才真正开菜单）；bz-rv-menu = 面板同皮（styles.css）
    openItemMenu(x, y, actions, true, 'bz-rv-menu');
    resetItemMenuClickGuard();
  }

  private async openItemFile(item: ReviewItem): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(item.filePath);
    if (!(file instanceof TFile)) {
      notice(`笔记「${item.name}」的文件已删除`, 'warning');
      return;
    }
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
  }
}

/** 抽屉动作轻类型（避免引 core 类型依赖闭环） */
interface ItemActionLite {
  icon: string;
  label: string;
  kind?: 'danger';
  onClick: () => void;
}

// ================= 普通复习悬浮迷你评级条（item 4） =================

/** 屏幕底部挂悬浮迷你评级条（reviewLoop 存续期间）。返回句柄供收起（close 幂等）。
 *  issue 253：markup 单源 render.reviewBarHtml（四档语义/评级 class 契约不变）。
 *  呈报#12-R8 键盘化：挂载即焦点入条（tabindex=-1 容器）→ 数字键 1-4 评级（翻篇主路径
 *  全程可键盘完成）；焦点被用户主动拿回输入框/文本域时数字键放行（不劫持打字）；
 *  ESC 在条内局部监听归还焦点（条保留，复习未完可再评级）——不私挂 document 级 ESC
 *  （esc-manager 立约：ESC 一律走层级注册）。close 时注销 document 数字键监听。 */
export function mountFloatingRatingBar(opts: {
  name: string;
  index: number;
  total: number;
  /** 还剩下几条（不含当前这条）：进度后面显示「剩 n 条 · 约 m 分钟」 */
  remaining?: number;
  onRate: (rating: 'again' | 'hard' | 'good' | 'easy') => void;
  onSkip: () => void;
  /** 暂停本轮（评完当前这条停下，断点保留） */
  onPause?: () => void;
}): { close: () => void } {
  const el = createDiv();
  el.className = 'bzrv-review-bar';
  el.style.zIndex = String(allocZ());
  const keys = (getSettings()).reviewRatingKeys;
  setMarkup(el, reviewBarHtml({ ...opts, keys }));
  el.tabIndex = -1; // 程序化 focus 落点（容器不进 Tab 序，键盘 Tab 仍直达各评级按钮）
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onDigitKey);
    el.remove();
    // 通知容器据此让位（手机上通知正好落在条子上，会盖住「暂停」这颗按钮）
    if (!document.querySelector('.bzrv-review-bar')) document.body.classList.remove('bzrv-bar-on');
  };
  el.querySelectorAll<HTMLButtonElement>('.bzrv-review-bar-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const r = btn.dataset.rating;
      if (r === 'skip') opts.onSkip();
      else if (r === 'pause') opts.onPause?.();
      else if (r === 'again' || r === 'hard' || r === 'good' || r === 'easy') opts.onRate(r);
      close(); // 点评级/跳过即收起（评级路径由轮询翻篇重建下一条的评级条）
    });
  });
  /* 评级键改走设置里的键位（批 2）：原来写死 1-4，换键位后按钮提示与键盘要同源，
     否则界面写 1 实际得按 a。输入态一律放行，不劫持打字。 */
  const onDigitKey = (e: KeyboardEvent): void => {
    if (closed) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const r = ratingForKey(e.key, keys);
    if (!r) return;
    const btn = el.querySelector<HTMLButtonElement>(`.bzrv-review-bar-btn[data-rating="${r}"]`);
    if (btn) {
      e.preventDefault();
      btn.click();
    }
  };
  document.addEventListener('keydown', onDigitKey);
  // ESC 归还焦点：条内局部监听（keydown 自条冒泡，容器截停后不到 document/escManager）——
  // 只归还焦点不关条：普通轮尚未结束，条消失键盘用户就没有评级入口了
  const prevFocus = document.activeElement as HTMLElement | null;
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    if (prevFocus && typeof prevFocus.focus === 'function' && prevFocus !== document.body) prevFocus.focus();
    else el.blur();
  });
  markOwned(el);
  document.body.appendChild(el);
  // 通知容器据此上移让位；close 时摘掉（见上）
  document.body.classList.add('bzrv-bar-on');
  motionRatingBar(el); // 底部弹升入场（保留 translateX(-50%) 居中）
  el.focus({ preventScroll: true });
  return { close };
}
