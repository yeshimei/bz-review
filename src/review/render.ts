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
import { DEFAULT_W, TOTAL_STAGES, currentR as fsrsCurrentR } from './fsrs';
import { partitionQueue, dueLaterTodayCount, etaTextOf, isEarlyDue, isDueToday } from './queue';
import { computeStats, RATING_NAMES } from './stats';
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

export interface QueueViewCtx {
  now?: number;
  showArchived?: boolean;
  /** R 阈值（提前复习判定；与开始本轮同源） */
  rThreshold?: number;
  /** 调度权重源（拟合权重；缺省回退 DEFAULT_W） */
  w?: number[];
  /** 回收站条数（0/缺省不显示入口——没删过东西时多一个入口只是噪音） */
  trashCount?: number;
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
  const cls = [
    'bzrv-q-card',
    item.isOverdue ? 'danger' : '',
    item.isCompleted ? 'done' : '',
    canPlay ? '' : 'no',
    item.isMissing ? 'missing' : '',
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
  return `
      <div class="${cls}" data-id="${item.id}" role="button" tabindex="${canPlay || item.isMissing ? '0' : '-1'}" aria-disabled="${canPlay ? 'false' : 'true'}">
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

  const head = `
      <div class="bzrv-panel-head">
        <div class="bzrv-panel-brand">${iconSpan('repeat-2', 'bzrv-ic--sm')}</div>
        <div class="bzrv-panel-title">复习计划</div>
        <div class="bzrv-panel-head-pipe"></div>
        <div class="bzrv-panel-head-sub">${todayLabel(new Date(now))}</div>
        <span class="bzrv-panel-head-sp"></span>
        <div class="bzrv-panel-head-btns">
          <!-- ⚙️ 设置：2026-11-13 用户拍板回到主界面（与 bz Reader 同形制），原生设置页已下线。
               ✕ 桌面端隐藏（styles.css ≥769px 规则，浮层点遮罩/ESC 关），移动端保留。 -->
          <button class="bzrv-icon-btn" data-act="settings" title="设置">${iconSpan('settings', 'bzrv-q-ic')}</button>
          <button class="bzrv-icon-btn" data-act="close" title="关闭">${iconSpan('x', 'bzrv-q-ic')}</button>
      </div>
      </div>`;

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
    /* 空计划 + 回收站里有东西 = 刚把最后几条删掉。这时候不给入口，用户就只剩
       「去设置里翻」一条路——把回收站入口留在空态下面。 */
    const emptyFooter =
      (ctx.trashCount ?? 0) > 0
        ? `<div class="bzrv-q-footer">
        <span class="bzrv-q-fitem bzrv-touch-target--lg" data-act="trash" title="最近删掉的条目，可以捞回来">
          ${iconSpan('trash-2', 'bzrv-q-ic')}<span class="lbl">回收站 <b>${ctx.trashCount}</b> 条</span>
        </span>
      </div>`
        : '';
    return `<div class="bzrv-q-view">${head}${strip}<div class="bzrv-q-cols bzrv-q-empty-wrap"><div data-empty-host></div></div>${emptyFooter}</div>`;
  }

  // item 8：今日全清（开始本轮集合为空 = 逾期/今日/提前全无）→ 绿点 +「今日已清空」+ 隐藏主按钮
  // （partitionQueue 的 today 列已含提前卡 → overdue+today 与 roundQueue 同集合，item 6 同口径）
  const clearToday = col.overdue.length + col.today.length === 0;
  const futureCount = col.future.length;
  /* 文件不在了的条目只躺在归档列表里，待复习这边一条都看不见——用户根本不知道
     自己有卡挂着。状态条上带一句，至少有个线索可循。 */
  const missingCount = items.filter((i) => i.isMissing).length;

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
        <span class="bzrv-q-strip-txt">今日 ${col.today.length} 条到期 · 逾期 ${col.overdue.length} 条顺延${dueLaterTodayCount(items, new Date(now)) ? ` · 今天稍后还有 ${dueLaterTodayCount(items, new Date(now))} 条` : ''}${missingCount ? ` · ${missingCount} 条文件缺失` : ''}</span>
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
  /* 「已完成」只数真的复习完了的。col.done 里还混着挂起（文件缺失）的条目——
     直接拿它的长度当完成数，会让「已完成 2 篇」里藏着一条早就丢了文件的记录。 */
  const doneCount = items.filter((i) => i.completed || i.isCompleted).length;
  const archItem = ctx.showArchived
    ? `<span class="bzrv-q-fitem bzrv-touch-target--lg is-back" data-act="arch" title="点此返回队列">
        ${iconSpan('undo-2', 'bzrv-q-ic')}<span class="lbl">返回队列</span>
      </span>`
    : `<span class="bzrv-q-fitem bzrv-touch-target--lg" data-act="arch" title="查看已完成复习">
        ${iconSpan('folder', 'bzrv-q-ic')}<span class="lbl">已完成 <b>${doneCount}</b> 条</span>
      </span>`;
  /* 回收站入口只在真有东西时出现：没删过东西的人不需要一个永远空着的入口，
     删过的人则必须有地方把东西捞回来（以前只有几秒的 toast 撤销，错过就没了）。 */
  const trashItem = (ctx.trashCount ?? 0) > 0
    ? `<span class="bzrv-q-fitem bzrv-touch-target--lg" data-act="trash" title="最近删掉的条目，可以捞回来">
        ${iconSpan('trash-2', 'bzrv-q-ic')}<span class="lbl">回收站 <b>${ctx.trashCount}</b> 条</span>
      </span>`
    : '';
  const footer = `
      <div class="bzrv-q-footer">
        ${archItem}
        ${trashItem ? `<i class="sep"></i>${trashItem}` : ''}
        <i class="sep"></i>
        <span class="bzrv-q-fitem bzrv-touch-target--lg" data-act="stats" title="逐幕回放全馆记忆">
          ${iconSpan('flame', 'bzrv-q-ic')}<span class="lbl">累计 <b>${stats.totalReviews}</b> 天 · 连续 <b>${stats.streak}</b> 天</span>
        </span>
      </div>`;

  return `<div class="bzrv-q-view">${head}${strip}${body}${footer}</div>`;
}

// ==================== 回收站视图 ====================

/** 删除时间的人话（刚删的别写「0 天前删除」） */
export function deletedLabel(at: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - at);
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days} 天前删除`;
  const hours = Math.floor(diff / 3600000);
  if (hours > 0) return `${hours} 小时前删除`;
  return '刚刚删除';
}

/**
 * 回收站视图：一条一行，右下一个「恢复」。
 * 恢复是逐条的而不是全选——用户来这里通常只想捞回刚才误删的那一条。
 */
export function trashViewHtml(entries: ReadonlyArray<{ key: string; title: string; kind: string; at: number }>, ctx: { now?: number } = {}): string {
  const now = ctx.now ?? Date.now();
  const head = `
      <div class="bzrv-panel-head">
        <div class="bzrv-panel-brand">${iconSpan('trash-2', 'bzrv-ic--sm')}</div>
        <div class="bzrv-panel-title">回收站</div>
        <div class="bzrv-panel-head-pipe"></div>
        <div class="bzrv-panel-head-sub">删掉的条目还能捞回来</div>
        <span class="bzrv-panel-head-sp"></span>
        <div class="bzrv-panel-head-btns">
          <button class="bzrv-icon-btn" data-act="trash-back" title="返回队列">${iconSpan('arrow-left', 'bzrv-q-ic')}</button>
          <button class="bzrv-icon-btn" data-act="close" title="关闭">${iconSpan('x', 'bzrv-q-ic')}</button>
        </div>
      </div>`;
  const strip = `<div class="bzrv-q-strip">
        <span class="bzrv-q-strip-dot muted"></span>
        <strong>${entries.length ? `${entries.length} 条` : '空的'}</strong>
        <span class="bzrv-q-strip-txt">只保留最近 30 天；恢复后排期与复习历史原样回来</span>
      </div>`;
  const rows = entries.length
    ? entries
        .map(
          (e) => `
      <div class="bzrv-q-card" data-trash-key="${esc(e.key)}">
        <div class="bzrv-q-card-top">
          <span class="bzrv-q-card-title">${esc(e.title)}</span>
          <span class="bzrv-q-card-stage">${e.kind === 'card' ? '划线' : '笔记'}</span>
        </div>
        <div class="bzrv-q-card-meta">
          <span class="bzrv-q-tag">${deletedLabel(e.at, now)}</span>
          <button class="bzrv-btn bzrv-btn--ghost" data-restore="${esc(e.key)}">恢复</button>
        </div>
      </div>`
        )
        .join('')
    : `<div class="bzrv-q-cols bzrv-q-empty-wrap"><div data-empty-host></div></div>`;
  const footer = `<div class="bzrv-q-footer">
        <span class="bzrv-q-fitem bzrv-touch-target--lg" data-act="trash-back">
          ${iconSpan('undo-2', 'bzrv-q-ic')}<span class="lbl">返回队列</span>
        </span>
        ${
          entries.length
            ? `<i class="sep"></i><span class="bzrv-q-fitem bzrv-touch-target--lg" data-act="trash-restore-all" title="把这些条目全部放回复习计划">
                ${iconSpan('archive-restore', 'bzrv-q-ic')}<span class="lbl">全部恢复</span>
              </span>
              <i class="sep"></i><span class="bzrv-q-fitem bzrv-touch-target--lg" data-act="trash-clear" title="清空后不可恢复">
                ${iconSpan('trash-2', 'bzrv-q-ic')}<span class="lbl">清空回收站</span>
              </span>`
            : ''
        }
      </div>`;
  return `<div class="bzrv-q-view">${head}${strip}<div class="bzrv-q-cols bzrv-q-cols--single">${rows}</div>${footer}</div>`;
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
          <button class="bzrv-icon-btn" data-action="skip" title="跳过此篇（不评级，移到队尾）">${iconSpan('skip-forward', 'bzrv-sprint-ic')}</button>
          <button class="bzrv-icon-btn" data-action="quit" title="回面板">${iconSpan('x', 'bzrv-sprint-ic')}</button>
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
            return `<span class="bzrv-qp-chip"><span class="bzrv-qp-chip-name" title="${esc(label)}">${esc(label)}</span><button type="button" class="bzrv-qp-chip-x" data-rm-folder="${esc(f)}" aria-label="移除 ${esc(label)}">${iconSpan('x', 'bzrv-q-ic')}</button></span>`;
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
        <button class="bzrv-icon-btn" data-act="close" title="关闭">${iconSpan('x', 'bzrv-q-ic')}</button>
      </div>
      <div class="bzrv-qp-body">
        <div class="bzrv-qp-sec">
          <div class="bzrv-qp-sec-label">出题范围</div>
          <div class="bzrv-segmented" role="radiogroup" aria-label="出题范围">${scopeSeg}</div>
          <div class="bzrv-qp-detail-wrap">${detail}</div>
        </div>
        <div class="bzrv-qp-sec">
          <div class="bzrv-qp-sec-label">本轮题量</div>
          <div class="bzrv-segmented" role="radiogroup" aria-label="本轮题量">${batchSeg}</div>
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
        `<button class="bzrv-review-bar-btn bzrv-touch-target--sm is-${r}" data-rating="${r}" title="快捷键 ${esc(keys[r as 'again'])}">${RATING_NAMES[r]}</button>`
    )
    .join('');
  /* 剩余条数与粗估耗时：连着复习时用户最想知道「还要坐多久」，
     给个量级就够，不承诺精确到秒。 */
  const left = p.remaining ?? 0;
  const extra = left > 0 ? `<i> · 剩 ${left} 条 ${etaTextOf(left)}</i>` : '';
  return `
    <span class="bzrv-review-bar-info">${esc(stripTitleMarks(p.name))}<i>(${p.index}/${p.total})</i>${extra}</span>
    <span class="bzrv-review-bar-act">${btns}
      <button class="bzrv-review-bar-btn bzrv-touch-target--sm is-skip" data-rating="skip" title="不评级，直接下一篇">${'跳过'}</button>
      <button class="bzrv-review-bar-btn bzrv-touch-target--sm is-pause" data-rating="pause" title="评完这条停下，断点保留">${'暂停'}</button>
    </span>`;
}
