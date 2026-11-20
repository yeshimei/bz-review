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

import { openFlowDialog } from '../core/flow-dialog';
import { DEFAULT_REVIEW_DIR } from '../core/storage-dir';
import { getSettings, saveSettings } from '../core/settings-provider';
import type { SettingsSchema, SettingsRow } from '../core/settings-schema';
import {
  AI_PROVIDER_REGISTRY,
  DEFAULT_AI_PROVIDER,
  getProviderDescriptor,
  maxOutputCapOf,
  resetAIProviderCache,
  testAIConnectivity,
  thinkingLevelsOf,
} from '../core/ai';
import { fetchProviderModels, providerDescriptorOf } from '../core/ai-models';
import { openModelPicker } from '../core/settings-model-picker';
import { tryGetSettings } from '../core/settings-provider';
import type { ReviewDataManager } from './data';
import {
  GROUP_ID,
  PURCHASE_URL,
  licenseSummary,
  refreshLicense,
  currentLicenseCode,
} from '../data/entitlement';
import { copyReviewData, importFromBzWithConfirm } from '../data/migrate';
import { isBzPluginEnabled } from '../core/plugin-path';
import { panelModeOf } from './panel-mode';
import { DEFAULT_W } from './fsrs';
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
  return String(s?.aiProvider || DEFAULT_AI_PROVIDER);
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
  const map = s[mapKey] as Record<string, unknown>;
  if (v === '' || v === '0') delete map[id];
  else map[id] = mapKey === 'aiModelOverrides' ? v : Number(v);
  void saveSettings();
}

function providerModelRow(): SettingsRow {
  return {
    type: 'text',
    name: '模型名称',
    desc: 'AI 生成使用的模型，按服务商分别保存',
    help: '留空用注册表默认模型。「获取模型名」从当前服务商拉真实模型列表；切服务商后需重新获取。',
    placeholder: '默认模型',
    binding: {
      get: () => providerValue('model'),
      set: (v) => setProviderValue('aiModelOverrides', v),
      save: () => {},
    },
    refreshKey: () => providerValue('model'),
    actions: [
      {
        text: '获取模型名',
        onClick: async (_value, ctx) => {
          try {
            await saveSettings();
            const providerId = currentProviderId();
            const desc = providerDescriptorOf(providerId);
            const models = await fetchProviderModels(providerId);
            if (currentProviderId() !== providerId) {
              notice('服务商已切换，请重新获取', 'warning');
              return;
            }
            await new Promise<void>((resolve) => {
              openModelPicker({
                providerLabel: desc.label,
                current: providerValue('model'),
                models,
                onPick: (m) => {
                  setProviderValue('aiModelOverrides', m.id);
                  ctx.refreshVisibility();
                  notice(`模型已设为 ${m.id}`, 'success');
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
    name: '最大输出 token',
    desc: '单次回复的长度上限，按服务商分别保存',
    help: '封顶值，不是每次都消耗这么多。留空或 0 = 用该模型的官方最大档。',
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
    placeholder: '默认上限',
  };
}

function providerThinkingRow(): SettingsRow {
  return {
    type: 'select',
    name: '思考 reasoning',
    desc: '思考档位，随服务商不同',
    help: '档位表按服务商分别存；「跟随」＝不注入参数。自定义没有固定口径，这一行不显示。',
    binding: {
      get: () => providerThinkingValue(),
      set: (v) => setProviderThinkingValue(v),
      save: () => {},
    },
    options: (snap) =>
      thinkingLevelsOf(String((snap as { aiProvider?: string }).aiProvider || DEFAULT_AI_PROVIDER)).map((l) => ({
        value: l.value,
        label: l.label,
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
      name: 'AI 服务商',
      desc: '当前使用的 AI 服务商（18 家在册，未列出的走自定义）',
      binding: { key: 'aiProvider' },
      options: AI_PROVIDER_REGISTRY.map((p) => ({ value: p.id, label: p.label })),
    },
    {
      type: 'text',
      name: '自定义 API 地址',
      desc: 'OpenAI 兼容服务的完整接口地址，填到 /v1 为止',
      binding: { key: 'aiCustomEndpoint' },
      placeholder: 'https://api.example.com/v1',
      inputMode: 'url',
      visibleWhen: (snapshot) => snapshot.aiProvider === 'custom',
    },
    {
      type: 'select',
      name: '自定义协议',
      desc: '自定义服务用哪种报文',
      binding: { key: 'aiCustomProtocol' },
      options: [
        { value: 'openai', label: 'OpenAI 兼容' },
        { value: 'anthropic', label: 'Anthropic（Claude）' },
      ],
      visibleWhen: (snapshot) => snapshot.aiProvider === 'custom',
    },
  ];
  for (const p of AI_PROVIDER_REGISTRY) {
    rows.push({
      type: 'secret',
      name: p.apiKeyLabel,
      desc: p.apiKeyDesc,
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
      placeholder: '粘贴密钥',
      visibleWhen: (snapshot) => snapshot.aiProvider === p.id,
      actions: [
        {
          text: '测试',
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
    name: '共享 bz Reader 的 AI 配置',
    desc: '自己没配时借用 bz Reader 填好的那一份；只读，不会写回它',
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
      title: '迁移数据目录？',
      message: `会把「${prev}」里的复习数据复制到「${next}」。旧目录保留，搬错了改回去就能自愈；新目录已有数据时不覆盖。`,
      actions: [
        { label: '取消', value: 'cancel' },
        { label: '确认迁移', value: 'ok', cta: true },
      ],
    });
    if (ok !== 'ok') {
      notice('已取消，数据目录没变', 'info');
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
        notice(`已把复习数据复制到 ${next}（${copied.length} 个文件），原目录保留`, 'success');
      } else if (kept.length) {
        notice(`${next} 里已有复习数据，没有覆盖。旧数据仍在 ${prev}`, 'warning');
      } else {
        notice(`已切到 ${next}，旧目录没有需要迁移的数据`, 'info');
      }
      return next;
    } catch {
      notice(`已切换数据目录，但数据没能搬过去。旧数据仍在 ${prev}`, 'warning');
      return prev;
    }
  };

  const ACCENT_NAME = '强调色';
  const ACCENT_DESC = '跟随 Obsidian / 铜金 / 黛蓝 / 苔青；换色后全插件交互色一起变';
  const ACCENT_HELP =
    '「跟随 Obsidian」跟着宿主的强调色走，读不到时回退铜金；其余三档是固定色板。\n' +
    '选中态、主按钮、链接、进度条、状态点、焦点环都会跟着变，明暗色各自适配。';
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
            type: 'info',
            name: '当前状态',
            desc: licenseSummary(),
            actions: [
              { text: '打开店铺', onClick: () => { window.open(PURCHASE_URL, '_blank'); } },
              { text: '交流群', onClick: () => { window.open(`https://qm.qq.com/q/${GROUP_ID}`, '_blank'); } },
            ],
          },
          {
            /* 和 bz Reader 一样，授权组里给一颗「看看包含什么」的入口。
               弹窗按需加载，只有点开才付那一份 DOM/CSS 的代价。 */
            type: 'button',
            name: '高级版功能',
            desc: '两版功能完全一样，只有数量上限不同。点开看对照表。',
            buttonText: '查看',
            onClick: () => {
              void import('./ui/unlock-dialog').then((m) => m.openReviewUnlockDialog());
            },
          },
          {
            type: 'text',
            name: '激活码',
            desc: '填激活码解锁不限数量。赞助人 / 专属定制码两款插件通用；普通高级版码各插件独立。离线验签，不联网。',
            placeholder: 'BZP2.… 或 BZR2.…（赞助人 / 专属码）',
            /* 外部 binding：输入只进草稿、不落盘。通用 text 行 800ms 防抖就会
               saveSettings，直绑 licenseKey 的话输错一次就把真码冲掉了。 */
            binding: {
              get: () => licenseDraft || currentLicenseCode(),
              set: (v: string) => {
                licenseDraft = v;
              },
              save: () => {
                /* 输入本身不落盘：只有点「激活」验签通过才写 settings */
              },
            },
            actions: [
              {
                text: '激活',
                cta: true,
                onClick: async () => {
                  const code = licenseDraft.trim();
                  const state = await refreshLicense(code, false);
                  if (state.paid) {
                    licenseDraft = '';
                    getSettings().licenseKey = code;
                    await saveSettings();
                    notice(
                      `已激活高级版${state.name ? `（${state.name}）` : ''}，数量不限。`,
                      'success'
                    );
                    return;
                  }
                  /* 失败：授权状态和落盘码都没被这枚错码碰过，把输入框也回显回生效码。
                     激活码输入框的 placeholder 是全局唯一的，靠它定位。 */
                  const effective = currentLicenseCode();
                  licenseDraft = '';
                  const input = document.querySelector<HTMLInputElement>(
                    'input[placeholder^="BZP2"]'
                  );
                  if (input) input.value = effective;
                  notice('激活码无效或已过期，原来的激活码已保留。', 'warning');
                },
              },
            ],
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
            name: '数据目录',
            desc: '复习数据存在这个目录下的 review.json。换目录会先确认，再把数据复制过去。',
            render: (body) => {
              const setting = new Setting(body)
                .setName('数据目录')
                .setDesc('复习数据存在这个目录下的 review.json。换目录会先确认，再把数据复制过去。');
              setting.settingEl.classList.add('bzrv-pickdir-row');
              const btn = createEl('button');
              btn.type = 'button';
              btn.className = 'bzs-pickdir';
              btn.appendChild(
                Object.assign(createSpan(), {
                  className: 'bzs-sr-only',
                  textContent: '从列表选择复习数据目录',
                }),
              );
              const pathEl = createSpan();
              pathEl.className = 'bzs-pickdir-path';
              const ico = createSpan();
              ico.className = 'bzs-pickdir-ico';
              setHtml(ico, FOLDER_SVG);
              btn.append(pathEl, ico, createEl('i', { text: '选择' }));
              const current = (): string => String(getSettings().storagePath || DEFAULT_REVIEW_DIR);
              const paint = (dir: string): void => {
                pathEl.textContent = `${dir}/`;
              };
              paint(current());
              btn.addEventListener('click', () => {
                void pickFolderNative(deps.app, {
                  title: '选择复习数据目录',
                  mode: 'single',
                  selected: [current()],
                }).then(async (list) => {
                  const picked = String(list[0] || '').trim();
                  if (!picked) {
                    notice('数据目录不能是库根目录，请选一个文件夹', 'warning');
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
            name: '从 bz 导入',
            desc: '检测到 bz 后才显示。先看统计、再确认导入；只复制不改动 bz，目标已有数据就不覆盖。',
            buttonText: '导入',
            visibleWhen: () => isBzPluginEnabled(deps.app),
            onClick: () => {
              void importFromBzWithConfirm(deps.app, getSettings());
            },
          },
          {
            /* 快照是最后一道保险：合并写错、同步出事、手滑清空，都能从这里退回去。
               备份/回滚都走二次确认；回滚前先给当前数据留一份，所以「回滚」本身也能反悔。 */
            type: 'info',
            name: '备份与回滚',
            desc: '每次写数据前留一份当天的快照（最多 30 份）。点开可挑任意时间点回滚；备份和回滚都要二次确认，回滚前会先给当前数据存一份。',
            actions: [
              {
                text: '备份与回滚',
                onClick: () => openBackupHistoryDialog(deps.app),
              },
              {
                text: '回滚到最近',
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
                { value: 'auto', label: '跟随 Obsidian' },
                { value: 'copper', label: '铜金' },
                { value: 'indigo', label: '黛蓝' },
                { value: 'moss', label: '苔青' },
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
                  notice(`强调色：${m.label}`);
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
            name: '打开方式',
            desc: '复习面板开成标签页，还是屏幕中央的浮层',
            help:
              '「Obsidian 标签页」跟工作区一起保存和恢复，能分屏，也不挡正在看的笔记；' +
              '「独立弹窗」压在所有东西上面，适合小屏临时看一眼。' +
              '改完从下一次打开生效，已经开着的那个不会自己变形。',
            binding: {
              get: () => panelModeOf(getSettings()),
              set: (v: string) => {
                (getSettings()).reviewPanelMode = v === 'popup' ? 'popup' : 'native';
              },
              save: () => saveSettings(),
            },
            options: [
              { value: 'native', label: 'Obsidian 标签页（默认）' },
              { value: 'popup', label: '独立弹窗' },
            ],
          },
          {
            type: 'toggle', name: '文件树标记', desc: '文件树中标记复习笔记',
            help:
              '在 Obsidian 文件树里给复习中的笔记染色并挂阶段徽标，不开复习面板也能看出哪些到期、处在哪个阶段。' +
              '关掉只是不画这些视觉标记，排期计算与到期提醒都不受影响，文件树恢复宿主原样。',
            binding: { key: 'reviewTreeBadge' },
          },
        ],
      },
      {
        icon: 'bell',
        name: '检查提醒',
        rows: [
          { type: 'toggle', name: '到期提醒', desc: '有笔记到期待复习时自动弹出提醒', binding: { key: 'enableAutoNotify' } },
          { type: 'toggle', name: '新笔记加入提醒', desc: '新笔记被自动加入时弹出提示，多条合并成一条', binding: { key: 'reviewAutoAddNotice' } },
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
            name: '新卡默认方式',
            desc: '加卡时用哪种方式制卡；选「每次问我」就每张都问一遍',
            help:
              '这张卡做成什么形式，在「加入复习那一刻」定下来，之后复习就按它走，' +
              '同一份计划里抽认卡、做题卡可以并存。\n' +
              '选「每次问我」：每次加卡都弹一个选择框（里面可以勾「以后别再问」）；' +
              '选了具体方式：加卡不再打扰，直接按它制。\n' +
              '已经建好的老卡不受影响，换方式请在复习面板里右键那张卡点「重新生成」。',
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
              { value: 'manual', label: '每次问我（默认）' },
              { value: 'flashcard', label: 'AI 抽认卡' },
              { value: 'quiz', label: 'AI 做题' },
              { value: 'cloze', label: '挖空卡（Cloze）' },
            ],
          },
          {
            type: 'select',
            name: '每轮抽题比例',
            desc: '题库固定，每轮只抽其中一部分',
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
              { value: '2', label: '一半' },
              { value: '3', label: '三分之一' },
              { value: '4', label: '四分之一' },
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
          { type: 'toggle', name: '用做题测难度', desc: '开始复习即做题，按正确率自动定难度',
            help:
              '打开后「开始复习」先出题，再按正确率定本次难度。' +
              '下面多选、题量、打乱顺序、出题难度四行是它的子项，只在开着时显示；关掉则回到普通跳转复习。',
            binding: { key: 'forceQuizForReview' } },
          // 出题子项：仅「用做题测难度」开启时显示（ticket 170 isChild 联动 + visibleWhen 兜底）
          { type: 'toggle', name: '允许多选题', desc: '开启后 AI 可能出多选题，关闭则只出单选题', binding: { key: 'enableMultipleChoice' }, visibleWhen: (s) => s.forceQuizForReview === true, isChild: true },
          // 数量语义行口径对齐全域（深审新-14①）：number 行 + min 钳制（原 text 行可输 -5/abc）。
          // 键仍为 string 型（session parseInt||0 消费），binding 自管转 string 落盘；0=自动语义保留
          {
            type: 'number',
            name: '每篇笔记出题数量',
            desc: '固定每篇笔记出题的数量，0 为自动',
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
          { type: 'toggle', name: '打乱出题顺序', desc: '做题时随机排列题目顺序', binding: { key: 'shuffleQuestions' }, visibleWhen: (s) => s.forceQuizForReview === true, isChild: true },
          {
            type: 'select',
            name: '出题难度',
            desc: '控制 AI 出题深浅',
            binding: { key: 'difficulty' },
            options: [
              { value: 'random', label: '随机' },
              { value: 'easy', label: '简单' },
              { value: 'medium', label: '中等' },
              { value: 'hard', label: '困难' },
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
          { type: 'number', name: '每日复习上限', desc: '一轮最多复习的篇数', binding: { key: 'reviewDailyLimit' }, min: 0, max: 1000 },
          {
            /* 键位只有四个位置，顺序固定（忘了/困难/一般/简单）。填错不报错、不拦保存，
               用的时候按 1234 兜底——设置填坏了也不该让复习键失效。 */
            type: 'text',
            name: '评级键位',
            desc: '四个字符，顺序＝忘了 / 困难 / 一般 / 简单（默认 1234，也可填 asdf 或 hjkl）',
            binding: { key: 'reviewRatingKeys' },
            placeholder: '1234',
          },
          {
            /* 过了点才提醒、同一天只提醒一次；留空等于关掉，仍保留「有逾期就提示」。 */
            type: 'text',
            name: '每日提醒',
            desc: '填 09:00 这样的时间；留空 = 不提醒',
            binding: { key: 'reviewRemindAt' },
            placeholder: '例如 20:00',
          },
          {
            /* 低配机 / 远程桌面：16 幕动效是负担，直接给文字报告。 */
            type: 'toggle',
            name: '简化分析',
            desc: '记忆分析改成纯文字报告，不跑动画（低配手机 / 远程桌面用）',
            binding: { key: 'reviewAnalysisPlain' },
          },
          // Anki 式学习步骤：新卡当天的短重复（默认 1m 10m）。参照 Anki 官方设计——
          // Good 进下一步、Again 回第一步、Hard 取前两步均值、Easy 直接毕业；只在建档当天有效。
          {
            type: 'text',
            name: '学习步骤（分钟）',
            desc: '新卡当天的短重复，默认 "1m 10m"；留空 = 关掉，首次评级直接进 FSRS',
            help:
              '模仿 Anki 的学习步骤：新卡先在当天按这里的间隔重复几次，走完才进入 FSRS 排期。' +
              '只认分钟（如 "1m 10m 30m"），不认小时/天——官方建议步骤都在当天完成。' +
              'Good 进下一步、忘了回第一步、困难取前两步均值、简单直接毕业。留空则新卡第一次评级就进 FSRS。',
            binding: { key: 'reviewLearningSteps' },
          },
          {
            type: 'number',
            name: '毕业间隔（天）',
            desc: '走完学习步骤后第一次复习间隔，默认 1 天',
            binding: { key: 'reviewGraduatingInterval' },
            min: 1,
            max: 30,
            visibleWhen: (s) => !!String(s.reviewLearningSteps || '').trim(),
            isChild: true,
          },
          {
            type: 'text',
            name: '重学步骤（分钟）',
            desc: 'FSRS 阶段点「忘了」后的当天重学，默认 "1m 10m"；留空 = 关掉',
            help:
              '模仿 Anki 的 relearn steps：已经毕业的卡点「忘了」后，先在当天按这里的间隔重学几次，' +
              '再回到 FSRS 排期。不填则忘了之后直接进入 FSRS 的遗忘后排期。',
            binding: { key: 'reviewRelearnSteps' },
          },
          // 深审新-14②/A14：超界改渲染器声明钳制（min/max 进界并回写输入框，R9 通路显示值=落盘值），
          // 原.onChange「超上界回 1」复刻删除——输入 8 落 5 且回显 5，不再出现显示 8 落 1 的缝
          {
            type: 'number',
            name: '复习间隔缩放',
            desc: '数值越小复习越频繁，数值越大越宽松',
            help:
              '作用在 FSRS 间隔上的乘数：间隔 = intervalDays × scale。' +
              '范围 0.1 到 5，填 0.5 更勤、填 2 更宽松。',
            binding: { key: 'reviewIntervalScale' },
            min: 0.1,
            max: 5,
          },
          {
            /* Anki fuzz：>=2.5 天的间隔在 ±(1 天 + 比例×天数) 内抖开。
               不改平均留存，只把扎堆到期的卡摊到相邻几天。 */
            type: 'toggle',
            name: '间隔抖动（Anki fuzz）',
            desc: '长间隔上下浮动、学习步骤略微延长，避免复习扎堆（默认开）',
            help:
              '模仿 Anki 的间隔抖动：2.5 天以上的间隔会在一个随机范围内前后挪动，越长的间隔浮动越大；' +
              '学习步骤（1m/10m）会在原时长上再加 0~25%（最多 5 分钟），避免每次都在同一秒复习同一张卡。' +
              '它不改变平均复习量，只是把扎堆的卡摊开。随机值由卡片 ID 和复习次数决定，结果稳定可复现。',
            binding: { key: 'reviewFuzz' },
          },
          // FSRS-7：目标留存率（desired retention）——既决定排期间隔，也用于提前复习判定。
          // 默认 0.9 是 Anki 官方推荐值（留存与负担的平衡点）。
          {
            type: 'number',
            name: '目标留存率',
            desc: '到期时希望还记得的比例，默认 90%',
            help:
              'FSRS 会把卡片排到「你还有这么多概率记得」的那一天。90% 是官方推荐的默认值，' +
              '在记得牢和复习量之间最均衡。调高（如 95%）间隔变短、复习更勤，越接近 100% 复习量增长越快；' +
              '调低则更省时间但忘得更多。官方建议不要超过 97%。',
            binding: { key: 'reviewRThreshold' },
            min: 0.5,
            max: 0.99,
          },
          {
            type: 'toggle',
            name: '兄弟卡不扎堆',
            desc: '反向卡 / 挖空拆卡同一轮只出一张，默认开',
            help: '同一段内容生成的几张卡（正反对调、多处挖空）如果连着复习，正确率会被虚高、也浪费时间。开启后同一轮只挑一张，其余留到下一轮；不改排期、不删卡。',
            binding: { key: 'reviewBurySiblings' },
          },
          /* 批 3：新卡与到期分两个额度，各自截断。合成一个上限时，新卡多的一天
             会被新卡吃光，剩下的时间全在啃新的，复习效率反而更低。 */
          {
            type: 'number',
            name: '每轮新条上限',
            desc: '本轮最多上几条从没复习过的；0 = 不限',
            binding: { key: 'reviewNewLimit' },
            min: 0,
            max: 500,
          },
          {
            type: 'number',
            name: '每轮到期上限',
            desc: '本轮最多清几条已经复习过的；0 = 不限',
            binding: { key: 'reviewReviewLimit' },
            min: 0,
            max: 500,
          },
          {
            type: 'select',
            name: '本轮顺序',
            desc: '先清到期，还是趁精神好先上新卡',
            binding: { key: 'reviewOrder' },
            options: [
              { value: 'due-first', label: '先清到期' },
              { value: 'new-first', label: '先上新卡' },
            ],
          },
          {
            type: 'number',
            name: '最长复习间隔（天）',
            desc: '超过这个天数的间隔会被截断；0 = 不限',
            help:
              'FSRS 在稳定度很高时会算出几千天的间隔，实质等于「这条以后不再出现」。' +
              '填 365 表示任何一条一年内至少会再见一次；填 0 表示不限制。',
            binding: { key: 'reviewMaxIntervalDays' },
            min: 0,
            max: 3650,
          },
          {
            /* 只认一个结束日期：那天之前不提醒、不进本轮、逾期也不累计；
               结束那天把整份计划的日期整体顺延，回来不会一屏逾期。 */
            type: 'text',
            name: '休假到',
            desc: '填 2026-12-01 这样的日期；这天之前不提醒、不算逾期，结束时计划整体顺延',
            binding: { key: 'reviewVacationUntil' },
            placeholder: '例如 2026-12-01',
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
                text: '取消休假',
                onClick: () => {
                  const live = getSettings();
                  live.reviewVacationUntil = '';
                  live.reviewVacationFrom = '';
                  void saveSettings();
                  notice('已取消休假');
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
          { type: 'toggle', name: '参数自动拟合', desc: '按个人复习历史拟合记忆参数，优化复习节奏',
            help:
              '用你的复习记录重新拟合 FSRS 参数。' +
              '样本少于 100 条直接跳过（沿用默认参数），100 到 300 条只拟合基础八参，300 条以上拟合全参——所以刚开始用看不出差别。',
            binding: { key: 'reviewEnableFit' } },
          {
            type: 'number',
            name: '每 N 次复习重算',
            desc: '累计 N 次评级后自动重拟合一次',
            binding: { key: 'reviewFitEveryN' },
            min: 1,
            visibleWhen: (s) => s.reviewEnableFit === true,
            isChild: true,
          },
          {
            /* 手填优先于拟合：用户明确写下的意图不能被后台悄悄盖掉。
               留空即恢复「全自动」，想退回默认把内容清干净就行。 */
            type: 'textarea',
            name: '手填调度权重',
            desc: '34 个数字，逗号分隔；填了就用它，留空 = 用自动拟合的结果',
            placeholder: DEFAULT_W.join(', '),
            binding: { key: 'reviewFsrsWeights' },
          },
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
            name: '监听文件夹',
            desc: '新笔记自动加入复习',
            help:
              '目录里的新笔记自动加入复习。库根目录不支持监听，会被拦下。' +
              '首次添加目录时会问是否把目录内已有笔记一并收编：取消 = 该目录不加入监听（新老笔记都不收），确认才加入。',
            binding: {
              get: () => (getSettings()).reviewWatchedFolders || [],
              set: () => {},
              save: () => {},
            },
            pickerTitle: '选择监听文件夹',
            pickerDesc: '文件夹里的新笔记自动加入复习，包括子文件夹',
            onChange: (list) => {
              const prev = [...((getSettings()).reviewWatchedFolders || [])];
              return (async (): Promise<string[]> => {
                const { ReviewWatcher } = await import('./watch');
                const watcher = new ReviewWatcher(deps.app, deps.dataManager);
                const kept: string[] = [];
                for (const folder of list) {
                  if (!folder) {
                    notice('暂不支持监听库根目录', 'warning');
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
                  notice(cleared > 0 ? `已移除监听文件夹，并清理其下 ${cleared} 条排除记录` : '已移除监听文件夹', 'success');
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
            name: '排除名单',
            desc: '自动加入的排除名单',
            items: () => ((getSettings()).reviewExcludedNotes || []).map((path: string) => ({ key: path, label: path })),
            emptyText: '暂无排除笔记',
            removeLabel: '解除',
            onChange: (keys) => {
              void (async () => {
                const prev: string[] = (getSettings()).reviewExcludedNotes || [];
                const removed = prev.filter((p) => !keys.includes(p));
                if (removed.length === 0) return;
                const { ReviewWatcher } = await import('./watch');
                const watcher = new ReviewWatcher(deps.app, deps.dataManager);
                for (const path of removed) await watcher.removeExcludedNote(path);
                notice('已解除排除', 'success');
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
           · 朗读听卡：实现有问题，做题界面的按钮与原来的「朗读」设置组都已撤下，
             功能代码（tts-client / card-audio / card-session.speak）整段保留，成熟后再放回。
           · 挖空卡（Cloze）：社区正名，读作「克洛兹」，Anki 的 {{c1::答案}} 写法；已解锁为
             制卡方式之一，见「划线卡」组的新卡默认方式。
           · Anki 格式导入：兼容 Anki 导出的 TSV / 挖空写法，入口在下方按钮与命令面板。 */
        icon: 'flask-conical',
        name: '探索',
        rows: [
          {
            type: 'info',
            name: '还在打磨的功能',
            desc:
              '朗读听卡（代码在、暂不显示）、挖空卡 Cloze、Anki 格式导入都放在这里。' +
              '挖空卡读作「克洛兹」，是 Anki 的 {{c1::答案}} 填空写法；导入的 Anki 卡会自动转成挖空卡。',
          },
          {
            type: 'button',
            name: '从 Anki 导入',
            desc: '打开系统文件框选一份 Anki「笔记纯文本」导出（.txt/.tsv/.csv，库外任意位置都行），先看清进来多少、跳过什么再确认。支持 Tab/逗号分隔、网页格式、{{c1::挖空}} 拆卡与反向卡；导出里引用的图片/音频可再多选文件按文件名补进来，图片遮挡卡按图片+文字导入（遮挡区域随后手动补）；命令面板也可执行。',
            buttonText: '选文件导入',
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
