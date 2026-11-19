/* ============================================================
 * 复习设置页 · 纯渲染零件（src/review/ui/settings-page-pure.ts）
 *
 * 只吃参数、吐字符串/数组，不 import obsidian、不碰全局。
 * 原型 prototypes/settings-page.html 的关于条按 1:1 搬运：
 *   R 品牌 / Review / 版本 / 身份徽章 / 五个出口（GitHub、视频、群、支持作者、更新日志）。
 * 读屏名字一律走 bzs-sr-only，不挂 title / aria-label（仓库禁令）。
 * ============================================================ */

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
  朗读: 'Audio',
};

/** 原型左列五组、右列其余；朗读是原型之后新增的组，跟在 AI 后面不丢 */
export function groupColumns(names: readonly string[]): [string[], string[]] {
  return [names.slice(0, 5), names.slice(5)];
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
  const label = paid ? (name ? esc(name) : '高级版') : '基础版';
  const cls = `bzs-about-badge${paid ? '' : ' is-base'}`;
  const seal = paid ? '<span class="seal">✦</span>' : '';
  const sr = paid ? `<span class="bzs-sr-only">${esc(name ? '赞助人' : '高级版')}</span>` : '';
  return `<div class="bzs-setgrp wide bzs-about">
      <span class="bzs-brand-txt">
        <h3>Review</h3>
        <span class="tagline">把要记住的，排进复习计划</span>
      </span>
      <span class="bzs-about-meta">
        <span class="bzs-about-ver">v${esc(version)}</span>
        <span class="${cls}">${seal}${sr}${label}</span>
      </span>
      <span class="sp"></span>
      <button class="bzs-about-link" type="button" data-act="aboutgithub">${GITHUB_SVG}<b>GitHub</b><span class="bzs-sr-only">打开 GitHub 仓库</span></button>
      <span class="dot"></span>
      <button class="bzs-about-link" type="button" data-act="aboutvideo">${VIDEO_SVG}<b>视频教程</b><span class="bzs-sr-only">打开视频教程</span></button>
      <span class="dot"></span>
      <button class="bzs-about-link" type="button" data-act="copygroup">${GROUP_SVG}<b>QQ 交流群</b><i>${esc(groupId)}</i><span class="bzs-sr-only">复制群号</span></button>
      <span class="dot"></span>
      <button class="bzs-about-link" type="button" data-act="support">${HEART_SVG}<b>支持作者</b><span class="bzs-sr-only">看看支持作者的方式</span></button>
      <span class="dot"></span>
      <button class="bzs-about-link" type="button" data-act="changelog">${HISTORY_SVG}<b>更新日志</b><span class="bzs-sr-only">看看每一版改了什么</span></button>
    </div>`;
}
