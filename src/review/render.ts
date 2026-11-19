/**
 * 复习计划渲染纯层（issue 253：markup 单源收编，ADR-0104/0106 范式）
 *
 * markup 唯一出处：三区队列（头行/工具行/开始本轮条/三区列/底部信息行/空态宿主）、
 * 整窗冲刺（头行/加载/题卡/本轮队列/结果卡/结算屏）、难度弹窗、悬浮迷你评级条。
 * 插件 ui.ts / sprint.ts 消费同一份（旧评审壳已退役，ADR-0276）。
 *
 * 纯度契约（纯度现为约定）：import 图仅限本域 + 零模块级可变状态；
 * 禁 obsidian/moment/core 服务。日期一律「now 参数注入」——可测、可重放。
 */
import { emptyHtmlStr, esc, iconSpan, stripTitleMarks } from '../core/ui/str';
import type { ReviewItem } from './data';
import { TRASH_LIMIT, TRASH_TTL_DAYS, type TrashEntry } from './trash';
import { applyFilter, deckOf, type ItemFilter } from './deck';
import { isBuried, isHiddenFromQueue } from './card-manager';
import type { BookSummary } from './book-summary';
import { DEFAULT_W, TOTAL_STAGES, currentR as fsrsCurrentR } from './fsrs';
import { partitionQueue, etaTextOf, isEarlyDue, isDueToday } from './queue';
import { compareReviewLoad, computeStats, RATING_NAMES } from './stats';
import { ratingKeys } from './keys';

/** 题面结构面（对齐 quiz-core/manager 的 QuizQuestion；此处只读 markup 所需字段） */
interface QuestionLike {
  question: string;
  options: string[];
  correctIndices: number[];
  explain?: string;
}

// C4/A8：本地 ESC_MAP + esc() + icon() 已删——转义/图标占位收编 core/ui/str 单源
// （esc / iconSpan `<i data-lucide>`；mountIcons 按 [data-lucide] 属性兑现、class 原样保留，
// 与标签名无关，样式均挂 .bzrv-ic/.bzrv-q-ic/.bzrv-sprint-ic 类，span→i 无行为差异）。
// 原 icon() 默认类 bzrv-q-ic 的调用点改为 iconSpan(name, 'bzrv-q-ic')。

/** 对错标记（lucide check/x 占位；尺寸随 .bzrv-mark 字号档） */
export function markHtml(kind: 'ok' | 'bad', size: '' | 'lg' = ''): string {
  if (kind === 'ok') return `<span class="bzrv-mark ok ${size}"><i data-lucide="check"></i></span>`;
  return `<span class="bzrv-mark bad ${size}"><i data-lucide="x"></i></span>`;
}

/** 头行日期副题：9月9日 周三 */
export function todayLabel(now: Date = new Date()): string {
  const week = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
  return `${now.getMonth() + 1}月${now.getDate()}日 周${week}`;
}

// ==================== 到期/阶段口径 ====================

/** 未来倒计时口径单源（F4）：>0 的毫秒差 → 天/小时/分钟档「N 后」文案。
 *  dueLabelOf 到期标签与 sprint 结果卡「下次 N 后」共用——分钟档 Math.max(1,…)
 *  保底「1 分钟后」，短间隔不再被天数档吞成假「1 天后」 */
export function futureInLabel(diffMs: number): string {
  const days = Math.floor(diffMs / 86400000);
  const hours = Math.floor((diffMs % 86400000) / 3600000);
  if (days > 0) return `${days} 天后`;
  if (hours > 0) return `${hours} 小时后`;
  return `${Math.max(1, Math.floor(diffMs / 60000))} 分钟后`;
}

/** 到期标签（missing → 文件缺失；无排期 → 待定；未来按 天/小时/分钟；其余已逾期） */
export function dueLabelOf(item: ReviewItem, now: number = Date.now()): { label: string; cls: string } {
  if (item.isMissing) return { label: '文件缺失', cls: 'is-missing' };
  if (item.isCompleted) return { label: '已完成', cls: 'is-done' };
  if (!item.nextReviewDate) return { label: '待定', cls: 'is-future' };
  const diff = new Date(item.nextReviewDate).getTime() - now;
  if (diff > 0) return { label: futureInLabel(diff), cls: 'is-future' };
  return { label: '已逾期', cls: 'is-overdue' };
}

/** 是否可做题（到期：逾期/今天；已完成/挂起/未来 → 不可） */
export function isPlayable(item: ReviewItem, now: number = Date.now()): boolean {
  if (item.isMissing || item.isCompleted || item.completed) return false;
  if (!item.nextReviewDate) return false;
  /* 「今天到期但时刻还没到」也算可点：三区列把它放在「今天到期」栏，
     「开始本轮」也明确会提前纳入它（还会弹一条「已提前纳入本轮」）。
     两处口径必须一致——否则列表上那张卡点是没反应的，用户只会以为坏了。 */
  return new Date(item.nextReviewDate).getTime() <= now || isDueToday(item);
}

/** FSRS 相位当前保留率 %（与调度排期同权重源；阶梯/无 lastReviewed → null）。A7：公式单源 fsrs.currentR */
export function currentRPct(item: ReviewItem, w: number[] = DEFAULT_W, now: number = Date.now()): number | null {
  const R = fsrsCurrentR(item, w, now);
  return R === null ? null : Math.round(R * 100);
}

/** 卡片右上阶段号（FSRS Lv.n / 阶梯 n/10 / 挂起） */
export function stageNum(item: ReviewItem): string {
  if (item.isMissing) return '挂起';
  if (item.phase === 'fsrs') {
    const LADDER_MAX = 9;
    return `FSRS Lv.${item.stage - LADDER_MAX + 1}`;
  }
  return `${item.currentStage ?? item.stage + 1}/${TOTAL_STAGES}`;
}

/** 阶段标签（FSRS=R% 分档色 / 阶梯=阶段 n/10 / 已完成） */
export function stageTagHtml(item: ReviewItem, w: number[] = DEFAULT_W, now: number = Date.now()): string {
  if (item.completed) return '<span class="bzrv-q-tag is-done">已完成</span>';
  if (item.phase === 'fsrs') {
    const r = currentRPct(item, w, now);
    if (r !== null) {
      const cls = r >= 90 ? 'r-high' : r >= 70 ? 'r-mid' : 'r-low';
      return `<span class="bzrv-q-tag is-r ${cls}">R=${r}%</span>`;
    }
    return `<span class="bzrv-q-tag is-r">FSRS</span>`;
  }
  return `<span class="bzrv-q-tag is-stage">阶段 ${item.currentStage ?? item.stage + 1}/${TOTAL_STAGES}</span>`;
}

/** 列内排序（V1 拍板：置顶 → R 升序 → 到期时间；阶梯无 R 视为最低优先级靠后。
 *  G4：R 口径权重与卡片展示同源——queueViewHtml 透传 ctx.w（拟合权重），
 *  硬编码 DEFAULT_W 会让排序与卡片 R=xx% 值对不上） */
export function sortColumn(items: ReviewItem[], now: number = Date.now(), w: number[] = DEFAULT_W): ReviewItem[] {
  return items.slice().sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    const ra = a.phase === 'fsrs' && a.stability ? currentRPct(a, w, now) ?? 999 : 999;
    const rb = b.phase === 'fsrs' && b.stability ? currentRPct(b, w, now) ?? 999 : 999;
    if (ra !== rb) return ra - rb;
    return new Date(a.nextReviewDate || 0).getTime() - new Date(b.nextReviewDate || 0).getTime();
  });
}

// ==================== 三区队列视图 ====================

/** 头行入口图标的身份。抽成单源：面板头与 bz-reader 嵌入的外置动作栏共用，
 *  不然两处各写一份，迟早出现「一边叫数据、一边叫统计」或顺序漂移。
 *  trash（已移出）排在与它同源的 arch（已完成）后面：都是「另一份名单」的入口。 */
export const PANEL_HEAD_ACTS = ['filter', 'arch', 'trash', 'data', 'settings'] as const;
export type PanelHeadAct = (typeof PANEL_HEAD_ACTS)[number];

/** data-act → 对应内置页；filter 是就地展开开关，没有「当前页」概念 */
const ACT_PAGE: Readonly<Partial<Record<PanelHeadAct, string>>> = {
  arch: 'arch',
  trash: 'trash',
  data: 'stats',
  settings: 'settings',
};

/** 某颗图标此刻是否高亮。纯函数：外置动作栏的高亮同步复用同一口径，不另写一套 if。 */
export function panelActIsOn(act: PanelHeadAct, activePage?: string | null): boolean {
  const page = ACT_PAGE[act];
  return !!page && page === activePage;
}

/**
 * 只生成四颗图标按钮（不含 .bzrv-panel-head-btns 外壳），给面板头与嵌入门面复用。
 * 可读名只用 sr-only，绝不写 aria-label / title——Obsidian 会把它们变成悬停气泡。
 */
export function panelHeadBtnsHtml(activePage?: string | null): string {
  const on = (act: PanelHeadAct): string => (panelActIsOn(act, activePage) ? ' is-on' : '');
  return `<button data-act="filter" class="bzrv-icon-btn"><span class="bzrv-sr-only">筛选（牌组 / 类型 / 状态）</span>${iconSpan('list-filter', 'bzrv-q-ic')}</button>
<button data-act="arch" class="bzrv-icon-btn${on('arch')}"><span class="bzrv-sr-only">已完成（复习过的条目）</span>${iconSpan('folder-check', 'bzrv-q-ic')}</button>
<button data-act="trash" class="bzrv-icon-btn${on('trash')}"><span class="bzrv-sr-only">已移出（从计划里移走的条目，可以找回）</span>${iconSpan('archive-restore', 'bzrv-q-ic')}</button>
<button data-act="data" class="bzrv-icon-btn${on('data')}"><span class="bzrv-sr-only">数据（统计与负荷）</span>${iconSpan('chart-column', 'bzrv-q-ic')}</button>
<button data-act="settings" class="bzrv-icon-btn${on('settings')}"><span class="bzrv-sr-only">设置</span>${iconSpan('settings', 'bzrv-q-ic')}</button>`;
}

/**
 * 面板头行（主列表与内置页共用）。
 *
 * 2026-11-19 起：右上角关闭按钮撤掉（手机点遮罩退出，桌面本来就没有）；
 * 四个入口图标在高亮态再点一次回主列表，内置页也用这一行，所以不再画「← 返回」。
 * 品牌图标已撤（左栏承担入口）；标题挂 .bzrv-panel-head-title：嵌入 bz-reader 时
 * 藏掉这段（页签文字由宿主画），四颗图标照常渲染、并可外置到宿主动作栏。
 */
export function panelHeadHtml(opts: { activePage?: string; title?: string; sub?: string } = {}): string {
  /* 独立界面的「复习」从左侧竖栏挪到顶部成一个横排页签（2026-11-20，图三形制）。
     它是唯一一个页签——点它回主列表，承接原竖栏 onSelect；其余功能仍在右侧图标。
     页签文字永远固定「复习」两个字：进内置页（数据/设置）也不换成页名，那靠右侧
     图标高亮表达即可（用户口径：这个复习固定显示，别被替换）。
     主队列（无 activePage）时选中；进内置页时淡化，点一下就能回来。
     嵌入 reader 时这一整行由 CSS 收起、页签由宿主画，所以这里统一渲染不影响嵌入态。 */
  const on = opts.activePage ? '' : ' is-on';
  return `
      <div class="bzrv-panel-head">
        <button data-act="home" class="bzrv-panel-head-title bzrv-stutab${on}">${iconSpan(
          'calendar-check',
          'bzrv-stutab-ic',
        )}<span class="bzrv-stutab-txt">复习</span></button>
        <div class="bzrv-panel-head-pipe"></div>
        <div class="bzrv-panel-head-sub">${opts.sub ?? ''}</div>
        <span class="bzrv-panel-head-sp"></span>
        <div class="bzrv-panel-head-btns">
          ${panelHeadBtnsHtml(opts.activePage)}
        </div>
      </div>`;
}

export interface QueueViewCtx {
  now?: number;
  showArchived?: boolean;
  /** R 阈值（提前复习判定；与开始本轮同源） */
  rThreshold?: number;
  /** 调度权重源（拟合权重；缺省回退 DEFAULT_W） */
  w?: number[];
  /** 回收站条数（0/缺省不显示入口——没删过东西时多一个入口只是噪音） */
  trashCount?: number;
  /** 筛选说明（空 = 没筛选）；状态条上显示并给「清除」 */
  filterText?: string;
  /** 批量选择模式：卡片左侧出勾选位，底部换批量操作条 */
  selectMode?: boolean;
  /** 已选条目（filePath 集合） */
  selected?: ReadonlySet<string>;
  /** 当前内置页：对应图标高亮，再点一次回主列表 */
  activePage?: string;
  /** 筛选区展开（批 8：不再弹窗，就地展开在头行下面） */
  filterOpen?: boolean;
  /** 当前筛选（展开时回填控件） */
  filter?: ItemFilter;
  /** 可选牌组（展开时给下拉；由调用方 collectFacets 算好） */
  decks?: readonly string[];
}

const KIND_OPTS: ReadonlyArray<readonly [string, string]> = [
  ['all', '全部类型'],
  ['note', '只看笔记'],
  ['card', '只看划线'],
];
const STATUS_OPTS: ReadonlyArray<readonly [string, string]> = [
  ['all', '不限状态'],
  ['overdue', '只看逾期'],
  ['today', '只看今天'],
  ['future', '只看未来'],
  ['hidden', '只看隐藏'],
];

function optsHtml(opts: ReadonlyArray<readonly [string, string]>, cur: string): string {
  return opts
    .map(([v, label]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${label}</option>`)
    .join('');
}

function colHead(count: number, name: string): string {
  return `<div class="bzrv-q-col-head"><span class="cnt">${count}</span><span class="name">${name}</span></div>`;
}

export function cardHtml(item: ReviewItem, ctx: QueueViewCtx = {}): string {
  const now = ctx.now ?? Date.now();
  const w = ctx.w ?? DEFAULT_W;
  const due = dueLabelOf(item, now);
  const canPlay = isPlayable(item, now) && !item.isMissing;
  const title = item.isCompleted ? `<s>${esc(item.name)}</s>` : esc(item.name);
  const selectMode = ctx.selectMode === true;
  const picked = selectMode && !!ctx.selected?.has(item.filePath);
  const cls = [
    'bzrv-q-card',
    item.isOverdue ? 'danger' : '',
    item.isCompleted ? 'done' : '',
    canPlay ? '' : 'no',
    item.isMissing ? 'missing' : '',
    selectMode ? 'is-selecting' : '',
    picked ? 'is-picked' : '',
  ].join(' ').trim();
  const tags = [
    /* 类型标签。两类条目在队列里长得一模一样，用户分不清「被讨厌的勇气」是那篇
       笔记、而「被讨厌的勇气 · 第一夜」是书里的一条划线——点进去才发现不一样。 */
    item.kind === 'card'
      ? '<span class="bzrv-q-tag is-kind-card">划线</span>'
      : '<span class="bzrv-q-tag is-kind-note">笔记</span>',
    item.isMissing ? `<span class="bzrv-q-tag is-missing">文件缺失</span>` : `<span class="bzrv-q-tag ${due.cls}">${due.label}</span>`,
    // R 阈值提前复习卡挂「提前」tag（与开始本轮同口径，落「今天」列）
    !item.isMissing && isEarlyDue(item, ctx.rThreshold ?? 0.9, w) ? `<span class="bzrv-q-tag is-early">提前</span>` : '',
    // V1 原型拍板（issue 253）：待重做旗标显性化——挂红 tag 提示「这题忘了要重做」
    item.pendingRedo && !item.isCompleted ? `<span class="bzrv-q-tag is-redo">待重做</span>` : '',
    /* 阶梯阶段右上角已经写着「3/10」，这里再挂一条「阶段 3/10」是同一句话说两遍。
       已完成和 FSRS 不重复（FSRS 右上 Lv.n、这里 R%），照旧保留。 */
    item.completed || item.phase === 'fsrs' ? stageTagHtml(item, w, now) : '',
  ].join('');
  /* 批量选择时左侧出勾选位：点卡片 = 选中/取消，不再打开笔记（否则一碰就跳走，根本选不了） */
  const check = selectMode
    ? `<span class="bzrv-q-check ${picked ? 'is-on' : ''}" aria-hidden="true">${picked ? '✓' : ''}</span>`
    : '';
  return `
      <div class="${cls}" data-id="${item.id}" data-path="${esc(item.filePath)}" role="button" tabindex="${canPlay || item.isMissing ? '0' : '-1'}" aria-disabled="${canPlay ? 'false' : 'true'}">
        ${check}
        <div class="bzrv-q-card-top"><span class="bzrv-q-card-title">${title}</span><span class="bzrv-q-card-stage">${item.isMissing ? '挂起' : stageNum(item)}</span></div>
        <div class="bzrv-q-card-meta">${tags}</div>
      </div>`;
}

function cardsOf(items: ReviewItem[], ctx: QueueViewCtx): string {
  // 呈报#19-R13：列内空态统一 uiEmpty 小图标口径（emptyHtmlStr 与 core uiEmpty 同 markup 单源，
  // 渲染后由 ui.renderEntries 的 mountIcons 兑现 inbox 图标；原纯文本 .bzrv-q-hint 第三形制退役）
  if (!items.length) return emptyHtmlStr('inbox', '没有条目');
  return items.map((it) => cardHtml(it, ctx)).join('');
}

/** 三区队列整视图（头行 + 开始本轮条 + 三区列/归档列 + 底部信息行）；搜索框已退役（issue 254 迭代） */
export function queueViewHtml(items: ReviewItem[], ctx: QueueViewCtx = {}): string {
  const now = ctx.now ?? Date.now();
  const w = ctx.w ?? DEFAULT_W;
  const rt = ctx.rThreshold ?? 0.9;
  const full: QueueViewCtx = { ...ctx, now, w, rThreshold: rt };
  const col = partitionQueue(items, rt, w);

  const head = panelHeadHtml({ activePage: ctx.activePage, sub: todayLabel(new Date(now)) });

  /* 筛选区（就地展开，替代原来那个 Obsidian 原生弹窗）：关键字一行、三个下拉一行。
     控件带 data-fld，事件在 ui.bindQueueEvents 里绑；改完即时生效，没有「应用」这一步。 */
  const deckOpts = [
    `<option value=""${!ctx.filter?.deck ? ' selected' : ''}>全部牌组</option>`,
    ...(ctx.decks ?? []).slice(0, 40).map((d) => `<option value="${esc(d)}"${ctx.filter?.deck === d ? ' selected' : ''}>${esc(d)}</option>`),
  ].join('');
  const filterPanel = ctx.filterOpen
    ? `<div class="bzrv-q-filter">
        <input class="bzrv-input bzrv-q-filter-q" data-fld="q" value="${esc(String(ctx.filter?.query ?? ''))}" placeholder="关键字：标题 / 路径 / 卡片原文" />
        <div class="bzrv-q-filter-row">
          <select class="bzrv-input" data-fld="kind">${optsHtml(KIND_OPTS, String(ctx.filter?.kind ?? 'all'))}</select>
          <select class="bzrv-input" data-fld="deck">${deckOpts}</select>
          <select class="bzrv-input" data-fld="status">${optsHtml(STATUS_OPTS, String(ctx.filter?.status ?? 'all'))}</select>
          <button class="bzrv-btn bzrv-btn--ghost" data-act="filter-clear">清除</button>
          <button class="bzrv-btn bzrv-btn--ghost" data-act="filter-close">收起</button>
        </div>
      </div>`
    : '';

  // 空库 → 头行 + 引导条 + 空态宿主（uiEmpty 由 ui.ts 挂载并绑两条路动作）
  if (!items.length) {
    /* 一条都没有的时候说「今日已清空」是骗人的——第一次装、刚清空计划都落在这里，
       用户会以为自己今天已经复习完了。这里只说事实 + 下一步能做什么。 */
    const strip = `
      <div class="bzrv-q-strip">
        <span class="bzrv-q-strip-dot muted"></span>
        <strong>还没有复习条目</strong>
        <span class="bzrv-q-strip-txt">加一篇笔记或一条划线，这里就有东西了</span>
      </div>`;
    /* 空计划 + 已移出里有东西 = 刚把最后几条删掉。这时候不给入口，用户就只剩
       「去设置里翻」一条路——把入口留在空态下面。 */
    const emptyFooter =
      (ctx.trashCount ?? 0) > 0
        ? `<div class="bzrv-q-footer">
        <span class="bzrv-q-fitem bzrv-touch-target--lg" data-act="trash"><span class="bzrv-sr-only">从计划里移走的条目，可以捞回来</span>
          ${iconSpan('archive-restore', 'bzrv-q-ic')}<span class="lbl">已移出 <b>${ctx.trashCount}</b> 条</span>
        </span>
      </div>`
        : '';
    return `<div class="bzrv-q-view">${head}${filterPanel}${strip}<div class="bzrv-q-cols bzrv-q-empty-wrap"><div data-empty-host></div></div>${emptyFooter}</div>`;
  }

  // item 8：今日全清（开始本轮集合为空 = 逾期/今日/提前全无）→ 绿点 +「今日已清空」+ 隐藏主按钮
  // （partitionQueue 的 today 列已含提前卡 → overdue+today 与 roundQueue 同集合，item 6 同口径）
  const clearToday = col.overdue.length + col.today.length === 0;
  const futureCount = col.future.length;
  // V1 原型拍板（issue 253）：归档视图状态条 = 绿点 +「已完成复习」+ 回队列指引（旧态误用红点「开始本轮」）
  const strip = ctx.showArchived
    ? `<div class="bzrv-q-strip">
        <span class="bzrv-q-strip-dot ok"></span>
        <strong>已完成复习</strong>
      </div>`
    : clearToday
      ? `<div class="bzrv-q-strip">
        <span class="bzrv-q-strip-dot ok"></span>
        <strong>今日已清空</strong>
        <span class="bzrv-q-strip-txt">${futureCount ? `未来还有 ${futureCount} 条待复习` : '没有待复习条目'}</span>
      </div>`
      : `<div class="bzrv-q-strip">
        <span class="bzrv-q-strip-dot"></span>
        <strong>开始本轮</strong>
        <span class="bzrv-q-strip-txt">今日 ${col.today.length} 条到期 · 逾期 ${col.overdue.length} 条顺延</span>
        <button class="bzrv-btn bzrv-btn--primary" data-act="begin">开始本轮</button>
      </div>`;

  // V1 拍板：列内排序 置顶 → R 升序 → 到期（sortColumn；G4：透传 ctx.w 与卡片 R 展示同权重源）
  const body = ctx.showArchived
    ? `<div class="bzrv-q-cols"><div class="bzrv-q-col done">${colHead(col.done.length, '已完成')}${cardsOf(sortColumn(col.done, now, w), full)}</div></div>`
    : `<div class="bzrv-q-cols">
          <div class="bzrv-q-col danger">${colHead(col.overdue.length, '已逾期')}${cardsOf(sortColumn(col.overdue, now, w), full)}</div>
          <div class="bzrv-q-col warn">${colHead(col.today.length, '今天到期')}${cardsOf(sortColumn(col.today, now, w), full)}</div>
          <div class="bzrv-q-col future">${colHead(col.future.length, '未来')}${cardsOf(sortColumn(col.future, now, w), full)}</div>
        </div>`;

  // 底部信息行：整行可点（归档 → 切换归档；统计 → 打开分布），无引导小字
  // item 13：「累计 X 天 · 连续 Y 天」（X=去重同日天数，computeStats.totalReviews）
  // 归档态：左下角变「返回队列」提醒钮（issue 254 迭代拍板），点击即回队列
  const stats = computeStats(items);
  /* 「比固定间隔少 N 次」（2026-11-16）：动态抗遗忘到底省了多少，一直是句形容词。
     现在把它算成一个数摆在主界面上——用户不用点进统计弹窗才看得到。
     只在「有足够样本 + 确实更省」时出现：省 0 次或反而更多时不写，免得变成
     一句自嘲。 */
  const loadCmp = compareReviewLoad(items);
  const savedItem =
    loadCmp && loadCmp.notes >= 3 && loadCmp.saved > 0
      ? `<i class="sep"></i>
        <span class="bzrv-q-fitem"><span class="bzrv-sr-only">按 1/2/4/7/15/30/60/120 天的老办法，同样这些笔记、同样这些天，要复习 ${loadCmp.fixed} 次</span>
          ${iconSpan('trending-down', 'bzrv-q-ic')}<span class="lbl">比固定间隔少 <b>${loadCmp.saved}</b> 次</span>
        </span>`
      : '';
  /* 「已完成」只数真的复习完了的。col.done 里还混着挂起（文件缺失）的条目——
     直接拿它的长度当完成数，会让「已完成 2 篇」里藏着一条早就丢了文件的记录。 */
  /* 已完成挪到头行图标后，底栏这颗换成「批量选择」——不然它就彻底没了入口。 */
  const archItem = ctx.showArchived
    ? `<span class="bzrv-q-fitem bzrv-touch-target--lg is-back" data-act="arch"><span class="bzrv-sr-only">点此返回队列</span>
        ${iconSpan('undo-2', 'bzrv-q-ic')}<span class="lbl">返回队列</span>
      </span>`
    : `<span class="bzrv-q-fitem bzrv-touch-target--lg" data-act="batch"><span class="bzrv-sr-only">批量选择</span>
        ${iconSpan('square-check-big', 'bzrv-q-ic')}<span class="lbl">批量选择</span>
      </span>`;
  /* 底栏入口只在真有东西时出现（头行那颗图标常驻）：没删过东西的人不需要多一行 0 条，
     删过的人则必须有地方把东西捞回来（以前只有几秒的 toast 撤销，错过就没了）。 */
  const trashItem = (ctx.trashCount ?? 0) > 0
    ? `<span class="bzrv-q-fitem bzrv-touch-target--lg" data-act="trash"><span class="bzrv-sr-only">从计划里移走的条目，可以捞回来</span>
        ${iconSpan('archive-restore', 'bzrv-q-ic')}<span class="lbl">已移出 <b>${ctx.trashCount}</b> 条</span>
      </span>`
    : '';
  /* 成就单列一页（2026-11-20）：不放进统计页，也不占头行第 6 颗图标——
     头行四颗要与 Reader 嵌入的动作栏一一对齐，多一颗切页就会跳。 */
  const achvItem = `<span class="bzrv-q-fitem bzrv-touch-target--lg" data-act="achv"><span class="bzrv-sr-only">成就徽章，单独成页</span>
      ${iconSpan('trophy', 'bzrv-q-ic')}<span class="lbl">成就</span>
    </span>`;
  const footer = `
      <div class="bzrv-q-footer">
        ${archItem}
        ${trashItem ? `<i class="sep"></i>${trashItem}` : ''}
        <i class="sep"></i>
        ${achvItem}
        <i class="sep"></i>
        <span class="bzrv-q-fitem">
          ${iconSpan('flame', 'bzrv-q-ic')}<span class="lbl">累计 <b>${stats.totalReviews}</b> 天 · 连续 <b>${stats.streak}</b> 天</span>
        </span>
        ${savedItem}
      </div>`;

  /* 筛选条：说清楚「列表被筛过、开始本轮不受影响」——不说的话，用户会以为
     筛选后开始本轮只复习筛出来的那些，结果被多塞了一堆条目。 */
  const filterBar = ctx.filterText
    ? `<div class="bzrv-q-strip is-filter">
        <span class="bzrv-q-strip-dot warn"></span>
        <strong>筛选中</strong>
        <span class="bzrv-q-strip-txt">${esc(ctx.filterText)} · 列表 ${items.length} 条（开始本轮仍按到期走）</span>
        <button class="bzrv-btn bzrv-btn--ghost" data-act="filter-clear">清除</button>
      </div>`
    : '';
  /* 批量条：按钮就三个，删除明确写「移出计划」并说明进回收站，
     免得有人以为这个动作不可逆。 */
  const batchBar = ctx.selectMode
    ? `<div class="bzrv-q-strip is-batch">
        <strong>已选 ${ctx.selected?.size ?? 0} 条</strong>
        <span class="bzrv-q-strip-txt">点卡片选中；移出后在回收站里能捞回来</span>
        <button class="bzrv-btn" data-act="batch-postpone">顺延 7 天</button>
        <button class="bzrv-btn" data-act="batch-delete">移出计划</button>
        <button class="bzrv-btn bzrv-btn--ghost" data-act="batch-cancel">取消</button>
      </div>`
    : '';

  return `<div class="bzrv-q-view">${head}${filterPanel}${filterBar}${batchBar}${strip}${body}${footer}</div>`;
}

// ==================== 按书档案视图（高级档 bookReport） ====================

/** 百分比：算不出给破折号，不拿 0 冒充 */
function bookPct(v: number | null): string {
  return v == null ? '—' : `${Math.round(v * 100)}%`;
}

export interface BooksViewCtx {
  now?: number;
}

/**
 * 按书 / 按章节档案。分组与指标全部来自 book-summary 的纯结果，这里只负责 markup。
 * 中文书名排序统一走 Intl.Collator('zh-CN')；空库给一句人话，不渲染一张只有表头的空表。
 */
export function booksViewHtml(summaries: readonly BookSummary[], ctx: BooksViewCtx = {}): string {
  const day = new Date(ctx.now ?? Date.now()).toISOString().slice(0, 10);
  if (!summaries.length) {
    return `<div class="bzrv-book-view"><div class="bzrv-book-empty">还没有复习数据：加一篇笔记或一条划线，这里就会按书汇总。</div></div>`;
  }
  const collator = new Intl.Collator('zh-CN');
  const sorted = summaries.slice().sort(
    (a, b) =>
      (a.kind === b.kind ? 0 : a.kind === 'book' ? -1 : 1) ||
      collator.compare(a.book, b.book) ||
      b.active - a.active
  );
  const groups = sorted
    .map((s) => {
      const unit = s.kind === 'book' ? '张卡' : '篇笔记';
      const weak = s.weak.length ? s.weak.map((e) => `${esc(e.name)}（${bookPct(e.r)}）`).join('、') : '—';
      const strong = s.strong.length ? s.strong.map((e) => `${esc(e.name)}（${bookPct(e.r)}）`).join('、') : '—';
      const chapter = s.kind === 'book' ? `<span class="bzrv-book-stat">章节 <b>${s.chapters}</b></span>` : '';
      return `<div class="bzrv-book-group" data-book="${esc(s.book)}">
        <div class="bzrv-book-title"><span class="bzrv-book-name">${esc(s.book)}</span><span class="bzrv-book-kind">${s.kind === 'book' ? '书' : '笔记'}</span></div>
        <div class="bzrv-book-stats">
          <span class="bzrv-book-stat"><b>${s.total}</b> ${unit}</span>
          ${chapter}
          <span class="bzrv-book-stat">在复习 <b>${s.active}</b></span>
          <span class="bzrv-book-stat">已完成 <b>${s.done}</b></span>
          <span class="bzrv-book-stat">平均留存率 <b>${bookPct(s.avgR)}</b></span>
          <span class="bzrv-book-stat">忘了率 <b>${bookPct(s.againRate)}</b></span>
          <span class="bzrv-book-stat">评级 <b>${s.reviews}</b> 次</span>
          <span class="bzrv-book-stat">逾期 <b>${s.overdue}</b></span>
        </div>
        <div class="bzrv-book-mem">
          <span class="bzrv-book-weak">最容易忘：${weak}</span>
          <span class="bzrv-book-strong">记得最牢：${strong}</span>
        </div>
      </div>`;
    })
    .join('');
  return `<div class="bzrv-book-view">
    <div class="bzrv-book-head">共 ${sorted.length} 组 · 截至 ${day} · 划线卡按书名、笔记按文件夹整理</div>
    <div class="bzrv-book-list">${groups}</div>
  </div>`;
}

// ==================== 卡片管理器视图（高级档 cardManager） ====================

export interface ManagerViewCtx {
  now?: number;
  filter?: ItemFilter;
  /** 可选书 / 文件夹（由调用方 collectFacets 算好） */
  decks?: readonly string[];
}

/**
 * 卡片管理器：全部卡片与笔记 + 搜索框 + 按书/类型/状态筛选 + 每行五个动作。
 * 图标按钮一律用 .bzrv-sr-only 藏可读名字，不挂 aria-label / title（禁止悬停气泡）。
 * 状态变更的纯判定复用 card-manager，筛选复用 deck.applyFilter，避免口径分叉。
 */
export function managerViewHtml(items: readonly ReviewItem[], ctx: ManagerViewCtx = {}): string {
  const now = ctx.now ?? Date.now();
  const f: ItemFilter = ctx.filter ?? {};
  const shown = applyFilter(items, f);
  const deckOpts = [
    `<option value="">全部书 / 文件夹</option>`,
    ...(ctx.decks ?? [])
      .slice(0, 60)
      .map((d) => `<option value="${esc(d)}"${f.deck === d ? ' selected' : ''}>${esc(d)}</option>`),
  ].join('');
  const bar = `<div class="bzrv-mgr-bar">
      <input class="bzrv-input bzrv-mgr-q" data-fld="mgr-q" value="${esc(String(f.query ?? ''))}" placeholder="搜索：标题 / 书名 / 原文" />
      <select class="bzrv-input" data-fld="mgr-kind">${optsHtml(KIND_OPTS, String(f.kind ?? 'all'))}</select>
      <select class="bzrv-input" data-fld="mgr-deck">${deckOpts}</select>
      <select class="bzrv-input" data-fld="mgr-status">${optsHtml(STATUS_OPTS, String(f.status ?? 'all'))}</select>
    </div>`;
  const hint = `<div class="bzrv-mgr-hint">挂起 / 埋藏只影响进不进本轮，排期不变；移出后进回收站，可以撤销。</div>`;
  if (!items.length) {
    return `<div class="bzrv-mgr-view">${bar}<div class="bzrv-mgr-empty">还没有卡片或笔记，先加入复习条目再来管理。</div></div>`;
  }
  if (!shown.length) {
    return `<div class="bzrv-mgr-view">${bar}<div class="bzrv-mgr-empty">没有符合筛选的条目，换个条件试试。</div></div>`;
  }
  const rows = shown
    .map((it) => {
      const buried = isBuried(it, { now });
      const hidden = isHiddenFromQueue(it, { now });
      const state = it.suspended
        ? '已挂起'
        : buried
          ? `埋藏至 ${new Date(String(it.buriedUntil)).toLocaleDateString('zh-CN')}`
          : it.completed || it.isCompleted
            ? '已完成'
            : it.isMissing
              ? '文件缺失'
              : dueLabelOf(it, now).label;
      const stateCls = it.suspended ? 'is-suspended' : buried ? 'is-buried' : hidden ? 'is-hidden' : '';
      const name = esc(it.name || String(it.card?.text ?? '').slice(0, 24) || it.filePath);
      const kind = it.kind === 'card' ? '划线' : '笔记';
      return `<div class="bzrv-mgr-row" data-path="${esc(it.filePath)}" data-id="${esc(it.id)}">
        <div class="bzrv-mgr-main">
          <span class="bzrv-mgr-name">${name}</span>
          <span class="bzrv-mgr-kind">${kind}</span>
          <span class="bzrv-mgr-where">${esc(deckOf(it))}</span>
          <span class="bzrv-mgr-state ${stateCls}">${state}</span>
        </div>
        <div class="bzrv-mgr-ops">
          ${it.card ? `<button class="bzrv-icon-btn" data-act="mgr-edit"><span class="bzrv-sr-only">编辑这张卡</span>${iconSpan('pencil', 'bzrv-q-ic')}</button>
          <button class="bzrv-icon-btn" data-act="mgr-regen"><span class="bzrv-sr-only">重新生成 AI 内容</span>${iconSpan('refresh-cw', 'bzrv-q-ic')}</button>` : ''}
          <button class="bzrv-icon-btn" data-act="mgr-suspend"><span class="bzrv-sr-only">挂起</span>${iconSpan('pause', 'bzrv-q-ic')}</button>
          <button class="bzrv-icon-btn" data-act="mgr-bury"><span class="bzrv-sr-only">埋藏一天</span>${iconSpan('hourglass', 'bzrv-q-ic')}</button>
          <button class="bzrv-icon-btn" data-act="mgr-restore"><span class="bzrv-sr-only">恢复</span>${iconSpan('rotate-ccw', 'bzrv-q-ic')}</button>
          <button class="bzrv-icon-btn" data-act="mgr-schedule"><span class="bzrv-sr-only">手动排期</span>${iconSpan('calendar-days', 'bzrv-q-ic')}</button>
          <button class="bzrv-icon-btn" data-act="mgr-delete"><span class="bzrv-sr-only">移出复习计划</span>${iconSpan('trash-2', 'bzrv-q-ic')}</button>
        </div>
      </div>`;
    })
    .join('');
  return `<div class="bzrv-mgr-view">${bar}${hint}<div class="bzrv-mgr-list">${rows}</div></div>`;
}

// ==================== 已移出（回收站）页 ====================

/** 删除时间的人话（刚删的别写「0 天前删除」） */
export function deletedLabel(at: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - at);
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days} 天前删除`;
  const hours = Math.floor(diff / 3600000);
  if (hours > 0) return `${hours} 小时前删除`;
  return '刚刚删除';
}

/** 条目出处那一行：划线卡写「书名 · 章节」，笔记写所在文件夹 */
function trashSrcOf(e: TrashEntry): string {
  const card = e.item.card;
  if (card) {
    return [card.bookTitle, card.chapterTitle].map((s) => String(s ?? '').trim()).filter(Boolean).join(' · ') || '划线卡';
  }
  const path = String(e.item.filePath ?? e.key);
  const cut = path.lastIndexOf('/');
  return cut > 0 ? path.slice(0, cut) : '根目录';
}

/** 卡片原文摘要：只给划线卡，太长就截断（恢复前足够认出是哪条） */
function trashQuoteOf(e: TrashEntry): string {
  const text = String(e.item.card?.text ?? '').trim();
  if (!text) return '';
  return text.length > 90 ? `${text.slice(0, 90)}…` : text;
}

/**
 * 「已移出」内置页（2026-11-19）：移出计划的条目在这里捞回来。
 *
 * 形制对齐 bz-reader 的「笔记」页——左侧一条强调色竖线、引文、出处行、右下动作，
 * 页面本身不写大标题（位置由页签与这颗入口说明），顶部只留一条期限说明。
 * 逐条恢复为主：来这里的用户通常只想捞回刚才误删的那一条；「全部恢复 / 清空」放右上。
 */
export function trashPageHtml(entries: readonly TrashEntry[], ctx: { now?: number } = {}): string {
  const now = ctx.now ?? Date.now();
  const note = `<div class="bzrv-trash-note">
      <span class="bzrv-trash-note-txt">只保留最近 ${TRASH_TTL_DAYS} 天、最多 ${TRASH_LIMIT} 条；恢复后排期与复习历史原样回来</span>
      <span class="bzrv-trash-sp"></span>
      ${
        entries.length
          ? `<button class="bzrv-btn bzrv-btn--ghost" data-act="trash-restore-all">全部恢复</button>
             <button class="bzrv-btn bzrv-btn--ghost" data-act="trash-clear">清空</button>`
          : ''
      }
    </div>`;
  const rows = entries.length
    ? `<div class="bzrv-trash-list">${entries
        .map((e) => {
          const quote = trashQuoteOf(e);
          const left = Math.max(0, Math.ceil((e.at + TRASH_TTL_DAYS * 86400000 - now) / 86400000));
          return `<article class="bzrv-trash-card" data-trash-key="${esc(e.key)}">
        <div class="bzrv-trash-card-top">
          <span class="bzrv-trash-card-title">${esc(e.title)}</span>
          <span class="bzrv-trash-tag">${e.kind === 'card' ? '划线' : '笔记'}</span>
        </div>
        ${quote ? `<p class="bzrv-trash-card-quote">「${esc(quote)}」</p>` : ''}
        <div class="bzrv-trash-card-foot">
          <span class="bzrv-trash-src">${esc(trashSrcOf(e))}</span>
          <span class="bzrv-trash-when">${deletedLabel(e.at, now)} · 还剩 ${left} 天</span>
          <span class="bzrv-trash-sp"></span>
          <button class="bzrv-btn bzrv-btn--ghost" data-restore="${esc(e.key)}">恢复</button>
        </div>
      </article>`;
        })
        .join('')}</div>`
    : `<div class="bzrv-trash-empty-host" data-empty-host></div>`;
  return `<div class="bzrv-trash-view">${note}${rows}</div>`;
}

// ==================== 整窗冲刺视图 ====================

/** 冲刺模式 → 头行副标题（呈报#57/R5；规格文案取 sprint.ts 头注释：
 *  开始本轮 / 待重做 / 单条复习。与 SprintMode 字面量对齐，本地定义防 render→sprint 环） */
export function sprintModeLabel(mode: 'round' | 'single' | 'redo'): string {
  return mode === 'round' ? '开始本轮' : mode === 'redo' ? '待重做' : '单条复习';
}

/** 冲刺头行（mode 缺省 = 无副标题，兼容旧契约） */
export function sprintHeadHtml(mode?: 'round' | 'single' | 'redo'): string {
  const sub = mode ? `<div class="bzrv-sprint-sub">${sprintModeLabel(mode)}</div>` : '';
  return `
      <div class="bzrv-sprint-head">
        <div class="t">
          <div class="bzrv-sprint-title">做题冲刺</div>
          ${sub}
        </div>
        <div class="tools">
          <button class="bzrv-icon-btn" data-action="skip"><span class="bzrv-sr-only">跳过此篇（不评级，移到队尾）</span>${iconSpan('skip-forward', 'bzrv-sprint-ic')}</button>
          <button class="bzrv-icon-btn" data-action="quit"><span class="bzrv-sr-only">回面板</span>${iconSpan('x', 'bzrv-sprint-ic')}</button>
        </div>
      </div>`;
}

export function sprintLoadingHtml(): string {
  return `<div class="bzrv-sprint-loading"><span class="bzrv-q-spinner"></span>正在获取题目…</div>`;
}

/** 选项列（answered 后标对错；sel = 已选索引数组） */
function sprintOptsHtml(
  q: QuestionLike,
  answered: boolean,
  sel: number[],
  lastCorrect: boolean
): string {
  void lastCorrect;
  return q.options
    .map((opt, i) => {
      const isSel = sel.includes(i);
      let extra = '';
      if (answered) {
        if (q.correctIndices.includes(i)) extra = ' is-correct';
        else if (isSel) extra = ' is-wrong';
      } else if (isSel) extra = ' is-sel';
      const m = answered && q.correctIndices.includes(i)
        ? markHtml('ok')
        : answered && isSel && !q.correctIndices.includes(i)
          ? markHtml('bad')
          : '';
      return `
          <div class="bzrv-sprint-opt${extra}${answered ? ' is-disabled' : ''}" data-i="${i}" role="button" tabindex="${answered ? '-1' : '0'}" aria-disabled="${answered ? 'true' : 'false'}">
            <span class="k">${'ABCD'[i]}</span>
            <span class="t">${esc(opt)}</span>
            <span class="m">${m}</span>
          </div>`;
    })
    .join('');
}

/** 题卡视图（entry 进度 + 当前题 + 作答态；qfoot 提交/下一题/结束并结算按态组装） */
export function sprintQuestionHtml(
  entry: { questions: QuestionLike[]; doneCount: number },
  question: QuestionLike,
  st: { answered: boolean; sel: number[]; lastCorrect: boolean; remaining: number }
): string {
  const single = question.correctIndices.length === 1;
  const total = entry.questions.length;
  const done = entry.doneCount;
  const optsHtml = sprintOptsHtml(question, st.answered, st.sel, st.lastCorrect);

  const needSubmit = !single && !st.answered;
  /* 解析：答对答错都显示（与做题练习同一口径——答对也该知道自己为什么对）。
     存量题没有 explain 字段时静默不显示，零迁移。 */
  const hasExplain = !!(question.explain && String(question.explain).trim());
  // 答完这一题要不要停住等人读：答错要停（看解析），答对但有解析也要停
  const hold = st.answered && (!st.lastCorrect || hasExplain);
  const nextBtn =
    hold && st.remaining
      ? `<button class="bzrv-btn bzrv-btn--primary" data-action="next">下一题 →</button>`
      : hold && !st.remaining
        ? `<button class="bzrv-btn bzrv-btn--primary" data-action="note">${iconSpan('flag', 'bzrv-sprint-ic')} 结束并结算</button>`
        : '';
  const submit = needSubmit ? `<button class="bzrv-btn bzrv-btn--primary bzrv-sprint-submit" data-action="submit">提交答案</button>` : '';
  const explain = st.answered && hasExplain
    ? `<div class="bzrv-sprint-explain">${esc(question.explain ?? '')}</div>`
    : '';

  return `
      <div class="bzrv-sprint-qtop">
        <span class="bzrv-sprint-progress">${done + 1}/${total}</span>
      </div>
      <div class="bzrv-sprint-qcard">
        <div class="bzrv-sprint-qtype">${single ? '单选' : '多选'}</div>
        <div class="bzrv-sprint-qtext">${esc(question.question)}</div>
        <div class="bzrv-sprint-opts">${optsHtml}</div>
        ${explain}
        ${submit}
        ${nextBtn ? `<div class="bzrv-sprint-qfoot">${nextBtn}</div>` : ''}
      </div>`;
}

/** 右栏「本轮队列」 */
export function sprintAsideHtml(entries: Array<{ name: string; state: string }>): string {
  const rows = entries
    .map((e) => {
      const name = esc(e.name);
      if (e.state === 'passed') return `<div class="bzrv-sq-item passed"><span class="nm"><s>${name}</s></span></div>`;
      if (e.state === 'failed') return `<div class="bzrv-sq-item failed"><span class="nm">${name}</span></div>`;
      if (e.state === 'doing') return `<div class="bzrv-sq-item doing"><span class="nm">${name}</span></div>`;
      return `<div class="bzrv-sq-item"><span class="nm">${name}</span></div>`;
    })
    .join('');
  return `
      <div class="bzrv-sq-head"><b>本轮队列</b></div>
      <div class="bzrv-sq-list">${rows || emptyHtmlStr('inbox', '队列完毕')}</div>`;
}

/** 冲刺主体壳（左内容 + 右本轮队列） */
export function sprintBodyHtml(mainHtml: string, entries: Array<{ name: string; state: string }>): string {
  return `
      <div class="bzrv-sprint-body">
        <div class="bzrv-sprint-main">${mainHtml}</div>
        <aside class="bzrv-sprint-queue">${sprintAsideHtml(entries)}</aside>
      </div>`;
}

/** 结果卡（U7：仅通过态可达——未通过路径 finishNote 直接 finish('fail') 中断会话、
 *  由 onFailed 打开原文，从不进结果卡；原「复习此笔记 · 打开原文」失败分支 markup 为
 *  不可达死代码且文案失实，已删。ratingLine = 「简单 · 下次 12 天后」等由调用方拼） */
export function sprintResultHtml(p: {
  name: string;
  acc: number;
  wrong: number;
  ratingLine: string;
  nextLabel: string;
  showEnd: boolean;
}): string {
  const total = p.acc + p.wrong;
  return `<div class="bzrv-result">
        <div class="bzrv-result-ic">${markHtml('ok', 'lg')}</div>
        <div class="bzrv-result-name">${esc(p.name)}</div>
        <div class="bzrv-result-score">${p.acc}<span class="sl">/${total}</span></div>
        <span class="bzrv-result-rating pass">${p.ratingLine}</span>
        <button class="bzrv-btn bzrv-btn--primary bzrv-btn--block" data-action="next">${p.nextLabel}</button>
        ${p.showEnd ? `<button class="bzrv-btn bzrv-btn--ghost bzrv-btn--block" data-action="end">结束这次复习</button>` : ''}
      </div>`;
}

/** 结算屏。一篇都没做成时别摆三个 0——那看着像「白做了一轮」。 */
export function sprintSummaryHtml(p: { total: number; passed: number; failed: number; streak: number }): string {
  const none = p.total === 0;
  return `
      <div class="bzrv-summary">
        <div class="bzrv-summary-title">${none ? '这一轮没有做成任何一篇' : '本轮复习完成'}</div>
        ${
          none
            ? '<div class="bzrv-summary-stats"><div class="st"><b>0</b><span>篇（都没出成题）</span></div></div>'
            : `<div class="bzrv-summary-stats">
          <div class="st"><b>${p.total}</b><span>复习篇数</span></div>
          <div class="st"><b>${p.passed}</b><span>通过</span></div>
          <div class="st ${p.failed ? 'warn' : ''}"><b>${p.failed}</b><span>未通过</span></div>
        </div>`
        }
        ${p.streak > 0 ? `<div class="bzrv-summary-streak">连续复习 <b>${p.streak}</b> 天</div>` : ''}
        <button class="bzrv-btn bzrv-btn--primary bzrv-btn--block" data-action="done">完成 · 回到复习计划</button>
      </div>`;
}

// ==================== 做题练习独立面板（issue 362；壳见 quiz-panel.ts） ====================

/** 做题练习设置视图上下文（scope=all 整库 / folder 按文件夹 / note 单篇；batch≤0 = 不限） */
export interface QuizPracticeSetupCtx {
  scope: 'all' | 'folder' | 'note';
  batch: number;
  /** folder 范围已选目录（'' = 库根目录） */
  folders: string[];
  /** note 范围已选笔记路径 */
  notePath: string;
  /** 范围内现有题数（null = 统计中/未统计，meta 行占位） */
  bankCount: number | null;
}

/** 出题范围段选与题量段选的档位（markup 单源；quiz-panel.ts 经 data-* 委托绑定） */
const QUIZ_PRACTICE_SCOPES: Array<{ v: 'all' | 'folder' | 'note'; label: string }> = [
  { v: 'all', label: '全部' },
  { v: 'folder', label: '按文件夹' },
  { v: 'note', label: '单篇' },
];
const QUIZ_PRACTICE_BATCHES: Array<{ v: number; label: string }> = [
  { v: 10, label: '10 题' },
  { v: 20, label: '20 题' },
  { v: 30, label: '30 题' },
  { v: 0, label: '不限' },
];

/** 做题练习设置视图（头行 + 范围段选 + 范围详情行 + 题量段选 + 题库 meta + 开始钮） */
export function quizPracticeSetupHtml(ctx: QuizPracticeSetupCtx): string {
  const scopeSeg = QUIZ_PRACTICE_SCOPES.map(
    (o) =>
      `<button type="button" class="bzrv-segmented-btn${o.v === ctx.scope ? ' is-on' : ''}" data-scope="${o.v}" role="radio" aria-checked="${o.v === ctx.scope}">${o.label}</button>`
  ).join('');
  const batchSeg = QUIZ_PRACTICE_BATCHES.map(
    (o) =>
      `<button type="button" class="bzrv-segmented-btn${o.v === ctx.batch ? ' is-on' : ''}" data-batch="${o.v}" role="radio" aria-checked="${o.v === ctx.batch}">${o.label}</button>`
  ).join('');
  let detail: string;
  if (ctx.scope === 'all') {
    detail = `<div class="bzrv-qp-detail">整库笔记都纳入出题范围，系统目录自动跳过</div>`;
  } else if (ctx.scope === 'folder') {
    // 监听文件夹名单（review-deep 一致#12）：正典应走 uiSetlist({variant:'chips', removeLabel, onRemove})，
    // 但本文件是 render 纯层——组件库 barrel 会拖入 obsidian（纯度约定白名单外），
    // 故保留手搓胶囊 markup 仅把移除钮文本 ✕ 收编 lucide 占位（同文件 iconSpan() 先例 +
    // 渲染后 mountIcons 兑现）；data-rm-folder 即 onRemove 的 key 通道，行为层接线不变。
    const chips = ctx.folders.length
      ? ctx.folders
          .map((f) => {
            const label = f === '' ? '（库根目录）' : f;
            return `<span class="bzrv-qp-chip"><span class="bzrv-qp-chip-name"><span class="bzrv-sr-only">${esc(label)}</span>${esc(label)}</span><button type="button" class="bzrv-qp-chip-x" data-rm-folder="${esc(f)}"><span class="bzrv-sr-only">移除 ${esc(label)}</span>${iconSpan('x', 'bzrv-q-ic')}</button></span>`;
          })
          .join('')
      : `<span class="bzrv-qp-detail">还没选文件夹</span>`;
    detail = `<div class="bzrv-qp-folder-row"><div class="bzrv-qp-chips">${chips}</div><button type="button" class="bzrv-btn bzrv-btn--ghost" data-act="pick-folders">${ctx.folders.length ? '改文件夹' : '选择文件夹'}</button></div>`;
  } else {
    detail = `<div class="bzrv-qp-note-field"><input type="text" class="bzrv-input bz-qp-note-input" data-role="note-input" placeholder="输入笔记名筛选，点选确定" value="${esc(ctx.notePath)}"></div>`;
  }
  // 题库 meta（体验修复）：范围未就绪时给引导文案（原先显示「还没有题目」
  // 与上方「还没选文件夹」矛盾）；null = 统计中/未统计，meta 行占位空。
  // U11：note 单篇空路径补同款引导（对齐 folder 空名单先例）
  const meta =
    ctx.scope === 'folder' && !ctx.folders.length
      ? '先选择文件夹再看题量'
      : ctx.scope === 'note' && !ctx.notePath
        ? '先选择一篇笔记再看题量'
        : ctx.bankCount === null
          ? ''
          : ctx.bankCount > 0
            ? `当前范围现有 <b>${ctx.bankCount}</b> 题`
            : '当前范围还没有题目，开始后会自动出题';
  return `
    <div class="bzrv-qp-view">
      <div class="bzrv-panel-head">
        <div class="bzrv-panel-brand">${iconSpan('graduation-cap', 'bzrv-ic--sm')}</div>
        <div class="bzrv-panel-title">做题练习</div>
        <div class="bzrv-panel-head-pipe"></div>
        <div class="bzrv-panel-head-sub">只刷题 · 不排期复习</div>
        <span class="bzrv-panel-head-sp"></span>
        <div class="bzrv-panel-head-btns">
          <button class="bzrv-icon-btn" data-act="close"><span class="bzrv-sr-only">关闭</span>${iconSpan('x', 'bzrv-q-ic')}</button>
        </div>
      </div>
      <div class="bzrv-qp-body">
        <div class="bzrv-qp-sec">
          <div class="bzrv-qp-sec-label">出题范围</div>
          <div class="bzrv-segmented" role="radiogroup"><span class="bzrv-sr-only">出题范围</span>${scopeSeg}</div>
          <div class="bzrv-qp-detail-wrap">${detail}</div>
        </div>
        <div class="bzrv-qp-sec">
          <div class="bzrv-qp-sec-label">本轮题量</div>
          <div class="bzrv-segmented" role="radiogroup"><span class="bzrv-sr-only">本轮题量</span>${batchSeg}</div>
        </div>
        <div class="bzrv-qp-meta" data-role="bank-meta">${meta}</div>
        <button class="bzrv-btn bzrv-btn--primary bzrv-qp-start" data-act="start">开始做题</button>
        <div class="bzrv-qp-foot">键位与做题家一致：1-4 / A-D 选择，Enter 提交或下一题；答对的题出库，答错的留给下次。</div>
      </div>
    </div>`;
}

/** 做题练习成绩小结（对/错/跳过 + 正确率 + 再来一轮；跳过 = 备题数 − 已答数）。
 *  体验修复：小字交代错题去向（「答错的题留在题库，下轮再见」）；中途放弃（答对+答错=0）
 *  不弹「正确率 0%」像考砸，改「本轮未答题已保留」。 */
export function quizPracticeSummaryHtml(r: { correct: number; wrong: number; skipped: number; accuracy: number }): string {
  const answered = r.correct + r.wrong;
  return `
    <div class="bzrv-summary">
      <div class="bzrv-summary-title">本轮刷题小结</div>
      <div class="bzrv-summary-stats">
        <div class="st"><b>${r.correct}</b><span>答对</span></div>
        <div class="st ${r.wrong ? 'warn' : ''}"><b>${r.wrong}</b><span>答错</span></div>
        <div class="st"><b>${r.skipped}</b><span>跳过</span></div>
      </div>
      ${answered > 0 ? `<div class="bzrv-qp-acc">正确率 <b>${r.accuracy}%</b></div>` : `<div class="bzrv-qp-acc">本轮未答题已保留</div>`}
      <button class="bzrv-btn bzrv-btn--primary bzrv-btn--block" data-act="again">再来一轮</button>
      <button class="bzrv-btn bzrv-btn--ghost bzrv-btn--block" data-act="finish">收工</button>
      <div class="bzrv-qp-foot">答错的题留在题库，下轮再见。</div>
    </div>`;
}

// ==================== 悬浮迷你评级条 ====================

/** 悬浮迷你评级条（item 4，普通复习路径）。A6：评级中文名单源 stats.RATING_NAMES
 *  （原内联映射与 sprint 结果卡两名漂移——「简单」vs「轻松」，统一为「简单」） */
export function reviewBarHtml(p: { name: string; index: number; total: number; remaining?: number; keys?: string }): string {
  const keys = ratingKeys(p.keys);
  const btns = ['again', 'hard', 'good', 'easy']
    .map(
      (r) =>
        `<button class="bzrv-review-bar-btn bzrv-touch-target--sm is-${r}" data-rating="${r}"><span class="bzrv-sr-only">快捷键 ${esc(keys[r as 'again'])}</span>${RATING_NAMES[r]}</button>`
    )
    .join('');
  /* 剩余条数与粗估耗时：连着复习时用户最想知道「还要坐多久」，
     给个量级就够，不承诺精确到秒。 */
  const left = p.remaining ?? 0;
  const extra = left > 0 ? `<i> · 剩 ${left} 条 ${etaTextOf(left)}</i>` : '';
  return `
    <span class="bzrv-review-bar-info">${esc(stripTitleMarks(p.name))}<i>(${p.index}/${p.total})</i>${extra}</span>
    <span class="bzrv-review-bar-act">${btns}
      <button class="bzrv-review-bar-btn bzrv-touch-target--sm is-skip" data-rating="skip"><span class="bzrv-sr-only">不评级，直接下一篇</span>${'跳过'}</button>
      <button class="bzrv-review-bar-btn bzrv-touch-target--sm is-pause" data-rating="pause"><span class="bzrv-sr-only">评完这条停下，断点保留</span>${'暂停'}</button>
    </span>`;
}
