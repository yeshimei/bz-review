/**
 * Obsidian 自带设置里的 bz Review 页（src/settings-tab.ts）
 *
 * 只放一行按钮：真正的设置全在复习面板内置的「设置」页（review/ui/settings-page.ts）。
 * 2026-11-26 加回这层门牌：与 bz / bz Reader 同一形态，用户在「设置 → 第三方插件」
 * 里也能找到本插件；点了先收宿主设置 Modal（否则移动端焦点被它攥着、输入框失效），
 * 再按 Reader 有没有开内嵌复习页分流——开了就落在 Reader 书架的内嵌面板上，
 * 没开就开自己的独立面板。
 */
import { PluginSettingTab, Setting, type App, type Plugin } from 'obsidian';
import { afterHostSettingsClosed } from './core/ui/host-settings';
import { embeddedReviewRoute } from './review/reader-embed';
import { openSettingsFromHost } from './review/settings-entry';
import { ensureReview, uiManager } from './review';
import { t } from './i18n';

/** 宿主插件需要的最小面：只用来开面板 */
export interface SettingsEntryHost {
  app: App;
}

/** 执行壳：把模块级单例包成依赖，交给纯函数分流 */
export function openReviewSettingsFromHost(app: App): void {
  void openSettingsFromHost({
    route: embeddedReviewRoute(app),
    embeddedReady: () => !!uiManager?.embedActionsHost,
    openSettings: () => {
      ensureReview(app);
      void uiManager?.openSettings();
    },
    now: () => Date.now(),
    sleep: (ms) => new Promise<void>((resolve) => window.setTimeout(resolve, ms)),
  });
}

export class BzReviewSettingTab extends PluginSettingTab {
  private readonly host: Plugin & SettingsEntryHost;

  constructor(app: App, host: Plugin & SettingsEntryHost) {
    super(app, host);
    this.host = host;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName(t('settings.tab.open'))
      .setDesc(t('settings.tab.openDesc'))
      .addButton((btn) =>
        btn
          .setButtonText(t('settings.tab.open'))
          .setCta()
          .onClick(() =>
            afterHostSettingsClosed(this.app, containerEl, () => openReviewSettingsFromHost(this.app)),
          ),
      );
  }
}
