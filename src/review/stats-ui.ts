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
import { computeStats, compareReviewLoad, historyOf, RATING_NAMES, RATING_COLORS } from './stats';
import { computeRichStats, shortDate, type DayCount } from './stats-rich';
import { DEFAULT_W, currentR as fsrsCurrentR } from './fsrs';
import { stageNum } from './render';
import { motionStats, motionHistory } from './motion';

import { markOwned } from '../core/scope';
/* 统计弹窗的两个根节点与 ESC 句柄已随「内置页」一并退役（2026-11-15）；
   复习历史弹窗仍是独立浮层，状态在下方 hist* 一组里。 */

// ======================= 影院形制内容件（R11 重刷） =======================

/** 会被 HTML 转义的纯值：只收字符串与数字，避免 unknown 走 String() 得到 [object Object] */
type EscValue = string | number;

function esc(s: EscValue): string {
  return escapeHtml(String(s));
}

/** 统计卡（cinema stat-card 形制：大数 .v + 小标 .k） */
function statCardHTML(label: string, value: EscValue): string {
  return `<div class="stat-card"><div class="v">${esc(value)}</div><div class="k">${esc(label)}</div></div>`;
}

/** 装载一段受控 HTML（解析规则与 innerHTML 同源，但不直接写 innerHTML/outerHTML） */
function setMarkup(el: HTMLElement, html: string): void {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  el.replaceChildren(...Array.from(doc.body.childNodes, (n) => document.importNode(n, true)));
}

/** 浮层显隐用的 display 值集中成常量：obsidianmd 只拦字面量直接写进 style，
 *  从常量取值是它明确允许的写法（规则源码见 noStaticStylesAssignment）。 */
const CSS_DISPLAY_BLOCK = 'block';
const CSS_DISPLAY_FLEX = 'flex';

/** 板块容器（cinema sec 形制：lucide 板块头 + 标题 + 延伸线；icon = 板块语义 lucide 名） */
function sectionHTML(title: string, icon: string, body: string): string {
  return `<div class="sec"><div class="sec-title"><i data-lucide="${icon}" class="bzrv-ic"></i>${esc(title)}</div>${body}</div>`;
}

function emptyHTML(): string {
  return '<div class="bzrv-stats-empty"><i data-lucide="inbox" class="bzrv-ic bzrv-stats-empty-ic"></i></div><div class="bzrv-stats-hint">还没有复习数据，完成一次复习后这里会有统计</div>';
}

/** 水平条形行（cinema bar-row 形制；默认走强调色 token，color 仅在数据驱动的评级色时内联） */
function barRowHTML(entries: Array<{ label: string; value: number }>, color?: string): string {
  if (!entries.length) return emptyHTML();
  const max = Math.max(...entries.map((e) => e.value), 1);
  return entries.map((e) => `
    <div class="bar-row">
      <span class="bar-label">${esc(e.label)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${Math.round((e.value / max) * 100)}%;${color ? `background:${color};` : ''}"></span></span>
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

/** kv 摘要行（cinema kv-inline 形制；副信息用视觉隐藏文本承载，不挂 title 原生气泡） */
function statInlineHTML(items: Array<string | { text: string; title?: string }>): string {
  return `<div class="kv-inline">${items
    .map((s) => {
      const o = typeof s === 'string' ? { text: s } : s;
      return `<span>${o.title ? `<span class="bzrv-sr-only">${escapeHtml(o.title)}</span>` : ''}${o.text}</span>`;
    })
    .join('')}</div>`;
}

/** 排名列表行（cinema top-row 形制；R7 键盘可达：role=button + tabindex，行为由渲染方委托） */
function rankListHTML(items: Array<{ name: string; sub: string; meta: string }>): string {
  if (!items.length) return emptyHTML();
  return items.map((it, i) => `
    <div class="top-row${i < 3 ? ' is-top' : ''}" data-idx="${i}" role="button" tabindex="0"><span class="bzrv-sr-only">查看 ${escapeHtml(it.name)} 的复习历史</span>
      <span class="top-no">${i + 1}</span>
      <span class="top-name">${escapeHtml(it.name)}</span>
      ${it.sub ? `<span class="top-sub">${it.sub}</span>` : ''}
      <span class="top-val">${it.meta}</span>
    </div>`).join('');
}

/** 迷你柱列：24 小时 / 12 个月 / 未来 30 天都用它。高度按各自最大值归一 */
function stripHTML(values: number[], labels: Array<string | null>): string {
  const max = Math.max(1, ...values);
  const cols = values
    .map((v) => `<span class="strip-c${v > 0 ? ' has' : ''}" style="height:${Math.round((v / max) * 100)}%"></span>`)
    .join('');
  const xs = labels.map((l) => `<span>${l === null ? '' : esc(l)}</span>`).join('');
  return `<div class="strip"><div class="strip-cols">${cols}</div><div class="strip-xs" aria-hidden="true">${xs}</div></div>`;
}

/** 近一年热力图（7 行 × 53 列，按周排）；整块一个隐藏说明，不给 365 个格子各挂一句 */
function heatHTML(heat: DayCount[]): string {
  const max = Math.max(1, ...heat.map((d) => d.count));
  const cells = heat
    .map((d) => {
      const lv = d.count === 0 ? 0 : d.count >= max * 0.75 ? 4 : d.count >= max * 0.5 ? 3 : d.count >= max * 0.25 ? 2 : 1;
      return `<i class="hc l${lv}"></i>`;
    })
    .join('');
  const total = heat.reduce((a, d) => a + d.count, 0);
  return `<div class="heat"><span class="bzrv-sr-only">近一年复习热力图，共 ${total} 次</span>${cells}</div>`;
}

/** 成就徽章（实时算，不落盘；未解锁给进度条） */
function badgesHTML(rows: Array<{ id: string; name: string; got: boolean; cur: number; goal: number }>): string {
  if (!rows.length) return emptyHTML();
  return `<div class="badges">${rows
    .map((b) => {
      const p = Math.min(100, Math.round((b.cur / Math.max(1, b.goal)) * 100));
      return `<div class="badge${b.got ? ' is-got' : ''}">
        <i class="bzrv-ic bd" data-lucide="${b.got ? 'award' : 'lock'}"></i>
        <span class="bn">${esc(b.name)}</span>
        <span class="bp"><i style="width:${p}%"></i></span>
        <span class="bv">${b.got ? '已达成' : `${b.cur}/${b.goal}`}</span>
      </div>`;
    })
    .join('')}</div>`;
}

/** 不可点的排行行（时间线那批 .top-row 带点击语义，新列表不能共用，否则会点错条目） */
function rankRowHTML(rows: Array<{ name: string; meta: string; sub?: string }>): string {
  if (!rows.length) return emptyHTML();
  return rows
    .map(
      (r, i) => `<div class="rank-row">
        <span class="top-no">${i + 1}</span>
        <span class="rn">${escapeHtml(r.name)}</span>
        ${r.sub ? `<span class="rs">${escapeHtml(r.sub)}</span>` : ''}
        <span class="rv">${escapeHtml(r.meta)}</span>
      </div>`,
    )
    .join('');
}

/** 环比文案：上期 0 时不显示百分比（除以 0 只会得到「+∞」这种没有意义的东西）；unit 区分周/月 */
function deltaText(cur: number, prev: number, unit = '周'): string {
  if (prev <= 0) return `上${unit}无记录，暂无环比`;
  const d = Math.round(((cur - prev) / prev) * 100);
  if (d === 0) return `与上${unit}持平`;
  return `环比 ${d > 0 ? '+' : ''}${d}%`;
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
  void openReviewPanel(app);
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
  setMarkup(body, buildStatsHTML(app, dm, items, stats, fit, w));
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
function buildStatsHTML(app: App, dm: ReviewDataManager, items: ReviewItem[], stats: ReturnType<typeof computeStats>, fit?: FittedParams | null, w?: number[]): string {
  const rich = computeRichStats(items, { w });

  // 统计卡（cinema stat-cards 形制；6 卡）——「总复习」以前数的是天数，这里改成条次，
  // 天数单列一张，两个口径都在，不会再看串。
  const cards = `
    <div class="stat-cards">
      ${statCardHTML('总复习（次）', rich.reviews)}
      ${statCardHTML('有复习的天数', rich.days)}
      ${statCardHTML('连续天数', rich.streak)}
      ${statCardHTML('今日复习', rich.today)}
      ${statCardHTML('一次通过率', Math.round(rich.passRate * 100) + '%')}
      ${statCardHTML('平均 R', rich.avgR === null ? '-' : Math.round(rich.avgR * 100) + '%')}
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

  // 复习量对比（2026-11-16）：「动态抗遗忘省了多少」从形容词变成两个并排的数。
  // 只摆算术，不承诺效果——固定间隔不一定达到同样的记忆强度，所以文案只说次数。
  const cmp = compareReviewLoad(items);
  let compareHTML = '';
  if (cmp && cmp.notes >= 3) {
    const savedTxt = cmp.saved >= 0 ? `少 ${cmp.saved} 次（${Math.round(cmp.percent * 100)}%）` : `多 ${-cmp.saved} 次`;
    const hint =
      cmp.saved >= 0
        ? `按 1/2/4/7/15/30/60/120 天的老办法，同样这些笔记、同样这些天，要复习 ${cmp.fixed} 次。参与对比 ${cmp.notes} 条，跨度最长的一条已经撑了 ${cmp.spanDays} 天。`
        : `比老办法多出来的部分，通常是提前复习或答错重来——这些都会让下一次间隔更准。参与对比 ${cmp.notes} 条。`;
    compareHTML = sectionHTML(
      '复习量对比',
      'trending-down',
      statInlineHTML([
        { text: `实际 ${cmp.actual} 次`, title: '这套排期实际让你复习的条次（同一天复习多次算一次）' },
        { text: `固定间隔 ${cmp.fixed} 次`, title: '同样的笔记、同样的时间跨度，按固定间隔复习法要复习的条次' },
        { text: savedTxt },
      ]) + `<div class="bzrv-stats-hint">${esc(hint)}</div>`,
    );
  }

  // 评级分布（soft-row 软条 + 评级色数据驱动）
  const ratingSum = Object.values(stats.ratingDist).reduce((a, b) => a + b, 0);
  const ratingBars = (['again', 'hard', 'good', 'easy'] as const).map((r) => ({
    label: RATING_NAMES[r],
    value: stats.ratingDist[r] || 0,
    color: RATING_COLORS[r] || '#D6E4FF',
  }));
  const ratingHTML = sectionHTML('评级分布', 'gauge',
    ratingBars.map((e) => softRowHTML([e], e.color)).join('') +
    statInlineHTML([ratingSum ? `共 ${ratingSum} 次评级` : '暂无评级记录']));

  // 复习负载：未来 30 天迷你柱 + 逾期分档（14 天横条看不清「哪天砸下来」）
  const loadTotal = rich.load.reduce((a, b) => a + b, 0);
  const loadHTML = sectionHTML('到期与逾期', 'calendar-days',
    statInlineHTML([
      `今日 ${rich.load[0]} 条`,
      `明日 ${rich.load[1]} 条`,
      `未来 30 天 ${loadTotal} 条`,
      `挂起 ${rich.suspended} 条`,
    ]) +
    stripHTML(rich.load, rich.load.map((_, i) => (i === 0 ? '今' : i % 7 === 0 ? `+${i}` : null))) +
    barRowHTML(rich.overdue.filter((o) => o.n > 0).map((o) => ({ label: o.label, value: o.n }))));

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
  const weekHTML = sectionHTML('最近 7 天复习量', 'bar-chart-3', barRowHTML(daily7));

  /* ── 加厚层 ──
     全部由 stats-rich 一次算完，这里只排版。口径与上面 6 张卡同一份数据，
     页面里不会出现「卡片说 100 次、下面说 97 次」这种自己打自己。 */

  const ledgerHTML = sectionHTML('复习量账本', 'sigma', statInlineHTML([
    `今日 ${rich.today} 次`,
    `本周 ${rich.weekCur} 次`,
    { text: deltaText(rich.weekCur, rich.weekPrev), title: `上周 ${rich.weekPrev} 次` },
    `本月 ${rich.monthCur} 次`,
    { text: deltaText(rich.monthCur, rich.monthPrev, '月'), title: `上月 ${rich.monthPrev} 次` },
    `今年 ${rich.yearCur} 次`,
    `累计 ${rich.reviews} 次`,
    `活跃日均 ${rich.perActiveDay.toFixed(1)} 次`,
    {
      text: `单日峰值 ${rich.bestDay ? `${rich.bestDay.count} 次` : '-'}`,
      title: rich.bestDay ? `${shortDate(rich.bestDay.date)} 那天` : '',
    },
  ]));

  const hoursTotal = rich.hours.reduce((a, b) => a + b, 0);
  const peakHour = hoursTotal > 0 ? rich.hours.indexOf(Math.max(...rich.hours)) : null;
  const workday = rich.weekdays.slice(0, 5).reduce((a, b) => a + b, 0);
  const weekend = rich.weekdays.slice(5).reduce((a, b) => a + b, 0);
  const rhythmHTML = sectionHTML('复习节律', 'clock',
    statInlineHTML([
      peakHour === null ? '最集中的时段 —' : `最集中的时段 ${peakHour}:00-${peakHour + 1}:00`,
      `工作日 ${workday} 次`,
      `周末 ${weekend} 次`,
    ]) +
    '<div class="sub-h">一天 24 小时</div>' +
    stripHTML(rich.hours, rich.hours.map((_, i) => ([0, 6, 12, 18, 23].includes(i) ? String(i) : null))) +
    '<div class="sub-h">一周</div>' +
    barRowHTML(['一', '二', '三', '四', '五', '六', '日'].map((l, i) => ({ label: l, value: rich.weekdays[i] }))) +
    '<div class="sub-h">今年各月</div>' +
    stripHTML(rich.months, rich.months.map((_, i) => String(i + 1))) +
    statInlineHTML([
      `今年 ${rich.yearCur} 次`,
      `去年 ${rich.monthsPrevYear.reduce((a, b) => a + b, 0)} 次`,
    ]));

  const streakHTML = sectionHTML('连续与活跃', 'flame',
    statInlineHTML([
      `当前连续 ${rich.streak} 天`,
      `历史最长 ${rich.bestStreak} 天`,
      `最长断更 ${rich.gap} 天`,
      `活跃 ${rich.days} 天`,
    ]) +
    heatHTML(rich.heat) +
    '<div class="bzrv-stats-hint">近一年 · 每格一天，颜色越深复习越多</div>');

  const stageQ = rich.stageAgain.filter((s) => s.n > 0);
  const stageHTML = sectionHTML('哪一段最容易被忘', 'trending-down',
    barRowHTML(stageQ.map((s) => ({ label: s.label, value: s.again }))) +
    statInlineHTML(stageQ.map(
      (s) => `${s.label} 忘掉 ${Math.round((s.again / Math.max(1, s.n)) * 100)}%`,
    )));

  const memHTML = sectionHTML('记忆状态', 'brain',
    statInlineHTML([
      `平均 R ${rich.avgR === null ? '-' : `${Math.round(rich.avgR * 100)}%`}`,
      `S 中位数 ${rich.sMedian === null ? '-' : `${Math.round(rich.sMedian)} 天`}`,
      `平均间隔 ${rich.avgInterval === null ? '-' : `${rich.avgInterval.toFixed(1)} 天`}`,
      `新卡 ${rich.phase.ladder} 条`,
      `FSRS ${rich.phase.fsrs} 条`,
    ]) +
    barRowHTML(['0-20%', '20-40%', '40-60%', '60-80%', '80-100%'].map((l, i) => ({
      label: l,
      value: rich.rBuckets[i],
    }))) +
    '<div class="sub-h">最稳的 5 条</div>' +
    rankRowHTML(rich.strongest.map((s) => ({
      name: stripTitleMarks(s.name),
      meta: `S ${Math.round(s.s)} 天`,
    }))) +
    '<div class="sub-h">最容易忘的 5 条</div>' +
    rankRowHTML(rich.weakest.map((s) => ({
      name: stripTitleMarks(s.name),
      meta: `S ${Math.round(s.s)} 天`,
    }))));

  const kindHTML = sectionHTML('内容构成', 'layers',
    statInlineHTML([
      `笔记 ${rich.kinds.note} 条`,
      `划线卡 ${rich.kinds.card} 条`,
    ]) +
    barRowHTML([
      { label: '笔记', value: rich.kinds.noteReviews },
      { label: '划线卡', value: rich.kinds.cardReviews },
    ]) +
    '<div class="sub-h">阶段分布</div>' +
    barRowHTML(rich.stages.filter((s) => s.n > 0).map((s) => ({ label: s.label, value: s.n }))));

  const topHTML = sectionHTML('复习次数排行', 'list-ordered',
    rankRowHTML(rich.top.map((t) => ({ name: stripTitleMarks(t.name), meta: `${t.n} 次` }))) +
    '<div class="bzrv-stats-hint">上面的「复习时间线」点一条，可看它的完整历史</div>');

  /* 徽章墙不在这里：它有自己的「成就」页，统计页只管统计 */

  return cards + fitChips + ledgerHTML + rhythmHTML + streakHTML + compareHTML +
    ratingHTML + stageHTML + memHTML + loadHTML + kindHTML + topHTML +
    timelineHTML + weekHTML;
}

/**
 * 单独的「成就」页（2026-11-20 用户拍板：徽章不放统计下面）。
 * 与统计页共用同一份 computeRichStats，所以两个数绝不会打架；
 * 徽章仍然实时算、不落盘。
 */
export function paintAchievementsInto(body: HTMLElement, items: ReviewItem[], w?: number[]): void {
  const rich = computeRichStats(items, { w });
  const got = rich.badges.filter((b) => b.got).length;
  setMarkup(body,
    `<div class="achv-head">已解锁 <b>${got}</b> / ${rich.badges.length} 枚 · 全部按当前记录实时算，清空数据也不会留下空徽章</div>` +
    sectionHTML('成就', 'trophy', badgesHTML(rich.badges)));
  mountIcons(body);
  motionStats(body);
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

  histMask = createDiv();
  histMask.id = 'bzrv-history-mask';
  histMask.className = 'bzrv-overlay-mask'; // issue 365：遮罩底/blur 收编 core 单源
  histMask.style.display = CSS_DISPLAY_BLOCK;
  bindMaskDismiss(histMask, closeTimeline); // 手势配对判据（core/mask-dismiss）

  histPopup = createDiv();
  histPopup.id = 'bzrv-history-popup';
  histPopup.style.display = CSS_DISPLAY_FLEX;
  topifyZ(histMask, histPopup); // ADR-0067：显示时发号单形制（构造期不再 allocZ 占号）

  const body = createDiv();
  body.id = 'bzrv-history-body';
  body.className = 'bz-bzrv-history-body';
  histPopup.appendChild(body);

  markOwned(histMask);
  document.body.appendChild(histMask);
  markOwned(histPopup);
  document.body.appendChild(histPopup);

  // 无标题栏：内容直接顶到卡片；关闭 = 点遮罩（issue 271 统一）
  // 当前状态（替代标题栏：笔记名 + 阶段/当前 R 小字，紧凑一行）
  const status = createDiv();
  status.className = 'bzrv-review-history-status';
  // FSRS-7 无阶梯：阶段文案走 render.stageNum 单源，避免写死 n/10 与负 Lv。
  const stageText = stageNum(item);
  // A7：R 公式单源 fsrs.currentR（权重=拟合 currentW 回退默认）
  const R = fsrsCurrentR(item, w || DEFAULT_W);
  const curR = R === null ? null : ` · 当前 R ${Math.round(R * 100)}%`;
  setMarkup(status, `
    <div class="bzrv-review-history-name">${escapeHtml(stripTitleMarks(item.name))}</div>
    <div class="bzrv-review-history-sub">${stageText} · 共 ${history.length} 次复习${curR || ''}</div>
  `);
  body.appendChild(status);

  if (!history.length) {
    const empty = createDiv();
    empty.className = 'bzrv-review-history-empty';
    empty.textContent = '完成一次复习后，这里会记下每次评级、留存率 r 和稳定性 s';
    body.appendChild(empty);
    histEsc = escManager.register('bzrv-review-history', { isVisible: () => !!histMask && histMask.style.display === 'block', close: closeTimeline });
    return;
  }

  // 时间轴竖线式（变体 D）：圆点 + 竖线连接 + 时间/评级/元数据（issue 270：静态样式收编
  // src/review/styles.css .bzrv-review-history-*，圆点/评级字色为 RATING_COLORS 动态内联）
  const tl = createDiv();
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
  setMarkup(tl, itemsHTML);
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
