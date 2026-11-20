/* ============================================================
 * 复习设置页 · 1:1 内页布局（src/review/ui/settings-page.ts）
 *
 * 原型 prototypes/settings-page.html 的落地：
 *   .bzs-set-page > 关于条 + .bzs-set-grid(.bzs-set-col × 2) + 通栏快捷键。
 * 内容仍是 reviewSettingsSchema 的真实分组和设置行——只换壳，不碰绑定。
 * 关于条五个出口全部接真功能：外链 / 复制群号 / 支持作者 / 更新日志。
 * ============================================================ */
import type { App } from 'obsidian';
import manifest from '../../../manifest.json';
import { notice } from '../../core/notice';
import { getLicenseState } from '../../data/entitlement';
import { openExternalUrl, VIDEO_TUTORIAL_URL, REPO_URL, READER_DOWNLOAD_URL, READER_DOWNLOAD_MIRROR, openDownloadWithFallback } from './links-bridge';
import { copyReviewGroupId } from './group-bridge';
import { aboutBarHtml, groupColumns, GROUP_SUBTITLES, pluginGroupHtml } from './settings-page-pure';
import { setHtml } from './set-html';
import type { ReviewDataManager } from '../data';

/** 原型里那一段快捷键（命令 id 与 manifest / main.ts 对齐） */
const HOTKEYS: Array<[string, string]> = [
  ['开始复习', 'bz-review:start'],
  ['把当前笔记加入复习', 'bz-review:add'],
  ['打开复习面板', 'bz-review:open'],
  ['标记复习（评级）', 'bz-review:rate'],
];

function shortcutsHtml(): string {
  const rows = HOTKEYS.map(
    ([label, id]) =>
      `<button class="bzs-keyrow" type="button" data-hotkey="${id}"><span>${label}</span><kbd>${id}</kbd><span class="bzs-sr-only">到 Obsidian 快捷键设置里改这条命令</span></button>`,
  ).join('');
  return `<div class="bzs-setgrp wide"><h3 data-en="Shortcuts">快捷键</h3><div class="bzs-keys">${rows}</div></div>`;
}

/** 打开更新日志：弹窗与数据都按需加载，入口点击才付这 100KB 的代价 */
export async function openReviewChangelog(): Promise<void> {
  const [{ openChangelogNote }, { REVIEW_RELEASES }, { refreshBzrData }, { refreshPatrons }] = await Promise.all([
    import('./changelog-note'),
    import('./changelog-bridge'),
    import('./bzr-data'),
    import('./patrons'),
  ]);
  void refreshBzrData();
  void refreshPatrons();
  openChangelogNote(REVIEW_RELEASES, manifest.version);
}

/** 打开支持作者弹窗（reader 同款 DOM，名单在线拉） */
export async function openReviewSupportDialog(): Promise<void> {
  const { openSupportDialog } = await import('./support-dialog');
  openSupportDialog();
}

/**
 * 把真实设置 schema 渲染成原型骨架。
 * 先让 renderSettingsInto 在暂存容器里把 11 组行建好（绑定、显隐、徽标全保留），
 * 再按原型顺序搬进两列，最后把组头换成「序号 + 中文组名 + 英文副标」。
 */
export async function renderReviewSettingsPage(
  container: HTMLElement,
  deps: { app: App; dataManager: ReviewDataManager },
): Promise<void> {
  const [{ reviewSettingsSchema }, { renderSettingsInto }, { markSettingSplitRows }] = await Promise.all([
    import('../settings-schema'),
    import('../../core/settings-schema'),
    import('../../core/settings-split'),
  ]);
  if (!container.isConnected) return;

  const schema = reviewSettingsSchema(deps);
  const stage = createDiv();
  renderSettingsInto(stage, schema);

  container.classList.add('bzs-set-page');
  container.replaceChildren();

  const license = getLicenseState();
  const about = createDiv();
  setHtml(about, aboutBarHtml(manifest.version, license.paid, license.name || ''));
  if (about.firstElementChild) container.appendChild(about.firstElementChild);

  const grid = createDiv();
  grid.className = 'bzs-set-grid';
  /* 体量 ≈ 行数 + 组头/内边距那点固定高度；长组（复习节奏）不再把左列架空 */
  const [leftNames, rightNames] = groupColumns(
    schema.groups.map((g) => g.name),
    schema.groups.map((g) => (g.rows?.length ?? 0) + 2),
  );
  const cols = [leftNames, rightNames].map((names) => {
    const col = createDiv();
    col.className = 'bzs-set-col';
    grid.appendChild(col);
    return { col, names };
  });

  const groups = Array.from(stage.children) as HTMLElement[];
  groups.forEach((g, i) => {
    const name = schema.groups[i]?.name ?? '';
    g.classList.add('bzs-setgrp');
    /* 「去设置 AI」这类跳转的落点（2026-11-19）：按组名打标，openSettings(anchor)
       据此滚到对应卡片。组名是这里唯一的稳定标识，别另造一套 id。 */
    g.setAttribute('data-group', name);
    const head = g.querySelector<HTMLElement>('.bzrv-settings-group-head');
    if (head) {
      head.replaceChildren();
      const h3 = createEl('h3');
      h3.textContent = name;
      h3.setAttribute('data-en', GROUP_SUBTITLES[name] ?? '');
      head.appendChild(h3);
    }
    const target = cols.find((c) => c.names.includes(name))?.col ?? cols[0].col;
    target.appendChild(g);
  });
  container.appendChild(grid);

  /* 插件组（2026-11-20）：通栏，放到两列之下、快捷键之上 */
  const pluginGrp = createDiv();
  setHtml(pluginGrp, pluginGroupHtml());
  if (pluginGrp.firstElementChild) container.appendChild(pluginGrp.firstElementChild);

  const keys = createDiv();
  setHtml(keys, shortcutsHtml());
  if (keys.firstElementChild) container.appendChild(keys.firstElementChild);

  /* 动态显隐后重标两行式（renderSettingsInto 的 refresh 只在 stage 上跑，搬完要补一次） */
  markSettingSplitRows(container);

  container.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    const act = target?.closest<HTMLElement>('[data-act]');
    if (act && container.contains(act)) {
      switch (act.dataset.act) {
        case 'aboutgithub':
          openExternalUrl(REPO_URL);
          return;
        case 'aboutvideo':
          openExternalUrl(VIDEO_TUTORIAL_URL);
          return;
        case 'copygroup':
          void copyReviewGroupId();
          return;
        case 'support':
          void openReviewSupportDialog();
          return;
        case 'changelog':
          void openReviewChangelog();
          return;
        case 'readerdownload':
          void openDownloadWithFallback(READER_DOWNLOAD_URL, READER_DOWNLOAD_MIRROR);
          return;
      }
    }
    const key = target?.closest<HTMLElement>('[data-hotkey]');
    if (key && container.contains(key)) {
      const setting = (deps.app as unknown as { setting?: { openTabById?: (id: string) => void } }).setting;
      if (setting?.openTabById) setting.openTabById('hotkeys');
      else notice('到 Obsidian 设置 → 快捷键里改这条命令', 'info');
    }
  });
}
