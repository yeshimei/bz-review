/**
 * 复习面板的 Obsidian 原生标签页（reviewPanelMode = native）
 *
 * 只做三件事：把面板壳挂进 contentEl、把「关闭」接到标签页自己身上、关窗时收场。
 * 面板 DOM 与事件全在 UIManager（ui.ts），这里不重复任何业务逻辑——所以两种
 * 打开方式的行为天然一致，不会出现「原生页里少了个按钮」这类分叉。
 */
import { ItemView, type WorkspaceLeaf } from 'obsidian';
import { ensureReview, uiManager } from './index';
import { t } from '../i18n';
import { markOwned } from '../core/scope';
import { REVIEW_VIEW_TYPE } from './panel-mode';

export class ReviewPanelView extends ItemView {
  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return REVIEW_VIEW_TYPE;
  }

  getDisplayText(): string {
    return t('复习计划', 'Review');
  }

  getIcon(): string {
    return 'calendar-check';
  }

  async onOpen(): Promise<void> {
    // 命令/ribbon 进来时已 ensure 过；直接开标签页（工作区恢复）时也要自己兜一次
    ensureReview(this.app);
    markOwned(this.contentEl);
    this.contentEl.addClass('bzrv-panel-host');
    uiManager?.mountInto(this.contentEl);
    /* 原生页里的 ✕ 与 ESC 都走 hideMain → 这里：关掉标签页本身。
       样式撑满由 styles.css 的 .bzrv-panel-in-view 接管。 */
    if (uiManager) {
      uiManager.onRequestClose = () => {
        void this.leaf.detach();
      };
    }
    await uiManager?.showMain();
  }

  async onClose(): Promise<void> {
    uiManager?.releaseView();
    this.contentEl.removeClass('bzrv-panel-host');
  }
}
