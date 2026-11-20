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
  探索: 'Explore',
  插件: 'Plugins',
};

/**
 * 两列分栏：按每组的体量（行数）贪心装进当前更矮的一列。
 *
 * 以前写死「前五组左、其余右」，复习节奏/探索这些长卡片一多，左列就空出半屏。
 * 现在只保证「同组不拆」和「列内保持原顺序」，两列总高度尽量齐平；编号由
 * CSS 计数器按 DOM 顺序（左列到底、再右列）自动出，所以左列编号在前。
 * weights 缺省时按组数均分（纯测试与无 schema 场景用）。
 */
export function groupColumns(names: readonly string[], weights: readonly number[] = []): [string[], string[]] {
  const left: string[] = [];
  const right: string[] = [];
  let leftWeight = 0;
  let rightWeight = 0;
  names.forEach((name, i) => {
    const w = Math.max(1, Number(weights[i]) || 1);
    if (leftWeight <= rightWeight) {
      left.push(name);
      leftWeight += w;
    } else {
      right.push(name);
      rightWeight += w;
    }
  });
  return [left, right];
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
      <span class="bzs-brand-txt"><h3>Review</h3></span>
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

const READER_ICON_SVG =
  '<svg class="ic" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">' +
  '<path d="M12 6c-2.2-1.6-5-1.9-8-1.3v13c3-.6 5.8-.3 8 1.3 2.2-1.6 5-1.9 8-1.3v-13c-3-.6-5.8-.3-8 1.3Z"/><path d="M12 6v13"/></svg>';
const DOWNLOAD_SVG =
  '<svg class="ic" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">' +
  '<path d="M12 3v12m0 0 4-4m-4 4-4-4M4 19h16"/></svg>';

/**
 * 插件组 HTML（2026-11-20）：能力卡形态，直接下载 bz Reader。
 * 主按钮走 GitHub Release，卡底备注留码云备份——GitHub 连不上时兜底。
 */
export function pluginGroupHtml(mirrorUrl: string): string {
  return `<div class="bzs-setgrp wide bzs-plugin-grp">
      <h3 data-en="Plugins">插件</h3>
      <div class="bzs-cap is-on">
        <span class="bzs-capico">${READER_ICON_SVG}</span>
        <div class="bzs-capmain">
          <div class="bzs-cap-t"><b>bz Reader</b><span class="bzs-capchip">配套阅读器</span></div>
          <p>把库变成阅读器：桌面 + 手机、多种格式、AI 追问与全文问答、离线朗读、阅读统计，数据全留本地。</p>
          <div class="bzs-captags"><span class="bzs-tag">多格式</span><span class="bzs-tag">AI 问答</span><span class="bzs-tag">离线朗读</span></div>
          <div class="bzs-capfoot">
            <button class="bzs-btn sm pri" type="button" data-act="readerdownload">${DOWNLOAD_SVG}下载安装</button>
          </div>
        </div>
      </div>
      <div class="bzs-capnote">商城可直接搜索安装；这里下载 main.js / manifest.json / styles.css 三个文件放进插件目录。<a href="${esc(mirrorUrl)}" target="_blank" rel="noopener noreferrer">备用下载（码云）</a></div>
    </div>`;
}
