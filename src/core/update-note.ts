/* ============================================================
 * Review · 更新提醒弹窗（core/update-note.ts）
 *
 * 与 bz Reader 的 shell/update-note 同一口径（2026-11-22）：
 *   · 只提醒，不自更新、不碰插件文件、不放下载链接；
 *   · 告诉用户去 Obsidian 的「设置 → 第三方插件 → 检查更新」；
 *   · 唯一按钮「忽略此版本」。
 *
 * 弹窗由 core/ui/modal 的 uiModal 打开（与其它弹窗同一套遮罩 / ESC /
 * 焦点接管）。弹层挂在 body 下，所以 mask / popup 都补 `data-bzrv` 锚点——
 * 样式构建会给每条选择器加 `:is([data-bzrv], [data-bzrv] *)`，没有这个
 * 属性就吃不到样式。
 *
 * 什么时候弹由 main.ts 决定（24 小时节流 + 每个新版本只弹一次）。
 * ============================================================ */
import { t } from '../i18n/strings';
import { escapeHtml } from './utils';
import { uiModal } from './ui/modal';

/** 弹窗正文。纯字符串，便于单测文案与转义 */
export function updateNoteHtml(current: string, latest: string): string {
  return `<div class="bzrv-upd" data-bzrv>
      <p class="bzrv-upd-ver"><b>v${escapeHtml(latest)}</b><span>${escapeHtml(
        t('update.current', { now: current }),
      )}</span></p>
      <p class="bzrv-upd-note">${escapeHtml(t('update.hint'))}</p>
      <p class="bzrv-upd-note">${escapeHtml(t('update.keep'))}</p>
      <div class="bzrv-upd-acts">
        <button class="bzrv-upd-btn" type="button" data-role="updignore">${escapeHtml(t('update.ignore'))}</button>
      </div>
    </div>`;
}

export interface UpdateNoteHandle {
  close: () => void;
}

/** 当前活着的那一个：重复触发都只留一层遮罩 */
let live: UpdateNoteHandle | null = null;

/**
 * 打开更新提醒。
 *
 * 弹之前 main.ts 已经写过 `notified`，所以任何关闭方式（按钮 / 遮罩 /
 * ESC）都不会让这一版再弹。
 */
export function openUpdateNote(current: string, latest: string): UpdateNoteHandle {
  live?.close();
  live = null;

  const modal = uiModal({
    content: updateNoteHtml(current, latest),
    className: 'bzrv-upd-dialog',
    title: t('update.title'),
    head: true,
    maxWidth: 400,
  });
  modal.mask.setAttribute('data-bzrv', '');
  modal.popup.setAttribute('data-bzrv', '');

  modal.popup.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    if (!target?.closest) return;
    if (target.closest('[data-role="updignore"]')) modal.close();
  });

  const handle: UpdateNoteHandle = {
    close: () => {
      modal.close();
      if (live === handle) live = null;
    },
  };
  live = handle;
  return handle;
}
