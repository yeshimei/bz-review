/**
 * 复习统计弹窗 + 复习历史弹窗（ADR-0077，ticket 174 修订版）
 *
 * 用户拍板（2026-09-01）：
 *  - 复习历史：独立弹窗，无标题栏、无「返回统计」按钮、无名称标题行
 *  - 统计页「复习时间线」点文件 → 弹独立复习历史界面
 *  - 日期统一用 bz 相对日期函数 formatRelativeTime
 *
 * 呈报#55（R11，2026-09-20 拍板）：统计弹窗按影院现行统计外观重刷——内容件对齐
 * cinema/analysis.ts 形制（stat-card 统计卡 / sec+sec-title+lucide 板块头 / bar-row·soft-row
 * 条形 / kv-inline 摘要 / top-row 排名行），样式 scoped 在 #bzrv-stats-popup（styles.css），
 * cinema 侧零改动、不抽公共组件（拍板：先重刷，抽公共件另议）。数据驱动的评级色
 * （RATING_COLORS）仍走内联。旧 pastel 彩卡/accent 色条/竖柱图/chip 形制退役。
 *
 * 签名保持：showStatsModal(app, dm) / showTimeline(app, dm, item) / closeStatsModal()（测试依赖）
 */

import { type App } from 'obsidian';
import { topifyZ } from '../core/z-order';
import { bindMaskDismiss } from '../core/mask-dismiss';
import { escManager } from '../core/esc-manager';
import { escapeHtml, formatRelativeTime, stripTitleMarks } from '../core/utils';
import { mountIcons } from '../core/ui';
import type { ReviewDataManager, ReviewItem, FittedParams } from './data';
import { computeStats, loadDistribution, historyOf, dateKey, RATING_NAMES, RATING_COLORS } from './stats';
import { DEFAULT_W, currentR as fsrsCurrentR } from './fsrs';
import { motionStats, motionHistory } from './motion';

import { markOwned } from '../core/scope';
/* 统计弹窗的两个根节点与 ESC 句柄已随「内置页」一并退役（2026-11-15）；
   复习历史弹窗仍是独立浮层，状态在下方 hist* 一组里。 */

// ======================= 影院形制内容件（R11 重刷） =======================

function esc(s: unknown): string {
  return escapeHtml(String(s ?? ''));
}

/** 统计卡（cinema stat-card 形制：大数 .v + 小标 .k） */
function statCardHTML(label: string, value: any): string {
  return `<div class="stat-card"><div class="v">${esc(value)}</div><div class="k">${esc(label)}</div></div>`;
}

/** 板块容器（cinema sec 形制：lucide 板块头 + 标题 + 延伸线；icon = 板块语义 lucide 名） */
function sectionHTML(title: string, icon: string, body: string): string {
  return `<div class="sec"><div class="sec-title"><i data-lucide="${icon}" class="bzrv-ic"></i>${esc(title)}</div>${body}</div>`;
}

function emptyHTML(): string {
  return '<p class="bzrv-stats-empty">暂无数据</p>';
}

/** 水平条形行（cinema bar-row 形制；color 数据驱动内联——评级色/板块主题色） */
function barRowHTML(entries: Array<{ label: string; value: number }>, color: string): string {
  if (!entries.length) return emptyHTML();
  const max = Math.max(...entries.map((e) => e.value), 1);
  return entries.map((e) => `
    <div class="bar-row">
      <span class="bar-label">${esc(e.label)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${Math.round((e.value / max) * 100)}%;background:${color};"></span></span>
      <span class="bar-num">${e.value}</span>
    </div>`).join('');
}

/** 软条行（cinema soft-row 形制；圆角胶囊） */
function softRowHTML(entries: Array<{ label: string; value: number }>, color: string): string {
  if (!entries.length) return emptyHTML();
  const max = Math.max(...entries.map((e) => e.value), 1);
  return entries.map((e) => `
    <div class="soft-row">
      <span class="bar-label">${esc(e.label)}</span>
      <span class="soft-track"><span class="soft-fill" style="width:${Math.round((e.value / max) * 100)}%;background:${color};"></span></span>
      <span class="bar-num">${e.value}</span>
    </div>`).join('');
}

/** kv 摘要行（cinema kv-inline 形制；title 悬浮注解保留） */
function statInlineHTML(items: Array<string | { text: string; title?: string }>): string {
  return `<div class="kv-inline">${items
    .map((s) => {
      const o = typeof s === 'string' ? { text: s } : s;
      return `<span${o.title ? ` title="${escapeHtml(o.title)}"` : ''}>${o.text}</span>`;
    })
    .join('')}</div>`;
}

/** 排名列表行（cinema top-row 形制；R7 键盘可达：role=button + tabindex，行为由渲染方委托） */
function rankListHTML(items: Array<{ name: string; sub: string; meta: string }>): string {
  if (!items.length) return emptyHTML();
  return items.map((it, i) => `
    <div class="top-row${i < 3 ? ' is-top' : ''}" data-idx="${i}" role="button" tabindex="0"
      aria-label="查看 ${escapeHtml(it.name)} 的复习历史" title="查看复习历史">
      <span class="top-no">${i + 1}</span>
      <span class="top-name">${escapeHtml(it.name)}</span>
      ${it.sub ? `<span class="top-sub">${it.sub}</span>` : ''}
      <span class="top-val">${it.meta}</span>
    </div>`).join('');
}

// ======================= 统计（内置页） =======================
/**
 * 打开复习统计。
 *
 * 2026-11-15 用户拍板：**统计不再做成弹窗**，统一进复习面板的「数据」内置页。
 * 这里保留旧签名（命令、降级路径、测试都按它调用），实现改成「打开面板并切到数据页」；
 * 弹窗壳（`#bzrv-stats-mask` / `#bzrv-stats-popup`）随之退役，`paintStatsInto`
 * 仍是唯一的内容渲染入口——内置页与任何将来的容器继续共用它。
 */
export async function showStatsModal(app: App, dm: ReviewDataManager): Promise<void> {
  const { uiManager } = await import('./index');
  if (uiManager) {
    await uiManager.openData();
    return;
  }
  /* 面板还没装起来（极端情况：插件刚加载就执行命令）。退化成「先把面板开起来」，
     统计内容由面板自己在数据页里画，不再另开一层弹窗。 */
  const { openReviewPanel } = await import('./index');
  openReviewPanel(app);
  void dm;
}

/** 把统计内容画进任意容器（批 8：面板内置「数据」页与 600px 弹窗共用同一份） */
export function paintStatsInto(
  body: HTMLElement,
  app: App,
  dm: ReviewDataManager,
  items: ReviewItem[],
  w?: number[],
  fit?: FittedParams | null,
): void {
  const stats = computeStats(items, { w });
  body.innerHTML = buildStatsHTML(app, dm, items, stats, fit);
  mountIcons(body); // R11：sec 板块头 lucide 兑现
  motionStats(body); // 光泽开场+统计卡滚数+条浪+时间线接力

  // 时间线列表行 → 独立复习历史弹窗（click + 键盘 Enter/Space，R7 可达）
  const openTimeline = (el: HTMLElement): void => {
    const idx = Number(el.dataset.idx);
    const target = items.filter((i) => (i.reviewHistory || []).length)
      .sort((a, b) => {
        const la = a.reviewHistory?.[a.reviewHistory.length - 1]?.timestamp || '';
        const lb = b.reviewHistory?.[b.reviewHistory.length - 1]?.timestamp || '';
        return lb.localeCompare(la);
      })[idx];
    if (target) void showTimeline(app, dm, target);
  };
  body.querySelectorAll<HTMLElement>('.top-row[data-idx]').forEach((el) => {
    el.addEventListener('click', () => openTimeline(el));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openTimeline(el);
      }
    });
  });
}

/** 构建统计弹窗 HTML（影院形制：stat-card + sec 板块） */
function buildStatsHTML(app: App, dm: ReviewDataManager, items: ReviewItem[], stats: ReturnType<typeof computeStats>, fit?: FittedParams | null): string {
  // 统计卡（cinema stat-cards 形制；6 卡）
  const cards = `
    <div class="stat-cards">
      ${statCardHTML('总复习（天）', stats.totalReviews)}
      ${statCardHTML('连续天数', stats.streak)}
      ${statCardHTML('今日复习', stats.todayReviews)}
      ${statCardHTML('逾期率', Math.round(stats.overdueRate * 100) + '%')}
      ${statCardHTML('平均 R', stats.avgR === null ? '-' : Math.round(stats.avgR * 100) + '%')}
      ${statCardHTML('复习笔记', stats.reviewedNotes)}
    </div>`;

  // 拟合档位标注（issue 361；人话 + title 悬浮注解保留）：
  // 全参 = 按你的记录定制（19 参数全拟合）；基础 = 简化版（8 参数）；默认参数 = 尚未拟合。
  // 附样本量与拟合时间。
  const fitChips = fit
    ? statInlineHTML([
        {
          text: fit.full ? '记忆曲线：按你的记录定制' : '记忆曲线：简化版',
          title: fit.full
            ? '用全部 19 个记忆参数拟合你的复习记录，越用越贴合你的节奏'
            : '先用 8 个核心参数拟合的简化版，复习记录攒够后会自动升级为完整定制',
        },
        `样本 ${fit.fitCount} 条`,
        `拟合于 ${formatRelativeTime(new Date(fit.fitAt))}`,
      ])
    : statInlineHTML([{ text: '记忆曲线：默认参数，复习积累后自动拟合', title: '复习记录攒够（约 100 条评级）后会自动拟合你的记忆曲线' }]);

  // 评级分布（soft-row 软条 + 评级色数据驱动）
  const total = Object.values(stats.ratingDist).reduce((a, b) => a + b, 0) || 1;
  const ratingBars = (['again', 'hard', 'good', 'easy'] as const).map((r) => ({
    label: RATING_NAMES[r],
    value: stats.ratingDist[r] || 0,
    color: RATING_COLORS[r] || '#D6E4FF',
  }));
  const ratingHTML = sectionHTML('评级分布', 'gauge',
    ratingBars.map((e) => softRowHTML([e], e.color)).join('') +
    statInlineHTML([`共 ${total} 次评级`]));

  // 复习负载：今日/明日 + 未来 14 天分布（bar-row 水平条）
  const dist = loadDistribution(items, 14);
  const tmr = new Date();
  tmr.setDate(tmr.getDate() + 1);
  const todayKey = dateKey(new Date());
  const tmrKey = dateKey(tmr);
  const todayCnt = dist.find((d) => d.date === todayKey)?.count || 0;
  const tmrCnt = dist.find((d) => d.date === tmrKey)?.count || 0;
  const maxDist = Math.max(1, ...dist.map((d) => d.count));
  const distBars = dist.map((d) => ({
    label: d.date === todayKey ? '今' : `+${dist.indexOf(d)}`,
    value: d.count,
  }));
  const loadHTML = sectionHTML('复习负载', 'calendar-days',
    statInlineHTML([`今日 ${todayCnt} 篇`, `明日 ${tmrCnt} 篇`, `峰值 ${maxDist} 篇/天`]) +
    barRowHTML(distBars, '#D6E4FF'));

  // 复习时间线（top-row 排名行，点行/Enter → 独立复习历史弹窗）
  const withHistory = items
    .filter((i) => (i.reviewHistory || []).length)
    .sort((a, b) => {
      const la = a.reviewHistory?.[a.reviewHistory.length - 1]?.timestamp || '';
      const lb = b.reviewHistory?.[b.reviewHistory.length - 1]?.timestamp || '';
      return lb.localeCompare(la);
    });
  const tlItems = withHistory.slice(0, 10).map((i) => {
    const h = i.reviewHistory || [];
    const lastTs = h[h.length - 1]?.timestamp;
    const cnt = h.length;
    return {
      name: stripTitleMarks(i.name),
      sub: `${cnt} 次`,
      meta: lastTs ? formatRelativeTime(new Date(lastTs)) : '',
    };
  });
  const timelineHTML = sectionHTML('复习时间线', 'history',
    rankListHTML(tlItems) + '<div class="bzrv-stats-hint">点击笔记查看复习历史</div>');

  // 最近 7 天（bar-row 水平条）
  const daily7 = stats.daily7.map((d) => ({ label: d.date.slice(5).replace('-', '/'), value: d.count }));
  const weekHTML = sectionHTML('最近 7 天复习量', 'bar-chart-3', barRowHTML(daily7, '#E6DFF5'));

  return cards + fitChips + ratingHTML + loadHTML + timelineHTML + weekHTML;
}

// ======================= 复习历史独立弹窗 =======================
let histMask: HTMLElement | null = null;
let histPopup: HTMLElement | null = null;
let histEsc: { unregister: () => void } | null = null;

/** 单条笔记复习历史（独立弹窗：无标题栏、无返回统计按钮、无名称标题行；时间轴竖线式）。
 *  当前 R 展示与调度同口径：读拟合权重 currentW()（item 12；取不到回退默认） */
export async function showTimeline(app: App, dm: ReviewDataManager, item: ReviewItem): Promise<void> {
  closeTimeline();
  let w: number[] | undefined;
  try {
    w = (await import('./app')).reviewApp.currentW();
  } catch {
    w = undefined;
  }
  const history = historyOf(item);

  histMask = document.createElement('div');
  histMask.id = 'bzrv-history-mask';
  histMask.className = 'bzrv-overlay-mask'; // issue 365：遮罩底/blur 收编 core 单源
  histMask.style.display = 'block';
  bindMaskDismiss(histMask, closeTimeline); // 手势配对判据（core/mask-dismiss）

  histPopup = document.createElement('div');
  histPopup.id = 'bzrv-history-popup';
  histPopup.style.display = 'flex';
  topifyZ(histMask, histPopup); // ADR-0067：显示时发号单形制（构造期不再 allocZ 占号）

  const body = document.createElement('div');
  body.id = 'bzrv-history-body';
  body.className = 'bz-bzrv-history-body';
  histPopup.appendChild(body);

  markOwned(histMask);
  document.body.appendChild(histMask);
  markOwned(histPopup);
  document.body.appendChild(histPopup);

  // 无标题栏：内容直接顶到卡片；关闭 = 点遮罩（issue 271 统一）
  // 当前状态（替代标题栏：笔记名 + 阶段/当前 R 小字，紧凑一行）
  const status = document.createElement('div');
  status.className = 'bzrv-review-history-status';
  const stageText = item.phase === 'fsrs'
    ? `FSRS Lv.${(item.stage || 0) - 9 + 1}`
    : `${(item.stage || 0) + 1}/10`;
  // A7：R 公式单源 fsrs.currentR（权重=拟合 currentW 回退默认）
  const R = fsrsCurrentR(item, w || DEFAULT_W);
  const curR = R === null ? null : ` · 当前 R ${Math.round(R * 100)}%`;
  status.innerHTML = `
    <div class="bzrv-review-history-name">${escapeHtml(stripTitleMarks(item.name))}</div>
    <div class="bzrv-review-history-sub">${stageText} · 共 ${history.length} 次复习${curR || ''}</div>
  `;
  body.appendChild(status);

  if (!history.length) {
    const empty = document.createElement('div');
    empty.className = 'bzrv-review-history-empty';
    empty.textContent = '暂无复习记录';
    body.appendChild(empty);
    histEsc = escManager.register('bzrv-review-history', { isVisible: () => !!histMask && histMask.style.display === 'block', close: closeTimeline });
    return;
  }

  // 时间轴竖线式（变体 D）：圆点 + 竖线连接 + 时间/评级/元数据（issue 270：静态样式收编
  // src/review/styles.css .bzrv-review-history-*，圆点/评级字色为 RATING_COLORS 动态内联）
  const tl = document.createElement('div');
  tl.className = 'bzrv-review-history-tl';
  const itemsHTML = history.map((h, i) => {
    const isLast = i === history.length - 1;
    const ratingName = RATING_NAMES[h.rating] || h.rating;
    const color = RATING_COLORS[h.rating] || '#888';
    // app.ts 落盘 R 已是 0-100（Math.round(R*100)），直接取整展示；
    // 老数据若存过 0-1 小数 → <=1 分支兼容放大
    const rText = h.R !== undefined ? `R=${h.R <= 1 ? Math.round(h.R * 100) : Math.round(h.R)}%` : '';
    const sText = h.stability !== undefined ? `S=${h.stability}` : '';
    const meta = [rText, sText].filter(Boolean).join(' · ');
    const line = isLast ? '' : '<div class="bzrv-review-history-line"></div>';
    return `
      <div class="bzrv-review-history-item${isLast ? ' is-last' : ''}">
        ${line}
        <div class="bzrv-review-history-dot" style="background:${color};"></div>
        <div class="bzrv-review-history-row">
          <span class="bzrv-review-history-time">${formatRelativeTime(new Date(h.timestamp))}</span>
          <span class="bzrv-review-history-rating" style="color:${color};">${ratingName}</span>
          <span class="bzrv-review-history-stage">阶段${h.stage}${meta ? ' · ' + meta : ''}</span>
        </div>
      </div>`;
  }).join('');
  tl.innerHTML = itemsHTML;
  body.appendChild(tl);
  motionHistory(body); // 记忆回放：圆点逐个点亮、竖线生长

  histEsc = escManager.register('bzrv-review-history', {
    isVisible: () => !!histMask && histMask.style.display === 'block',
    close: closeTimeline,
  });
}

/** 关闭复习历史弹窗 */
export function closeTimeline(): void {
  histEsc?.unregister();
  histEsc = null;
  if (histMask) histMask.remove();
  if (histPopup) histPopup.remove();
  histMask = null;
  histPopup = null;
}

/**
 * 关闭统计相关浮层（签名保留：unload 清场与测试都调它）。
 *
 * 统计已经进内置页，这里只剩「连带关掉复习历史浮层」——历史行仍会从统计页
 * 点开，它是唯一还在用的浮层。
 */
export function closeStatsModal(): void {
  closeTimeline();
}
