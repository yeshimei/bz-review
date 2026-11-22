/**
 * 复习设置 schema（自 src/review/ui.ts 拆出，ticket 131 声明式；ADR-0064）
 *
 * 检查提醒/做题家/复习节奏/记忆算法/自动化/界面 + 移动端六组卡片。
 * 做题家子项显隐（原 quizBox style.display）收敛为 visibleWhen 声明式联动；
 * 监听文件夹走通用 path 行（multi chips，落盘外部 binding 自管：新增先确认存量收编、
 * 移除连带清理排除记录）；排除名单走通用 list 行（chips 自绘 DOM 已退役）。
 * deps 仅在交互回调（custom/path onChange）经闭包引用，工厂构建无副作用。
 *
 * settings-panel 桌面侧栏经 reviewSettingsSchema 消费（入口契约保持自 review/ui re-export）。
 */
import type { App } from 'obsidian';
import { Setting } from 'obsidian';
import { notice } from '../core/notice';
import { pickFolderNative } from '../core/folder-pick';
import { setHtml } from './ui/set-html';
import { attachHelpTip } from '../core/ui/help-tip';
import { withSrText } from '../core/ui/sr-text';
import { DEFAULT_ACCENT, applyAccent } from '../settings';
import { LOCALES, LOCALE_NAMES, hostLanguageCode, isLocale, resolveLocale, setLocale, t, type LanguagePref, type MsgKey } from '../i18n';

import { openFlowDialog } from '../core/flow-dialog';
import { DEFAULT_REVIEW_DIR } from '../core/storage-dir';
import { getSettings, requestSettingsPanel, saveSettings } from '../core/settings-provider';
import type { SettingsSchema, SettingsRow } from '../core/settings-schema';
import {
  AI_PROVIDER_REGISTRY,
  DEFAULT_AI_PROVIDER,
  getProviderDescriptor,
  maxOutputCapOf,
  resetAIProviderCache,
  testAIConnectivity,
  thinkingLevelsOf,
  providerLabelOf,
  providerKeyLabelOf,
  providerKeyDescOf,
} from '../core/ai';
import { resolveProviderId } from '../core/ai-provider-id';
import { fetchProviderModels, providerDescriptorOf } from '../core/ai-models';
import { openModelPicker } from '../core/settings-model-picker';
import { tryGetSettings } from '../core/settings-provider';
import type { ReviewDataManager } from './data';
import {
  FREE_ITEM_LIMIT,
  activateLicense,
  isPaid,
  getLicenseState,
  licenseRevoked,
  currentLicenseCode,
} from '../data/entitlement';
import { refreshRevoked } from '../data/revoked';
import { copyReviewData, importFromBzWithConfirm } from '../data/migrate';
import { isBzPluginEnabled } from '../core/plugin-path';
import { panelModeOf } from './panel-mode';
import { openBackupHistoryDialog, restoreLatestWithConfirm } from './backup-history-dialog';

/**
 * 激活码输入框的草稿：输入只改这里，不碰 settings、不触发通用 text 行的
 * 800ms 防抖落盘。只有点「激活」验签通过才写回 settings.licenseKey；
 * 失败恢复成当前生效码——输错一次不该把真码冲掉。
 */
let licenseDraft = '';

/** 数据目录选择钮上的文件夹图标（与 bz Reader 的 pickdir 同一口径） */
const FOLDER_SVG =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">' +
  '<path d="M3.5 7.5h6l1.8 2h9.2v8.5a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2v-10.5Z"/></svg>';

/* ── AI 设置：照 bz 主仓的 18 家注册表驱动（不再硬编码 5 家） ── */

type OverrideMapKey = 'aiModelOverrides' | 'aiMaxTokensOverrides';

function currentProviderId(): string {
  const s = tryGetSettings() as { aiProvider?: string } | null;
  // 空串 = 用户主动「不启用」；不能再被 || 兜底成缺省服务商（同 core/ai-provider-id 口径）
  return resolveProviderId(s?.aiProvider);
}

function providerValue(kind: 'model' | 'maxTokens'): string {
  const id = currentProviderId();
  const s = tryGetSettings() as unknown as Record<string, Record<string, unknown> | undefined>;
  const mapKey: OverrideMapKey = kind === 'model' ? 'aiModelOverrides' : 'aiMaxTokensOverrides';
  const over = s?.[mapKey]?.[id];
  if (typeof over === 'string' && over !== '') return over;
  if (typeof over === 'number' && Number.isFinite(over)) return String(over);
  const d = getProviderDescriptor(id);
  if (kind === 'model') return d.model || '';
  const cap = maxOutputCapOf(id, undefined);
  return String(cap ?? d.defaultMaxTokens);
}

function providerMaxOutputCap(): number | undefined {
  const id = currentProviderId();
  const s = tryGetSettings() as unknown as { aiModelOverrides?: Record<string, string> } | null;
  const over = s?.aiModelOverrides?.[id] || undefined;
  return maxOutputCapOf(id, over);
}

function providerThinkingValue(): string {
  const id = currentProviderId();
  const s = tryGetSettings() as unknown as { aiThinkingOverrides?: Record<string, string> } | null;
  const v = String(s?.aiThinkingOverrides?.[id] ?? '');
  return thinkingLevelsOf(id).some((l) => l.value === v) ? v : 'auto';
}

function setProviderThinkingValue(v: string): void {
  const id = currentProviderId();
  const s = tryGetSettings() as unknown as { aiThinkingOverrides?: Record<string, string> } | null;
  if (!s) return;
  if (!s.aiThinkingOverrides || typeof s.aiThinkingOverrides !== 'object') s.aiThinkingOverrides = {};
  const map = s.aiThinkingOverrides;
  if (v === 'auto' || v === '') delete map[id];
  else map[id] = v;
  void saveSettings();
}

function setProviderValue(mapKey: OverrideMapKey, raw: string): void {
  const id = currentProviderId();
  const s = tryGetSettings() as unknown as Record<string, Record<string, unknown> | undefined> | null;
  if (!s) return;
  const v = raw.trim();
  if (!s[mapKey] || typeof s[mapKey] !== 'object') s[mapKey] = {};
  const map = s[mapKey];
  if (v === '' || v === '0') delete map[id];
  else map[id] = mapKey === 'aiModelOverrides' ? v : Number(v);
  void saveSettings();
}

function providerModelRow(): SettingsRow {
  return {
    type: 'text',
    name: t('settings.ai.model'),
    desc: t('settings.ai.modelDesc'),
    help: t('settings.ai.modelHelp'),
    placeholder: t('settings.ai.modelPlaceholder'),
    binding: {
      get: () => providerValue('model'),
      set: (v) => setProviderValue('aiModelOverrides', v),
      save: () => {},
    },
    refreshKey: () => providerValue('model'),
    actions: [
      {
        text: t('settings.ai.fetchModels'),
        onClick: async (_value, ctx) => {
          try {
            await saveSettings();
            const providerId = currentProviderId();
            const desc = providerDescriptorOf(providerId);
            const models = await fetchProviderModels(providerId);
            if (currentProviderId() !== providerId) {
              notice(t('settings.ai.providerChanged'), 'warning');
              return;
            }
            await new Promise<void>((resolve) => {
              openModelPicker({
                providerLabel: providerLabelOf(desc),
                current: providerValue('model'),
                models,
                onPick: (m) => {
                  setProviderValue('aiModelOverrides', m.id);
                  ctx.refreshVisibility();
                  notice(t('settings.ai.modelSet', { model: m.id }), 'success');
                },
                onClose: () => resolve(),
              });
            });
          } catch (e) {
            notice(e instanceof Error ? e.message : String(e), 'error');
          }
        },
      },
    ],
  };
}

function providerMaxTokensRow(): SettingsRow {
  return {
    type: 'number',
    name: t('settings.ai.maxTokens'),
    desc: t('settings.ai.maxTokensDesc'),
    help: t('settings.ai.maxTokensHelp'),
    min: 0,
    max: () => providerMaxOutputCap(),
    binding: {
      get: () => {
        const n = Number(providerValue('maxTokens'));
        return Number.isFinite(n) ? n : 0;
      },
      set: (v: number) => setProviderValue('aiMaxTokensOverrides', String(v)),
      save: () => saveSettings(),
    },
    refreshKey: () => providerValue('maxTokens'),
    placeholder: t('settings.ai.maxTokensPlaceholder'),
  };
}

function providerThinkingRow(): SettingsRow {
  return {
    type: 'select',
    name: t('settings.ai.thinking'),
    desc: t('settings.ai.thinkingDesc'),
    help: t('settings.ai.thinkingHelp'),
    binding: {
      get: () => providerThinkingValue(),
      set: (v) => setProviderThinkingValue(v),
      save: () => {},
    },
    options: (snap) =>
      thinkingLevelsOf(String((snap as { aiProvider?: string }).aiProvider || DEFAULT_AI_PROVIDER)).map((l) => ({
        value: l.value,
        /* 档位名按当前语言出词：注册表里的 label 是中文基准，labelKey 才是界面真源 */
        label: l.labelKey ? t(l.labelKey as MsgKey) : l.label,
      })),
    visibleWhen: (snap) =>
      thinkingLevelsOf(String((snap as { aiProvider?: string }).aiProvider || DEFAULT_AI_PROVIDER)).length > 0,
    refreshKey: () => providerThinkingValue(),
  };
}

/** 18 家注册表 + 模型配置，整套照 bz 的 LLM 组 */
export function reviewLlmRows(): SettingsRow[] {
  const rows: SettingsRow[] = [
    {
      type: 'select',
      name: t('settings.ai.provider'),
      desc: t('settings.ai.providerDesc'),
      binding: { key: 'aiProvider' },
      options: AI_PROVIDER_REGISTRY.map((p) => ({ value: p.id, label: providerLabelOf(p) })),
    },
    {
      type: 'text',
      name: t('settings.ai.customEndpoint'),
      desc: t('settings.ai.customEndpointDesc'),
      binding: { key: 'aiCustomEndpoint' },
      placeholder: 'https://api.example.com/v1',
      inputMode: 'url',
      visibleWhen: (snapshot) => snapshot.aiProvider === 'custom',
    },
    {
      type: 'select',
      name: t('settings.ai.customProtocol'),
      desc: t('settings.ai.customProtocolDesc'),
      binding: { key: 'aiCustomProtocol' },
      options: [
        { value: 'openai', label: t('settings.ai.protocolOpenai') },
        { value: 'anthropic', label: 'Anthropic（Claude）' },
      ],
      visibleWhen: (snapshot) => snapshot.aiProvider === 'custom',
    },
  ];
  for (const p of AI_PROVIDER_REGISTRY) {
    rows.push({
      type: 'secret',
      name: providerKeyLabelOf(p),
      desc: providerKeyDescOf(p),
      binding: p.apiKeyKey
        ? { key: p.apiKeyKey as never }
        : {
            get: () => String((tryGetSettings() as unknown as { aiApiKeys?: Record<string, string> })?.aiApiKeys?.[p.id] ?? ''),
            set: (v: string) => {
              const s = tryGetSettings() as unknown as { aiApiKeys?: Record<string, string> } | null;
              if (!s) return;
              if (!s.aiApiKeys || typeof s.aiApiKeys !== 'object') s.aiApiKeys = {};
              const trimmed = String(v ?? '');
              if (trimmed) s.aiApiKeys[p.id] = trimmed;
              else delete s.aiApiKeys[p.id];
              void saveSettings();
            },
            save: () => {},
          },
      placeholder: t('settings.ai.pasteKey'),
      visibleWhen: (snapshot) => snapshot.aiProvider === p.id,
      actions: [
        {
          text: t('settings.ai.test'),
          stateful: true,
          onClick: async () => {
            await saveSettings();
            await testAIConnectivity(p.id);
          },
        },
      ],
    });
  }
  rows.push(providerModelRow(), providerMaxTokensRow(), providerThinkingRow());
  /* 共享 bz Reader 的配置（2026-11-19）：放在最后，读完上面那一堆再看它——
     它的语义是「上面都空着时去哪儿找」，不是又一个服务商选项。 */
  rows.push({
    type: 'toggle',
    name: t('settings.ai.shareReader'),
    desc: t('settings.ai.shareReaderDesc'),
    binding: { key: 'aiShareReader' },
    onChange: () => {
      /* 配置源变了：清掉解析缓存，下一次调用按新开关重新决定借不借 */
      resetAIProviderCache();
    },
  });
  return rows;
}

export function reviewSettingsSchema(deps: { app: App; dataManager: ReviewDataManager }): SettingsSchema {
  // enableAutoNotify 常驻轮询在 main.ts onload 注册、运行时按设置实时读值（app.ts checkOverdueAndNotify
  // 门控），设置弹窗 toggle 只需落盘，渲染器键直绑自动完成，无需额外副作用回调。
  /** 数据目录迁移：上一次已生效的目录（取消迁移时回退到这里） */
  let lastDir = String((getSettings()).storagePath || DEFAULT_REVIEW_DIR);

  /**
   * 数据目录切换：确认后复制、不移动；取消或失败都回退旧目录，返回最终生效路径。
   * 从原来的 path 行 onCommit 抽出来——换成 Reader 那种「路径 + 选择」按钮后，
   * 同一套迁移逻辑要由按钮回调复用，不能在两处各写一遍。
   */
  const migrateStorageDir = async (raw: string): Promise<string> => {
    const next = String(raw || '').trim().replace(/^\/+|\/+$/g, '');
    const prev = lastDir;
    if (!next || next === prev) return prev;
    const ok = await openFlowDialog({
      title: t('settings.data.migrateTitle'),
      message: t('settings.data.migrateBody', { prev, next }),
      actions: [
        { label: t('common.cancel'), value: 'cancel' },
        { label: t('settings.data.migrateConfirm'), value: 'ok', cta: true },
      ],
    });
    if (ok !== 'ok') {
      notice(t('settings.data.cancelled'), 'info');
      return prev;
    }
    try {
      const { copied, kept } = await copyReviewData(deps.app, prev, next);
      lastDir = next;
      /* 原来 path 行的 binding 会把 onChange 返回值写回 settings 并落盘；
         换成自绘按钮后这一步得自己来——只 paint 按钮不写盘会在下次启动跳回旧目录。 */
      getSettings().storagePath = next;
      await saveSettings();
      if (copied.length) {
        notice(t('settings.data.migrated', { next, copied: copied.length }), 'success');
      } else if (kept.length) {
        notice(t('settings.data.kept', { next, prev }), 'warning');
      } else {
        notice(t('settings.data.switched', { next }), 'info');
      }
      return next;
    } catch {
      notice(t('settings.data.failed', { prev }), 'warning');
      return prev;
    }
  };

  const ACCENT_NAME = t('settings.ui.accent');
  const ACCENT_DESC = t('settings.ui.accentDesc');
  const ACCENT_HELP = t('settings.ui.accentHelp');
  return {
    groups: [
      /* 授权 / 数据 / AI 三组原先只在原生设置页（settings-tab.ts）里。2026-11-13 用户拍板：
         设置不写在原生设置页，全部搬进主界面的 ⚙️ ——与 bz Reader 同形制，一个插件只有
         一处设置。原生设置页据此下线，这里必须把它那三组补齐，否则等于删了功能。 */
      {
        icon: 'key-round',
        name: '授权',
        rows: [
          {
            /* 2026-11-21：按 bz Reader 的授权组布局排——三行标准设置行，
               标签在左、控件在右；购买 / 交流群收进「高级版功能」弹窗底部，
               不再往状态行塞两颗按钮。 */
            type: 'custom',
            name: t('settings.license.state'),
            render: (body) => {
              const setting = new Setting(body).setName(t('settings.license.state'));
              /* Reader 的状态行只有「基础版 / 高级版」这么短；把长句收进弹窗和激活提示，
                 右栏只留一句能一眼读完的状态，避免在窄控制区里折行被裁。 */
              const state = setting.controlEl.createSpan({ cls: 'bzrv-license-state' });
              const paint = (): void => {
                state.textContent = isPaid() ? t('settings.license.proState') : t('settings.license.baseState', { n: FREE_ITEM_LIMIT });
                state.classList.toggle('is-paid', isPaid());
              };
              paint();
              /* 授权变化用事件通知，**监听挂 document 而不是本行容器**：
                 「激活」「核对」两颗按钮在兄弟行上，事件从它们那儿冒泡只会
                 经过共同祖先，本行自己的 body 永远收不到。挂 document 能收，
                 并在本行被销毁时自摘，不留监听器。 */
              const onLicenseChanged = (): void => {
                if (!body.isConnected) {
                  document.removeEventListener('bz-review:license-changed', onLicenseChanged);
                  return;
                }
                paint();
              };
              document.addEventListener('bz-review:license-changed', onLicenseChanged);
            },
          },
          {
            type: 'custom',
            name: t('settings.license.code'),
            render: (body) => {
              const setting = new Setting(body).setName(t('settings.license.code'));
              const wrap = setting.controlEl.createDiv({ cls: 'bzrv-license-code' });
              const input = wrap.createEl('input', {
                type: 'text',
                cls: 'bzrv-license-input',
                placeholder: t('settings.license.placeholder'),
              });
              const btn = wrap.createEl('button', {
                cls: 'bzrv-btn bzrv-btn--primary',
                text: t('settings.license.activate'),
                type: 'button',
              });
              /* paid + 未点「重新激活」时输入框只读，避免手滑改掉生效码；
                 点一次「重新激活」才放开编辑。 */
              let relicense = false;
              const paint = (): void => {
                const paid = isPaid();
                const locked = paid && !relicense;
                input.readOnly = locked;
                /* 停用的码也要填进输入框：用户总得看见被停的是哪一枚。
                   草稿优先；没有草稿时，未解锁就回显当前码（含停用那枚）。 */
                input.value = locked ? currentLicenseCode() : licenseDraft || (paid ? '' : currentLicenseCode());
                btn.setText(locked ? t('settings.license.reactivate') : t('settings.license.activate'));
                wrap.classList.toggle('is-paid', locked);
              };
              input.addEventListener('input', () => {
                licenseDraft = input.value;
              });
              btn.addEventListener('click', () => {
                void (async () => {
                  if (isPaid() && !relicense) {
                    relicense = true;
                    licenseDraft = '';
                    paint();
                    input.focus();
                    return;
                  }
                  /* 读输入框本身，不读草稿变量：停用后框里回显着那枚码，
                     而草稿是空的——用户看着码在框里、点激活却说「先填」，
                     这种自相矛盾比报错更让人犯迷糊。 */
                  const code = input.value.trim();
                  if (!code) {
                    notice(t('settings.license.needCode'), 'info');
                    input.focus();
                    return;
                  }
                  btn.disabled = true;
                  /* activateLicense 而不是 refreshLicense：首次激活要联网核对
                     停用名单（2026-11-22）。失败不碰当前授权，也不写盘。 */
                  const res = await activateLicense(code);
                  btn.disabled = false;
                  if (res.ok) {
                    const state = getLicenseState();
                    licenseDraft = '';
                    relicense = false;
                    getSettings().licenseKey = code;
                    await saveSettings();
                    paint();
                    setting.settingEl.dispatchEvent(
                      new Event('bz-review:license-changed', { bubbles: true })
                    );
                    notice(
                      (state.name ? t('notice.license.activatedName', { name: state.name }) : t('notice.license.activated')) + t('notice.license.unlimitedNote'),
                      'success'
                    );
                    return;
                  }
                  /* 失败：授权状态和落盘码都没被这枚错码碰过，输入框回显生效码。
                     提示用 res.message——「码无效」「已停用」「需要联网」是三件
                     不同的事，不该都压成一句「无效」。 */
                  licenseDraft = '';
                  paint();
                  notice(res.message, res.revoked ? 'error' : 'warning');
                })();
              });
              paint();
            },
          },
          {
            /* 和 bz Reader 一样，授权组里给一颗「看看包含什么」的入口。
               弹窗按需加载，只有点开才付那一份 DOM/CSS 的代价。 */
            type: 'button',
            name: t('settings.license.features'),
            desc: t('settings.license.featuresDesc'),
            buttonText: t('common.view'),
            onClick: () => {
              void import('./ui/unlock-dialog').then((m) => m.openReviewUnlockDialog());
            },
          },
          {
            /* 停用名单的手动核对（2026-11-22）：自动核对每天只跑一次，想立刻
               看到封 / 解封结果就点它。没有码时整行不显示——没东西可核对。 */
            type: 'button',
            name: t('settings.license.recheck'),
            desc: t('settings.license.recheckDesc'),
            buttonText: t('settings.license.recheckBtn'),
            visibleWhen: (s) => !!s.licenseKey,
            onClick: (ctx) => {
              void (async () => {
                const code = currentLicenseCode();
                if (!code) {
                  notice(t('settings.license.needCode'), 'info');
                  return;
                }
                const verdict = await refreshRevoked(code, { force: true });
                if (verdict === 'hit') {
                  notice(t('notice.license.revoked'), 'error');
                } else if (verdict === 'clear') {
                  notice(t('notice.license.rechecked'), 'success');
                } else {
                  notice(t('notice.license.recheckFailed'), 'error');
                }
                /* 结论可能刚把授权从高级版翻成基础版（或反过来）：让状态行
                   与「高级版功能」徽章一起重绘。 */
                ctx.rowEl.dispatchEvent(new Event('bz-review:license-changed', { bubbles: true }));
              })();
            },
          },
        ],
      },
      {
        icon: 'database',
        name: '数据',
        rows: [
          {
            /* 2026-11-20：目录行跟 bz Reader 同形——只一颗「路径 / 选择」按钮。
               不摆 chips / ✕ / 手输框：vault 路径有口径，手打错了还不报错，文件写到别处。 */
            type: 'custom',
            name: t('settings.data.dir'),
            desc: t('settings.data.dirDesc'),
            render: (body) => {
              const setting = new Setting(body)
                .setName(t('settings.data.dir'))
                .setDesc(t('settings.data.dirDesc'));
              setting.settingEl.classList.add('bzrv-pickdir-row');
              const btn = createEl('button');
              btn.type = 'button';
              btn.className = 'bzs-pickdir';
              btn.appendChild(
                Object.assign(createSpan(), {
                  className: 'bzs-sr-only',
                  textContent: t('settings.data.pickSr'),
                }),
              );
              const pathEl = createSpan();
              pathEl.className = 'bzs-pickdir-path';
              const ico = createSpan();
              ico.className = 'bzs-pickdir-ico';
              setHtml(ico, FOLDER_SVG);
              btn.append(pathEl, ico, createEl('i', { text: t('common.choose') }));
              const current = (): string => String(getSettings().storagePath || DEFAULT_REVIEW_DIR);
              const paint = (dir: string): void => {
                pathEl.textContent = `${dir}/`;
              };
              paint(current());
              btn.addEventListener('click', () => {
                void pickFolderNative(deps.app, {
                  title: t('settings.data.pickTitle'),
                  mode: 'single',
                  selected: [current()],
                }).then(async (list) => {
                  const picked = String(list[0] || '').trim();
                  if (!picked) {
                    notice(t('settings.data.rootRejected'), 'warning');
                    return;
                  }
                  paint(await migrateStorageDir(picked));
                });
              });
              setting.controlEl.appendChild(btn);
            },
          },
          {
            /* 只有 bz 真的装了并加载了才显示——没装却摆一颗按钮，点了只能得到
               「没找到数据」，用户会以为插件坏了。 */
            type: 'button',
            name: t('settings.data.importBz'),
            desc: t('settings.data.importBzDesc'),
            buttonText: t('settings.data.import'),
            visibleWhen: () => isBzPluginEnabled(deps.app),
            onClick: () => {
              void importFromBzWithConfirm(deps.app, getSettings());
            },
          },
          {
            /* 快照是最后一道保险：合并写错、同步出事、手滑清空，都能从这里退回去。
               备份/回滚都走二次确认；回滚前先给当前数据留一份，所以「回滚」本身也能反悔。 */
            type: 'info',
            name: t('settings.data.backup'),
            desc: t('settings.data.backupDesc'),
            actions: [
              {
                text: t('settings.data.backup'),
                onClick: () => openBackupHistoryDialog(deps.app),
              },
              {
                text: t('settings.data.rollbackLatest'),
                onClick: () => restoreLatestWithConfirm(deps.app),
              },
            ],
          },
        ],
      },
      {
        icon: 'layout-panel-left',
        name: '界面',
        rows: [
          {
            /* 界面语言（2026-11-21）：放最前——它是「其他设置长什么样」的前提。
               照 bz Reader 的口径：语言名用**自称**（中文 / English），这三条不走
               t()，必须与当前界面语言无关；auto = 跟随 Obsidian。切换后整页重开，
               否则只有这一行跟着变、别行还是旧语言。命令名要重启才更新，提示写清楚。 */
            type: 'custom',
            name: t('settings.language'),
            desc: t('settings.language.desc'),
            help: t('settings.language.hint'),
            render: (body: HTMLElement) => {
              const setting = new Setting(body).setName(t('settings.language')).setDesc(t('settings.language.desc'));
              setting.settingEl.classList.add('bzrv-accent-row');
              const nameEl = (setting as unknown as { nameEl?: HTMLElement }).nameEl;
              if (nameEl) attachHelpTip(nameEl, { text: t('settings.language.hint') });
              const prefs: Array<{ value: string; label: string }> = [
                { value: 'auto', label: t('settings.language.auto') },
                ...LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l] })),
              ];
              const seg = createDiv();
              seg.className = 'bzrv-segmented bzrv-accent-seg';
              seg.setAttribute('role', 'radiogroup');
              withSrText(seg, t('settings.language'));
              const btns: HTMLButtonElement[] = [];
              const current = (): string => {
                const v = String(getSettings().language || 'auto');
                return v === 'auto' || isLocale(v) ? v : 'auto';
              };
              const paint = (): void => {
                const cur = current();
                for (const b of btns) {
                  const on = b.dataset.value === cur;
                  b.classList.toggle('is-on', on);
                  b.setAttribute('aria-checked', String(on));
                }
              };
              for (const m of prefs) {
                const btn = createEl('button');
                btn.type = 'button';
                btn.className = 'bzrv-segmented-btn';
                btn.dataset.value = m.value;
                btn.setAttribute('role', 'radio');
                btn.setAttribute('aria-checked', 'false');
                btn.appendChild(document.createTextNode(m.label));
                btn.addEventListener('click', () => {
                  const next: LanguagePref = isLocale(m.value) ? m.value : 'auto';
                  getSettings().language = next;
                  void saveSettings();
                  const changed = setLocale(resolveLocale(next, hostLanguageCode()));
                  /* 整页重开：设置页每行文案都是渲染时取的，只重画这一行不够。 */
                  requestSettingsPanel(undefined, '界面');
                  if (changed) notice(t('notice.language.changed'));
                });
                btns.push(btn);
                seg.appendChild(btn);
              }
              setting.controlEl.appendChild(seg);
              paint();
            },
          },
          {
            /* 强调色：4 档分段 + 彩色圆点，自绘插槽（core 渲染器对 custom 行只建包装容器，
               名称/说明需自己用 Setting 渲出来）。切换即写内存 + 落盘 + 改 body 属性实时生效。 */
            type: 'custom',
            name: ACCENT_NAME,
            desc: ACCENT_DESC,
            help: ACCENT_HELP,
            render: (body: HTMLElement) => {
              const setting = new Setting(body).setName(ACCENT_NAME).setDesc(ACCENT_DESC);
              /* 整行让标签独占一行、控件吃满整宽（同 Reader 的 is-stack）：4 档横排
                 在右列 ~340px 里会把「跟随 Obsidian」挤破卡片右缘（2026-11-20 真机反馈）。 */
              setting.settingEl.classList.add('bzrv-accent-row');
              const nameEl = (setting as unknown as { nameEl?: HTMLElement }).nameEl;
              if (nameEl) attachHelpTip(nameEl, { text: ACCENT_HELP });
              const modes = [
                { value: 'auto', label: t('settings.ui.accentAuto') },
                { value: 'copper', label: t('settings.ui.accentCopper') },
                { value: 'indigo', label: t('settings.ui.accentIndigo') },
                { value: 'moss', label: t('settings.ui.accentMoss') },
              ] as const;
              const seg = createDiv();
              seg.className = 'bzrv-segmented bzrv-accent-seg';
              seg.setAttribute('role', 'radiogroup');
              withSrText(seg, ACCENT_NAME);
              const btns: HTMLButtonElement[] = [];
              const current = (): string => {
                const v = String((getSettings()).accent || DEFAULT_ACCENT);
                return modes.some((m) => m.value === v) ? v : DEFAULT_ACCENT;
              };
              const paint = (): void => {
                const cur = current();
                for (const b of btns) {
                  const on = b.dataset.value === cur;
                  b.classList.toggle('is-on', on);
                  b.setAttribute('aria-checked', String(on));
                }
              };
              for (const m of modes) {
                const btn = createEl('button');
                btn.type = 'button';
                btn.className = 'bzrv-segmented-btn';
                btn.dataset.value = m.value;
                btn.setAttribute('role', 'radio');
                btn.setAttribute('aria-checked', 'false');
                const dot = createSpan();
                dot.className = 'bzrv-choice-dot bzrv-accent-dot';
                dot.dataset.acc = m.value;
                btn.appendChild(dot);
                btn.appendChild(document.createTextNode(m.label));
                btn.addEventListener('click', () => {
                  (getSettings()).accent = m.value;
                  applyAccent(m.value);
                  void saveSettings();
                  paint();
                  notice(t('settings.ui.accentChanged', { label: m.label }));
                });
                btns.push(btn);
                seg.appendChild(btn);
              }
              setting.controlEl.appendChild(seg);
              paint();
            },
          },
          {
            type: 'select',
            name: t('settings.ui.openMode'),
            desc: t('settings.ui.openModeDesc'),
            help: t('settings.ui.openModeHelp'),
            binding: {
              get: () => panelModeOf(getSettings()),
              set: (v: string) => {
                (getSettings()).reviewPanelMode = v === 'popup' ? 'popup' : 'native';
              },
              save: () => saveSettings(),
            },
            options: [
              { value: 'native', label: t('settings.ui.openNative') },
              { value: 'popup', label: t('settings.ui.openPopup') },
            ],
          },
          {
            type: 'toggle', name: t('settings.ui.treeBadge'), desc: t('settings.ui.treeBadgeDesc'),
            help: t('settings.ui.treeBadgeHelp'),
            binding: { key: 'reviewTreeBadge' },
          },
        ],
      },
      {
        icon: 'bell',
        name: '检查提醒',
        rows: [
          { type: 'toggle', name: t('settings.remind.auto'), desc: t('settings.remind.autoDesc'), binding: { key: 'enableAutoNotify' } },
        ],
      },
      {
        /* 划线卡（2026-11-11）：一条划线就是一张卡，复习时不开任何文件。
           方式由复习这边定：AI 抽认卡（问句当提示面）、AI 做题
           （四选一，每轮抽三分之一）。填空 / 上下文 / 展开全文的代码与老卡行为
           全部保留，但 2026-11-20 起界面不再提供这三种新入口。 */
        icon: 'layers',
        name: '划线卡',
        rows: [
          {
            /* 2026-11-15 用户拍板：复习方式不再是「全局一个开关」——它在制卡那一刻
               定下来、存在卡上，每张卡各走各的。设置里只留「新卡默认用哪种」，
               默认「手动」= 每次加卡都问一句（选择框还能勾「以后别问」）。 */
            type: 'select',
            name: t('settings.cards.defaultMethod'),
            desc: t('settings.cards.defaultMethodDesc'),
            help: t('settings.cards.defaultMethodHelp'),
            binding: {
              get: () => String((getSettings()).reviewCardDefaultMethod || 'manual'),
              set: (v: string) => {
                (getSettings()).reviewCardDefaultMethod =
                  v === 'quiz' || v === 'plain' || v === 'cloze' || v === 'context' || v === 'flashcard'
                    ? v
                    : 'manual';
              },
              save: () => saveSettings(),
            },
            /* 2026-11-20 挖空（Cloze）解锁为可选项；上下文 / 展开全文仍不提供新入口，
               但上面 set 校验的合法值仍保留这两种，老卡数据与存量设置照常生效。 */
            options: [
              { value: 'manual', label: t('settings.cards.method.manual') },
              { value: 'flashcard', label: t('mode.flashcard') },
              { value: 'quiz', label: t('mode.quiz') },
              { value: 'cloze', label: t('mode.cloze') },
            ],
          },
          {
            type: 'select',
            name: t('settings.cards.quizRatio'),
            desc: t('settings.cards.quizRatioDesc'),
            binding: {
              get: () =>
                String(Math.min(4, Math.max(2, Math.round(Number((getSettings()).reviewCardQuizRatio) || 3)))),
              set: (v: string) => {
                (getSettings()).reviewCardQuizRatio = Math.min(
                  4,
                  Math.max(2, Math.round(Number(v) || 3))
                );
              },
              save: () => saveSettings(),
            },
            options: [
              { value: '2', label: t('settings.cards.ratioHalf') },
              { value: '3', label: t('settings.cards.ratioThird') },
              { value: '4', label: t('settings.cards.ratioQuarter') },
            ],
            visibleWhen: (s) => s.reviewCardDefaultMethod === 'quiz',
            isChild: true,
          },
        ],
      },
      {
        icon: 'graduation-cap',
        name: '做题家',
        rows: [
          { type: 'toggle', name: t('settings.quiz.force'), desc: t('settings.quiz.forceDesc'),
            help: t('settings.quiz.forceHelp'),
            binding: { key: 'forceQuizForReview' } },
          // 出题子项：仅「用做题测难度」开启时显示（ticket 170 isChild 联动 + visibleWhen 兜底）
          { type: 'toggle', name: t('settings.quiz.multi'), desc: t('settings.quiz.multiDesc'), binding: { key: 'enableMultipleChoice' }, visibleWhen: (s) => s.forceQuizForReview === true, isChild: true },
          // 数量语义行口径对齐全域（深审新-14①）：number 行 + min 钳制（原 text 行可输 -5/abc）。
          // 键仍为 string 型（session parseInt||0 消费），binding 自管转 string 落盘；0=自动语义保留
          {
            type: 'number',
            name: t('settings.quiz.perNote'),
            desc: t('settings.quiz.perNoteDesc'),
            binding: {
              get: () => Number((getSettings()).questionsPerNote) || 0,
              set: (v) => { (getSettings()).questionsPerNote = String(v); },
              save: () => saveSettings(),
            },
            min: 0,
            max: 100,
            visibleWhen: (s) => s.forceQuizForReview === true,
            isChild: true,
          },
          { type: 'toggle', name: t('settings.quiz.shuffle'), desc: t('settings.quiz.shuffleDesc'), binding: { key: 'shuffleQuestions' }, visibleWhen: (s) => s.forceQuizForReview === true, isChild: true },
          {
            type: 'select',
            name: t('settings.quiz.difficulty'),
            desc: t('settings.quiz.difficultyDesc'),
            binding: { key: 'difficulty' },
            options: [
              { value: 'random', label: t('settings.quiz.diffRandom') },
              { value: 'easy', label: t('settings.quiz.diffEasy') },
              { value: 'medium', label: t('settings.quiz.diffMedium') },
              { value: 'hard', label: t('settings.quiz.diffHard') },
            ],
            visibleWhen: (s) => s.forceQuizForReview === true,
            isChild: true,
          },
        ],
      },
      {
        icon: 'timer',
        name: '复习节奏',
        rows: [
          // 非正数钳制为 0（原 onChange 口径：>0 保留否则 0）；空串不写（防脏值落盘）
          { type: 'number', name: t('settings.schedule.dailyLimit'), desc: t('settings.schedule.dailyLimitDesc'), binding: { key: 'reviewDailyLimit' }, min: 0, max: 1000 },
          {
            /* 键位只有四个位置，顺序固定（忘了/困难/一般/简单）。填错不报错、不拦保存，
               用的时候按 1234 兜底——设置填坏了也不该让复习键失效。 */
            type: 'text',
            name: t('settings.schedule.ratingKeys'),
            desc: t('settings.schedule.ratingKeysDesc'),
            binding: { key: 'reviewRatingKeys' },
            placeholder: '1234',
          },
          {
            /* 过了点才提醒、同一天只提醒一次；留空等于关掉，仍保留「有逾期就提示」。 */
            type: 'text',
            name: t('settings.schedule.remindAt'),
            desc: t('settings.schedule.remindAtDesc'),
            binding: { key: 'reviewRemindAt' },
            placeholder: t('settings.schedule.remindPlaceholder'),
          },
          {
            /* 低配机 / 远程桌面：16 幕动效是负担，直接给文字报告。 */
            type: 'toggle',
            name: t('settings.schedule.plainAnalysis'),
            desc: t('settings.schedule.plainAnalysisDesc'),
            binding: { key: 'reviewAnalysisPlain' },
          },
          // Anki 式学习步骤：新卡当天的短重复（默认 1m 10m）。参照 Anki 官方设计——
          // Good 进下一步、Again 回第一步、Hard 取前两步均值、Easy 直接毕业；只在建档当天有效。
          {
            type: 'text',
            name: t('settings.schedule.learningSteps'),
            desc: t('settings.schedule.learningStepsDesc'),
            help: t('settings.schedule.learningStepsHelp'),
            binding: { key: 'reviewLearningSteps' },
          },
          {
            type: 'number',
            name: t('settings.schedule.graduating'),
            desc: t('settings.schedule.graduatingDesc'),
            binding: { key: 'reviewGraduatingInterval' },
            min: 1,
            max: 30,
            visibleWhen: (s) => !!String(s.reviewLearningSteps || '').trim(),
            isChild: true,
          },
          {
            type: 'text',
            name: t('settings.schedule.relearnSteps'),
            desc: t('settings.schedule.relearnStepsDesc'),
            help: t('settings.schedule.relearnStepsHelp'),
            binding: { key: 'reviewRelearnSteps' },
          },
          // 深审新-14②/A14：超界改渲染器声明钳制（min/max 进界并回写输入框，R9 通路显示值=落盘值），
          // 原.onChange「超上界回 1」复刻删除——输入 8 落 5 且回显 5，不再出现显示 8 落 1 的缝
          {
            type: 'number',
            name: t('settings.schedule.intervalScale'),
            desc: t('settings.schedule.intervalScaleDesc'),
            help: t('settings.schedule.intervalScaleHelp'),
            binding: { key: 'reviewIntervalScale' },
            min: 0.1,
            max: 5,
          },
          {
            /* Anki fuzz：>=2.5 天的间隔在 ±(1 天 + 比例×天数) 内抖开。
               不改平均留存，只把扎堆到期的卡摊到相邻几天。 */
            type: 'toggle',
            name: t('settings.schedule.fuzz'),
            desc: t('settings.schedule.fuzzDesc'),
            help: t('settings.schedule.fuzzHelp'),
            binding: { key: 'reviewFuzz' },
          },
          // FSRS-7：目标留存率（desired retention）——既决定排期间隔，也用于提前复习判定。
          // 默认 0.9 是 Anki 官方推荐值（留存与负担的平衡点）。
          {
            type: 'number',
            name: t('settings.schedule.retention'),
            desc: t('settings.schedule.retentionDesc'),
            help: t('settings.schedule.retentionHelp'),
            binding: { key: 'reviewRThreshold' },
            min: 0.5,
            max: 0.99,
          },
          {
            type: 'toggle',
            name: t('settings.schedule.siblings'),
            desc: t('settings.schedule.siblingsDesc'),
            help: t('settings.schedule.siblingsHelp'),
            binding: { key: 'reviewBurySiblings' },
          },
          /* 批 3：新卡与到期分两个额度，各自截断。合成一个上限时，新卡多的一天
             会被新卡吃光，剩下的时间全在啃新的，复习效率反而更低。 */
          {
            type: 'number',
            name: t('settings.schedule.newLimit'),
            desc: t('settings.schedule.newLimitDesc'),
            binding: { key: 'reviewNewLimit' },
            min: 0,
            max: 500,
          },
          {
            type: 'number',
            name: t('settings.schedule.reviewLimit'),
            desc: t('settings.schedule.reviewLimitDesc'),
            binding: { key: 'reviewReviewLimit' },
            min: 0,
            max: 500,
          },
          {
            type: 'select',
            name: t('settings.schedule.order'),
            desc: t('settings.schedule.orderDesc'),
            binding: { key: 'reviewOrder' },
            options: [
              { value: 'due-first', label: t('settings.schedule.dueFirst') },
              { value: 'new-first', label: t('settings.schedule.newFirst') },
            ],
          },
          {
            type: 'number',
            name: t('settings.schedule.maxInterval'),
            desc: t('settings.schedule.maxIntervalDesc'),
            help: t('settings.schedule.maxIntervalHelp'),
            binding: { key: 'reviewMaxIntervalDays' },
            min: 0,
            max: 3650,
          },
          {
            /* 只认一个结束日期：那天之前不提醒、不进本轮、逾期也不累计；
               结束那天把整份计划的日期整体顺延，回来不会一屏逾期。 */
            type: 'text',
            name: t('settings.schedule.vacation'),
            desc: t('settings.schedule.vacationDesc'),
            binding: { key: 'reviewVacationUntil' },
            placeholder: t('settings.schedule.vacationPlaceholder'),
            /* 记下开始时间：结束那天要靠它算出该顺延多久。
               只记第一次，之后改结束日不会把开始时间往后挪。 */
            onChange: (v) => {
              const cut = String(v || '').trim();
              const live = getSettings();
              if (cut && !live.reviewVacationFrom) {
                live.reviewVacationFrom = new Date().toISOString();
                void saveSettings();
              }
            },
            actions: [
              {
                text: t('settings.schedule.cancelVacation'),
                onClick: () => {
                  const live = getSettings();
                  live.reviewVacationUntil = '';
                  live.reviewVacationFrom = '';
                  void saveSettings();
                  notice(t('settings.schedule.vacationCancelled'));
                },
              },
            ],
          },
        ],
      },
      {
        icon: 'brain',
        name: '记忆算法',
        rows: [
          // ADR-0077：FSRS 参数自动拟合（全自动定期重算）
          { type: 'toggle', name: t('settings.algo.fit'), desc: t('settings.algo.fitDesc'),
            help: t('settings.algo.fitHelp'),
            binding: { key: 'reviewEnableFit' } },
          {
            type: 'number',
            name: t('settings.algo.fitEveryN'),
            desc: t('settings.algo.fitEveryNDesc'),
            binding: { key: 'reviewFitEveryN' },
            min: 1,
            visibleWhen: (s) => s.reviewEnableFit === true,
            isChild: true,
          },
          /* 2026-11-21：手填调度权重整行撤下（技术细节太重），
             reviewFsrsWeights 的读取 / 解析代码保留，老用户已填的值仍生效。
             想回自动拟合：清空设置里的 reviewFsrsWeights 即可。 */
        ],
      },
      {
        icon: 'sliders-horizontal',
        name: '自动化',
        rows: [
          // 监听文件夹：通用 path 行（multi chips + 添加… 按钮，ticket 133 形态）。
          // 落盘走外部 binding 自管（权威写盘在 onChange）：新增目录需先确认存量收编（取消=不加入，
          // 回传回退清单否决本次变更），移除目录需连带清理其下排除记录（ticket 099）。
          {
            type: 'path',
            mode: 'multi',
            name: t('settings.auto.watchedFolders'),
            desc: t('settings.auto.watchedFoldersDesc'),
            help: t('settings.auto.watchedFoldersHelp'),
            binding: {
              get: () => (getSettings()).reviewWatchedFolders || [],
              set: () => {},
              save: () => {},
            },
            pickerTitle: t('settings.auto.pickerTitle'),
            pickerDesc: t('settings.auto.pickerDesc'),
            onChange: (list) => {
              const prev = [...((getSettings()).reviewWatchedFolders || [])];
              return (async (): Promise<string[]> => {
                const { ReviewWatcher } = await import('./watch');
                const watcher = new ReviewWatcher(deps.app, deps.dataManager);
                const kept: string[] = [];
                for (const folder of list) {
                  if (!folder) {
                    notice(t('settings.auto.rootUnsupported'), 'warning');
                    continue;
                  }
                  if (prev.includes(folder)) {
                    kept.push(folder);
                    continue;
                  }
                  // 新增：先确认存量收编；取消 = 该目录不加入（不写排除名单）
                  if (await watcher.confirmBatchAddForFolder(folder)) kept.push(folder);
                }
                for (const folder of prev) {
                  if (list.includes(folder)) continue;
                  // 移除：同时清空其下排除记录（否则二次添加时存量被旧黑名单挡住）
                  const cleared = await watcher.removeWatchedFolder(folder);
                  notice(cleared > 0 ? t('settings.auto.removedFolderCleared', { n: cleared }) : t('settings.auto.removedFolder'), 'success');
                }
                (getSettings()).reviewWatchedFolders = kept;
                await saveSettings();
                return kept;
              })();
            },
          },
          // 排除名单（通用 list 行，chips 自绘 DOM 已退役）：单条解除 = 移除按钮，逐条清理
          {
            type: 'list',
            name: t('settings.auto.excluded'),
            desc: t('settings.auto.excludedDesc'),
            items: () => ((getSettings()).reviewExcludedNotes || []).map((path: string) => ({ key: path, label: path })),
            emptyText: t('settings.auto.excludedEmpty'),
            removeLabel: t('settings.auto.excludedRemove'),
            onChange: (keys) => {
              void (async () => {
                const prev: string[] = (getSettings()).reviewExcludedNotes || [];
                const removed = prev.filter((p) => !keys.includes(p));
                if (removed.length === 0) return;
                const { ReviewWatcher } = await import('./watch');
                const watcher = new ReviewWatcher(deps.app, deps.dataManager);
                for (const path of removed) await watcher.removeExcludedNote(path);
                notice(t('settings.auto.excludedRemoved'), 'success');
              })();
            },
          },
        ],
      },
      {
        icon: 'sparkles',
        name: 'AI',
        rows: reviewLlmRows(),
      },
      {
        /* 探索组（2026-11-20）：还在打磨的功能先放这里，代码在、暂不铺开给用户。
           2026-11-21 用户要求「去掉入口，保留代码」：
           · 朗读听卡、挖空卡 Cloze 的说明行整行撤下（tts-client / card-audio /
             card-session.speak / Cloze 实现都留在代码里）。
           · 只留 Anki 导入这一颗真实按钮；描述按第 10 项精简成两句，不再讲分隔符与挖空语法。 */
        icon: 'flask-conical',
        name: '探索',
        rows: [
          {
            type: 'button',
            name: t('settings.explore.anki'),
            desc: t('settings.explore.ankiDesc'),
            buttonText: t('settings.explore.ankiPick'),
            onClick: () => {
              void (async () => {
                const { importAnkiFromPicker } = await import('./anki-import');
                await importAnkiFromPicker(deps.app, deps.dataManager);
              })();
            },
          },
        ],
      },
    ],
  };
}
