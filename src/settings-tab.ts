/**
 * 设置页（src/settings-tab.ts）
 *
 * 从 bz 的域设置面板收成一页：授权、数据、复习、AI 四组。
 * bz 里那套声明式设置面板（core/settings-schema）没搬——它要认识所有域的
 * 字段，一个独立插件背着它不划算。
 */
import { App, PluginSettingTab, Setting } from 'obsidian';
import type ReviewPlugin from './main';
import { GROUP_ID, PURCHASE_URL, licenseSummary } from './data/entitlement';
import { migrateFromBz } from './data/migrate';
import { t } from './i18n';

export class ReviewSettingTab extends PluginSettingTab {
  private readonly review: ReviewPlugin;

  constructor(app: App, plugin: ReviewPlugin) {
    super(app, plugin);
    this.review = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('bzr-settings');

    this.renderLicense(containerEl);
    this.renderData(containerEl);
    this.renderReview(containerEl);
    this.renderAI(containerEl);
  }

  private renderLicense(el: HTMLElement): void {
    el.createEl('h3', { text: t('授权', 'License') });
    const status = new Setting(el).setName(t('当前状态', 'Status')).setDesc(licenseSummary());
    status.settingEl.addClass('bzr-set-license');

    let draft = this.review.settings.licenseKey || '';
    new Setting(el)
      .setName(t('激活码', 'License key'))
      .setDesc(t('填高级版激活码，解锁不限数量。离线验签，不联网。', 'Paste a Pro key to lift the limits. Verified offline.'))
      .addText((txt) =>
        txt.setPlaceholder('BZP2.…').setValue(draft).onChange((v) => {
          draft = v.trim();
        }),
      )
      .addButton((btn) =>
        btn
          .setButtonText(t('激活', 'Activate'))
          .setCta()
          .onClick(async () => {
            const res = await this.review.activateLicense(draft);
            if (res.ok) status.setDesc(licenseSummary());
            const { notice } = await import('./core/notice');
            notice(res.message, res.ok ? 'success' : 'warning');
          }),
      );

    new Setting(el)
      .setName(t('购买高级版', 'Buy Pro'))
      .setDesc(PURCHASE_URL)
      .addButton((btn) =>
        btn.setButtonText(t('打开店铺', 'Open shop')).onClick(() => {
          window.open(PURCHASE_URL, '_blank');
        }),
      )
      .addButton((btn) =>
        btn.setButtonText(t('交流群', 'Group')).onClick(() => {
          window.open(`https://qm.qq.com/q/${GROUP_ID}`, '_blank');
        }),
      );
  }

  private renderData(el: HTMLElement): void {
    el.createEl('h3', { text: t('数据', 'Data') });
    new Setting(el)
      .setName(t('数据目录', 'Data folder'))
      .setDesc(
        t(
          '复习数据存在这个目录下的 review.json。默认 CONFIG/REVIEW，与 bz 的 CONFIG/STORAGE 分开。',
          'review.json lives here. Defaults to CONFIG/REVIEW, separate from bz.',
        ),
      )
      .addText((txt) =>
        txt
          .setPlaceholder('CONFIG/REVIEW')
          .setValue(this.review.settings.storagePath)
          .onChange(async (v) => {
            this.review.settings.storagePath = v.trim() || 'CONFIG/REVIEW';
            await this.review.saveSettings();
          }),
      );

    new Setting(el)
      .setName(t('从 bz 导入', 'Import from bz'))
      .setDesc(
        t(
          '把 bz 里已有的复习计划搬过来。只导一次，目标已有数据就不覆盖，bz 那边不动。',
          'Bring the existing plan over from bz. One shot; never overwrites, never touches bz.',
        ),
      )
      .addButton((btn) =>
        btn.setButtonText(t('导入', 'Import')).onClick(async () => {
          const res = await migrateFromBz(this.app, this.review.settings);
          const { notice } = await import('./core/notice');
          notice(res.message, res.ok ? 'success' : 'warning');
        }),
      );
  }

  private renderReview(el: HTMLElement): void {
    el.createEl('h3', { text: t('复习', 'Review') });
    const s = this.review.settings;

    new Setting(el)
      .setName(t('到期提醒', 'Due reminder'))
      .setDesc(t('有笔记到期待复习时自动提醒。', 'Remind me when notes are due.'))
      .addToggle((tg) =>
        tg.setValue(s.enableAutoNotify).onChange(async (v) => {
          s.enableAutoNotify = v;
          await this.review.saveSettings();
        }),
      );

    new Setting(el)
      .setName(t('新笔记加入提醒', 'Auto-add notice'))
      .setDesc(t('新笔记被自动加入时提示一句。', 'Tell me when a new note is auto-added.'))
      .addToggle((tg) =>
        tg.setValue(s.reviewAutoAddNotice).onChange(async (v) => {
          s.reviewAutoAddNotice = v;
          await this.review.saveSettings();
        }),
      );

    new Setting(el)
      .setName(t('每日上限', 'Daily limit'))
      .setDesc(t('一天最多复习多少条，0 = 不限。', 'Max items per day; 0 = unlimited.'))
      .addText((txt) =>
        txt
          .setValue(String(s.reviewDailyLimit))
          .onChange(async (v) => {
            s.reviewDailyLimit = Math.max(0, Number(v) || 0);
            await this.review.saveSettings();
          }),
      );

    new Setting(el)
      .setName(t('划线卡复习方式', 'Highlight card mode'))
      .setDesc(
        t(
          'AI 抽认卡 / AI 做题 / 展开全文。只影响划线卡，不影响笔记。',
          'Flashcard / quiz / plain text. Only affects highlight cards.',
        ),
      )
      .addDropdown((dd) =>
        dd
          .addOption('flashcard', t('AI 抽认卡', 'AI flashcard'))
          .addOption('quiz', t('AI 做题', 'AI quiz'))
          .addOption('plain', t('展开全文', 'Plain text'))
          .setValue(s.reviewCardMode)
          .onChange(async (v) => {
            s.reviewCardMode = v as typeof s.reviewCardMode;
            await this.review.saveSettings();
          }),
      );
  }

  private renderAI(el: HTMLElement): void {
    el.createEl('h3', { text: t('AI', 'AI') });
    const s = this.review.settings;

    new Setting(el)
      .setName(t('服务商', 'Provider'))
      .setDesc(t('抽认卡与做题要用。没有也能复习，只是不会有 AI 内容。', 'Used by flashcards and quizzes. Optional.'))
      .addDropdown((dd) =>
        dd
          .addOption('', t('不启用', 'Off'))
          .addOption('deepseek', 'DeepSeek')
          .addOption('zhipu-plan', '智谱 Plan')
          .addOption('ollama', 'Ollama')
          .addOption('custom', t('自定义', 'Custom'))
          .setValue(s.aiProvider || '')
          .onChange(async (v) => {
            s.aiProvider = v;
            await this.review.saveSettings();
          }),
      );

    new Setting(el)
      .setName(t('API Key', 'API key'))
      .setDesc(t('按所选服务商填；Ollama 本地服务通常不用填。', 'Depends on the provider; Ollama usually needs none.'))
      .addText((txt) =>
        txt
          .setPlaceholder('sk-…')
          .setValue(apiKeyOf(s))
          .onChange(async (v) => {
            setApiKeyOf(s, v.trim());
            await this.review.saveSettings();
          }),
      );
  }
}

function apiKeyOf(s: ReviewPlugin['settings']): string {
  if (s.aiProvider === 'zhipu-plan') return s.zhipuPlanApiKey;
  if (s.aiProvider === 'ollama') return s.ollamaApiKey;
  if (s.aiProvider === 'custom') return s.aiCustomApiKey;
  return s.deepseekApiKey;
}

function setApiKeyOf(s: ReviewPlugin['settings'], v: string): void {
  if (s.aiProvider === 'zhipu-plan') s.zhipuPlanApiKey = v;
  else if (s.aiProvider === 'ollama') s.ollamaApiKey = v;
  else if (s.aiProvider === 'custom') s.aiCustomApiKey = v;
  else s.deepseekApiKey = v;
}
