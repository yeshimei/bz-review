/* ============================================================
 * 复习设置页 · 纯渲染零件（src/review/ui/settings-page-pure.ts）
 *
 * 只吃参数、吐字符串/数组，不 import obsidian、不碰全局。
 * 原型 prototypes/settings-page.html 的关于条按 1:1 搬运：
 *   R 品牌 / Review / 版本 / 身份徽章 / 五个出口（GitHub、视频、群、支持作者、更新日志）。
 * 读屏名字一律走 bzs-sr-only，不挂 title / aria-label（仓库禁令）。
 * 文案走 `../../i18n/strings`（纯核心，不拉 obsidian）。
 * ============================================================ */
import { locale, t } from '../../i18n/strings';

/** 分组英文副标：原型 h3::after 的 data-en，桌面两列都要有 */
export const GROUP_SUBTITLES: Record<string, string> = {
  授权: 'License',
  数据: 'Data',
  界面: 'Appearance',
  检查提醒: 'Reminders',
  划线卡: 'Cards',
  做题家: 'Quiz',
  复习节奏: 'Schedule',
  记忆算法: 'Algorithm',
  自动化: 'Automation',
  AI: 'AI',
  探索: 'Explore',
  插件: 'Plugins',
};

/**
 * 设置页分组的阅读顺序（左侧从上到下、再右侧从上到下）。
 *
 * 授权 → 数据 → 自动化 → 检查提醒 → 界面（先账号、数据、自动收编与提醒，再外观）
 * → 划线卡 → 做题家（怎么把内容做成卡）
 * → 复习节奏 → 记忆算法 → AI → 探索（怎么复习、算间隔，最后是进阶与实验）。
 * 这一顺序也决定两列的切分点：读起来连贯，编号才不会跳。
 */
export const GROUP_ORDER: readonly string[] = [
  '授权', '数据', '自动化', '检查提醒', '界面',
  '划线卡', '做题家', '复习节奏', '记忆算法', 'AI', '探索',
] as const;

/**
 * 真机（1024×800、默认设置）量出来的各组高度，单位 px，只作配平权重，
 * 不参与布局。用实测值而不是行数：AI 组 24 行里绝大多数按服务商显隐，
 * 界面组的强调色自绘行比普通开关高一截——按行数算永远配不平。
 * 窄栏（单列）与弹窗两列各 452px 两种宽度都量过，切分点相同；
 * 两列实测列高约 1895 / 2007px，差 112px（约 6%）。
 */
export const GROUP_WEIGHTS: Record<string, number> = {
  授权: 306, 数据: 211, 自动化: 217, 检查提醒: 175, 界面: 276,
  划线卡: 134, 做题家: 352, 复习节奏: 761, 记忆算法: 326, AI: 388, 探索: 247,
};

/**
 * 两列分栏：在保持阅读顺序的前提下找一个切分点，使两列总高度尽量接近。
 *
 * 以前的贪心「谁矮往谁那放」会把末尾的「探索」塞进左列，编号 5 直接跳到实验功能，
 * 数据组却排到 6——视觉配平了，顺序乱了。现在只切一刀：前 k 组在左、其余在右，
 * 列内保持原顺序、同组不拆；CSS 计数器按 DOM 顺序出号，所以编号连贯。
 * weights 缺省时按组数均分（纯测试与无 schema 场景用）。
 */
export function groupColumns(names: readonly string[], weights: readonly number[] = []): [string[], string[]] {
  if (names.length === 0) return [[], []];
  const w = names.map((_, i) => Math.max(1, Number(weights[i]) || 1));
  const total = w.reduce((a, b) => a + b, 0);
  let best = 0;
  let bestDiff = Infinity;
  let leftSum = 0;
  /* k = 左列最后一组的下标；并列时取更靠后的切分点（左列多一组，与旧口径一致） */
  for (let k = 0; k < names.length - 1; k++) {
    leftSum += w[k];
    const diff = Math.abs(total - 2 * leftSum);
    if (diff <= bestDiff) {
      bestDiff = diff;
      best = k;
    }
  }
  return [names.slice(0, best + 1), names.slice(best + 1)];
}

/** 按 GROUP_ORDER 重排（未知组保持相对顺序追加在末尾），返回新数组，不改入参。 */
export function orderGroups<T extends { name: string }>(groups: readonly T[]): T[] {
  const rank = (name: string): number => {
    const i = GROUP_ORDER.indexOf(name);
    return i === -1 ? GROUP_ORDER.length : i;
  };
  return groups
    .map((g, i) => ({ g, i }))
    .sort((a, b) => rank(a.g.name) - rank(b.g.name) || a.i - b.i)
    .map((x) => x.g);
}

const GITHUB_SVG =
  '<svg class="ic" viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">' +
  '<path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.4-4-1.4-.6-1.4-1.4-1.8-1.4-1.8-1.1-.8.1-.8.1-.8 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.4 11.4 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3z"/></svg>';
const VIDEO_SVG =
  '<svg class="ic" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">' +
  '<rect x="2.8" y="5" width="18.4" height="14" rx="3.2"/><path d="M10.3 9.4 15 12l-4.7 2.6z" fill="currentColor" stroke="none"/></svg>';
const GROUP_SVG =
  '<svg class="ic" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">' +
  '<path d="M20.5 11.4a7.9 7.9 0 0 1-8.5 7.9 8.6 8.6 0 0 1-3.5-.8L4.6 20.4l1.5-4A7.7 7.7 0 0 1 4 11.4 7.9 7.9 0 0 1 12.2 3.5a7.9 7.9 0 0 1 8.3 7.9Z"/>' +
  '<path d="M9 11.5h.01M12.2 11.5h.01M15.4 11.5h.01"/></svg>';
const HEART_SVG =
  '<svg class="ic" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">' +
  '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>';
const HISTORY_SVG =
  '<svg class="ic" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">' +
  '<path d="M3.4 12a8.6 8.6 0 1 0 2.9-6.4L3.4 8"/><path d="M3.2 3.4v4.9h4.9"/><path d="M12 7.4v5l3.1 2"/></svg>';

const esc = (s: string | number | null | undefined): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * 关于条 HTML（通栏，位于两列网格之上）。
 * 身份徽章三种：赞助人（带昵称则用昵称）/ 高级版 / 基础版，与 reader 同一口径。
 */
export function aboutBarHtml(version: string, paid: boolean, name: string, groupId = '1130883117'): string {
  const label = paid ? (name ? esc(name) : t('about.pro')) : t('about.base');
  const cls = `bzs-about-badge${paid ? '' : ' is-base'}`;
  const seal = paid ? '<span class="seal">✦</span>' : '';
  const sr = paid ? `<span class="bzs-sr-only">${esc(name ? t('about.patron') : t('about.pro'))}</span>` : '';
  return `<div class="bzs-setgrp wide bzs-about">
      <span class="bzs-brand-txt"><h3>bz Review</h3></span>
      <span class="bzs-about-meta">
        <span class="bzs-about-ver">v${esc(version)}</span>
        <span class="${cls}">${seal}${sr}${label}</span>
      </span>
      <span class="sp"></span>
      <button class="bzs-about-link" type="button" data-act="aboutgithub">${GITHUB_SVG}<b>GitHub</b><span class="bzs-sr-only">${esc(t('about.githubSr'))}</span></button>
      <span class="dot"></span>
      <button class="bzs-about-link" type="button" data-act="aboutvideo">${VIDEO_SVG}<b>${esc(t('about.video'))}</b><span class="bzs-sr-only">${esc(t('about.videoSr'))}</span></button>
      <span class="dot"></span>
      <button class="bzs-about-link" type="button" data-act="copygroup">${GROUP_SVG}<b>${esc(t('about.group'))}</b><i>${esc(groupId)}</i><span class="bzs-sr-only">${esc(t('about.copyGroupSr'))}</span></button>
      <span class="dot"></span>
      <button class="bzs-about-link" type="button" data-act="support">${HEART_SVG}<b>${esc(t('settings.about.support'))}</b><span class="bzs-sr-only">${esc(t('settings.about.supportTip'))}</span></button>
      <span class="dot"></span>
      <button class="bzs-about-link" type="button" data-act="changelog">${HISTORY_SVG}<b>${esc(t('settings.about.changelog'))}</b><span class="bzs-sr-only">${esc(t('settings.about.changelogTip'))}</span></button>
    </div>`;
}

const READER_ICON_SVG =
  '<svg class="ic" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">' +
  '<path d="M12 6c-2.2-1.6-5-1.9-8-1.3v13c3-.6 5.8-.3 8 1.3 2.2-1.6 5-1.9 8-1.3v-13c-3-.6-5.8-.3-8 1.3Z"/><path d="M12 6v13"/></svg>';
const DOWNLOAD_SVG =
  '<svg class="ic" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">' +
  '<path d="M12 3v12m0 0 4-4m-4 4-4-4M4 19h16"/></svg>';

export interface ReaderPluginState {
  installed: boolean;
  enabled: boolean;
  broken: boolean;
  version: string;
}

/**
 * 插件组 HTML（2026-11-20；2026-11-21 改成真安装）：
 * 未装 → 「安装」，点击后按钮原地 loading、直接下载三件套并启用；
 * 已装未启用 → 「启用」，点击直接调宿主启用，不用再去找第三方插件开关；
 * 已装已启用 → 「打开」，点击直接开 bz Reader 书架。版本号只做展示，不参与判断。
 */
export function pluginGroupHtml(reader?: ReaderPluginState): string {
  const installed = !!reader?.installed && !reader?.broken;
  const enabled = installed && !!reader?.enabled;
  const version = String(reader?.version || '').replace(/[^\w.+-]/g, '');
  const desc = installed
    ? t('plugin.readerInstalled', {
        version: version ? ` v${version}` : '',
        disabled: reader?.enabled ? '' : t('plugin.disabledNote'),
      }) + t('plugin.readerDesc')
    : t('plugin.readerDesc');
  /* 三态动作：未装 → 安装；装了没启用 → 启用；启用中 → 打开（2026-11-21 master 新增「启用」）。 */
  const act = !installed ? 'readerinstall' : enabled ? 'readeropen' : 'readerenable';
  const label = !installed
    ? t('plugin.install')
    : enabled
      ? t('plugin.open')
      : t('plugin.enable');
  /* 组名英文副标只在中文界面挂：英文界面里 h3 本身就是英文，再挂一遍会显示两次。 */
  const sub = locale() === 'zh' ? ' data-en="Plugins"' : '';
  return `<div class="bzs-setgrp wide bzs-plugin-grp" data-group="插件">
      <h3${sub}>${esc(t('plugin.title'))}</h3>
      <div class="bzs-cap is-on">
        <span class="bzs-capico">${READER_ICON_SVG}</span>
        <div class="bzs-capmain">
          <div class="bzs-cap-t"><b>bz Reader</b><span class="bzs-capchip">${esc(t('plugin.readerChip'))}</span></div>
          <p>${esc(desc)}</p>
          <div class="bzs-captags"><span class="bzs-tag">${esc(t('plugin.tag.formats'))}</span><span class="bzs-tag">${esc(t('plugin.tag.qa'))}</span><span class="bzs-tag">${esc(t('plugin.tag.tts'))}</span></div>
          <div class="bzs-capfoot">
            <button class="bzs-btn sm pri" type="button" data-act="${act}">${DOWNLOAD_SVG}<span class="bzs-btn-label">${label}</span></button>
          </div>
        </div>
      </div>
    </div>`;
}
