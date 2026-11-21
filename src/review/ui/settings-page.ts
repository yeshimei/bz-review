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
import { openExternalUrl, openVideoTutorial, REVIEW_REPO_URL } from './links-bridge';
import { isMobileEnv } from '../../core/mobile';
import { openHotkeySettings, readHotkeys } from '../../core/hotkeys';
import { enableReaderPlugin, installReaderPlugin, openReaderShelf, readReaderInstall, type ReaderInstallState } from '../../core/reader-install';
import { copyReviewGroupId } from './group-bridge';
import { aboutBarHtml, groupColumns, GROUP_SUBTITLES, GROUP_WEIGHTS, orderGroups, pluginGroupHtml, type ReaderPluginState } from './settings-page-pure';
import { setHtml } from './set-html';
import type { ReviewDataManager } from '../data';

/** 同一个容器可能被多次渲染；事件只绑一次，避免点一次激活处理两遍 */
const licenseBound = new WeakSet<HTMLElement>();

/**
 * 快捷键行（2026-11-21 照 bz Reader 重做）：
 * 显示每条命令**当前真实绑定**（用户在宿主里改过的也认），没绑就写「未设置」；
 * 点击打开 Obsidian 快捷键页并自动搜索这条命令。不再显示裸命令 ID。
 */
const HOTKEYS: Array<{ label: string; id: string }> = [
  { label: '打开复习面板', id: 'bz-review:review-open' },
  { label: '开始复习', id: 'bz-review:review-start' },
  { label: '把当前笔记加入复习', id: 'bz-review:review-add' },
  { label: '标记复习（评级）', id: 'bz-review:review-rate' },
];

function shortcutsHtml(app: App): string {
  const rows = readHotkeys(app, HOTKEYS)
    .map((r) => {
      const keys = r.keys.length
        ? `<span class="bzs-keylist">${r.keys.map((k) => `<kbd>${k}</kbd>`).join('')}</span>`
        : '<kbd class="is-empty">未设置</kbd>';
      return `<button class="bzs-keyrow" type="button" data-hotkey="${r.id}" data-hotkey-query="${r.label}"><span>${r.label}</span>${keys}<span class="bzs-sr-only">到 Obsidian 快捷键设置里改这条命令</span></button>`;
    })
    .join('');
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

/** 安装器状态 → 纯渲染零件只认的四个字段 */
function readerPluginStateOf(s: ReaderInstallState): ReaderPluginState {
  return { installed: s.installed, enabled: s.enabled, broken: s.broken, version: s.version };
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

  /* 磁盘只读一次：已装就显示「打开」，没装显示「安装」。读失败按未装处理，不拦设置页。 */
  let readerState: ReaderInstallState | null = null;
  try {
    readerState = await readReaderInstall(deps.app);
  } catch {
    readerState = null;
  }
  if (!container.isConnected) return;

  /* 分组顺序在渲染层统一：schema 的声明顺序留给别的消费者，界面只认 GROUP_ORDER。
     数据目录里的自动收编紧跟数据，实验功能沉到最后，编号读起来才是顺着走的。 */
  const schema = { ...reviewSettingsSchema(deps) };
  schema.groups = orderGroups(schema.groups);
  const stage = createDiv();
  renderSettingsInto(stage, schema);

  container.classList.add('bzs-set-page');
  container.replaceChildren();

  const license = getLicenseState();
  const about = createDiv();
  setHtml(about, aboutBarHtml(manifest.version, license.paid, license.name || ''));
  if (about.firstElementChild) container.appendChild(about.firstElementChild);
  if (!licenseBound.has(container)) {
    licenseBound.add(container);
    container.addEventListener('bz-review:license-changed', () => {
      if (!container.isConnected) return;
      const current = getLicenseState();
      const fresh = createDiv();
      setHtml(fresh, aboutBarHtml(manifest.version, current.paid, current.name || ''));
      const old = container.querySelector('.bzs-about');
      if (old && fresh.firstElementChild) old.replaceWith(fresh.firstElementChild);
    });
  }

  const grid = createDiv();
  grid.className = 'bzs-set-grid';
  /* 权重取真机实测高度：AI 组 24 行里大多按服务商显隐，按行数算会把左列架空 */
  const [leftNames, rightNames] = groupColumns(
    schema.groups.map((g) => g.name),
    schema.groups.map((g) => GROUP_WEIGHTS[g.name] ?? (g.rows?.length ?? 0) * 45 + 80),
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
  setHtml(
    pluginGrp,
    pluginGroupHtml(readerState ? readerPluginStateOf(readerState) : { installed: false, enabled: false, broken: false, version: '' })
  );
  if (pluginGrp.firstElementChild) container.appendChild(pluginGrp.firstElementChild);

  const keys = createDiv();
  setHtml(keys, shortcutsHtml(deps.app));
  if (keys.firstElementChild) container.appendChild(keys.firstElementChild);

  /* 动态显隐后重标两行式（renderSettingsInto 的 refresh 只在 stage 上跑，搬完要补一次） */
  markSettingSplitRows(container);

  /** 装完 / 已装：重画插件组，按钮在「安装 / 打开」之间切换 */
  const refreshPluginGroup = async (): Promise<void> => {
    if (!container.isConnected) return;
    try {
      const state = await readReaderInstall(deps.app);
      const fresh = createDiv();
      setHtml(fresh, pluginGroupHtml(readerPluginStateOf(state)));
      const old = container.querySelector('.bzs-plugin-grp');
      if (old && fresh.firstElementChild) old.replaceWith(fresh.firstElementChild);
    } catch {
      /* 重画失败不影响「已装好」这个事实 */
    }
  };

  /** 安装：按钮原地 loading，装完自动启用并打开书架上，不跳浏览器 */
  const runReaderInstall = (btn: HTMLButtonElement): void => {
    if (btn.dataset.busy === '1') return;
    if (isMobileEnv()) {
      notice('插件安装要在桌面端完成；手机上请到社区插件市场安装', 'info');
      return;
    }
    btn.dataset.busy = '1';
    btn.disabled = true;
    const label = btn.querySelector<HTMLElement>('.bzs-btn-label');
    const setStage = (text: string): void => {
      if (label) label.textContent = text;
    };
    setStage('准备…');
    void (async () => {
      try {
        const res = await installReaderPlugin(deps.app, { onStage: setStage });
        await refreshPluginGroup();
        notice(
          res.enabled
            ? `bz Reader v${res.version} 已安装并启用`
            : `bz Reader v${res.version} 已安装，请在第三方插件里手动启用`,
          res.enabled ? 'success' : 'warning'
        );
        if (!res.enabled) return;
        let tries = 0;
        const timer = window.setInterval(() => {
          if (openReaderShelf(deps.app)) {
            window.clearInterval(timer);
            return;
          }
          if (++tries >= 8) {
            window.clearInterval(timer);
            notice('已装好，到命令面板运行「bz Reader: 打开书架」', 'info');
          }
        }, 350);
      } catch (e) {
        btn.dataset.busy = '';
        btn.disabled = false;
        setStage('重试');
        notice(`安装失败：${e instanceof Error ? e.message : String(e)}`, 'warning');
      }
    })();
  };

  container.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    const act = target?.closest<HTMLElement>('[data-act]');
    if (act && container.contains(act)) {
      switch (act.dataset.act) {
        case 'aboutgithub':
          openExternalUrl(REVIEW_REPO_URL);
          return;
        case 'aboutvideo':
          openVideoTutorial();
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
        case 'readerinstall':
          runReaderInstall(act as HTMLButtonElement);
          return;
        case 'readeropen':
          if (!openReaderShelf(deps.app)) {
            notice('bz Reader 还没加载好，稍后到命令面板运行「打开书架」', 'info');
          }
          return;
        /* 已装未启用（2026-11-21）：空态引导过来的落点，点一下直接启用，不用再翻三方插件页 */
        case 'readerenable':
          void (async () => {
            const btn = act as HTMLButtonElement;
            if (btn.dataset.busy === '1') return;
            btn.dataset.busy = '1';
            btn.disabled = true;
            const ok = await enableReaderPlugin(deps.app);
            await refreshPluginGroup();
            notice(
              ok
                ? 'bz reader 已启用，回到空态再点「从 bz reader 加入复习」即可'
                : '没能自动启用：到第三方插件里把 bz reader 打开',
              ok ? 'success' : 'warning'
            );
          })();
          return;
      }
    }
    const key = target?.closest<HTMLElement>('[data-hotkey]');
    if (key && container.contains(key)) {
      openHotkeySettings(deps.app, key.dataset.hotkeyQuery || key.textContent || '');
    }
  });
}
