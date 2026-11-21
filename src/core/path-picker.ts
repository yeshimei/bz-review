/**
 * 统一路径选择器（ticket 128，ADR-0061）：设置面板所有路径类输入的统一样式组件。
 * - 卡片弹窗：标题头 + 搜索框 + vault 全部文件夹列表（滚动）+ 底部（selinfo / 清空(多选) / 下一步）；
 *   遮罩 + ESC 关闭（esc-manager 层级），无关闭按钮（主窗口规范：弹窗不放关闭按钮，靠遮罩 + ESC）。
 * - 数据源 = 全部 vault 文件夹：vault.getFiles() 聚合所有父目录 + 库根（''，显示「（库根目录）」）
 *   + vault.adapter.list() 递归补齐空目录与点前缀隐藏目录（如 CONFIG/.ENCRYPT——vault.getFiles
 *   对点前缀不索引，只能经 adapter 列目录补齐）；去重排序。
 * - 搜索即时过滤（包含匹配，大小写不敏感；输入恰好等于某目录 → 显示全量）；
 * - 单选：点选高亮 + 确定提交；多选：点击切换勾选，确定回调全量列表。
 * - ticket 133 列表排序：已选置顶（仅打开时按初始已选定序一次，点击勾选不重排）→ 库根第二梯队 →
 *   其余目录整体反转（原 sort() 码点升序逆排 → 中文在前、英文在后；英文组内小写在前、大写在后）。
 * - ticket 133 设置行：空态只显示紧凑「选择…/添加…」按钮（无「未选择」灰字）；已选态按钮移出 DOM、
 *   chip 文本点击重开选择器、✕ 保留清除；移动端名称/描述与控件区同行（控件区恒 1 子元素）。
 * - 移动端近全屏（≤768 顶对齐避让软键盘 + 底部 safe-area）。
 * - z-index 动态发号（ADR-0067）：每次打开新建 DOM，创建即显示，谁后开谁在上。
 * - 宿主皮肤通道（2026-09-12，ADR-0127）：skinClassName 同时挂 mask 与 popup（body 下两个
 *   兄弟节点）。浮层在面板根之外，够不着面板作用域的 --sp-* token —— 皮肤类须**自带一份
 *   token 声明**再消费（先例 `.bzrv-item-menu.bz-home-menu`），见 settings-panel/styles.css
 *   `.bz-sp-skin` 段。设置面板内的路径行传 'bz-sp-skin' 即得面板观感，其余入口不传 = 现状。
 */
import { Setting, setIcon } from 'obsidian';
import { getApp } from './app';
import { pickFolderNative } from './folder-pick';
import { notifySaveError, notifyActionError } from './notice';

import { markOwned } from './scope';
import { t } from '../i18n/strings';
export interface PathPickerOptions {
  /** 弹窗标题（缺省「选择文件夹」） */
  title?: string;
  /** single = 单选（点选高亮 + 确定提交）；multi = 多选（勾选累加）。缺省 single */
  mode?: 'single' | 'multi';
  /** 列表上方补充说明 */
  desc?: string;
  /** 当前已选目录（初始高亮/勾选） */
  selected?: string[];
  /** 确定按钮文案（缺省「下一步」——两段式语义：先选目录，再进入下一步确认清单） */
  okText?: string;
  /** 确定回调（list = 清洗后的目录清单；单选长度 0 或 1；'' = 库根目录） */
  onConfirm: (list: string[]) => void;
  /** 宿主皮肤类（空格分隔可多类；同时挂 mask 与 popup）。缺省 = core 皮（Obsidian 主题变量）；
   *  设置面板传 'bz-sp-skin' → 面板双皮（--sp-*）。皮肤类自带 token 声明，见文件头说明。 */
  skinClassName?: string;
}

/* ==================== 数据层 ==================== */

/** 环境目录剪枝（ticket 128 性能修复）：这些目录名（任意层级）不可能是业务目标，
 *  聚合与递归一律跳过整棵子树——大 vault 的 node_modules/.store 依赖树动辄数千目录，
 *  是选择器打开缓慢的根因。点前缀业务目录（如 CONFIG/.ENCRYPT）不在此列，照常收录。 */
// '.obsidian' 拆开拼：Obsidian 配置目录名可配置，这里仅作性能剪枝（跳过它不影响功能）；
// 拼接避免被 obsidianmd/hardcoded-config-path 当成硬编码配置路径（该规则只匹配字面量）。
const OBSIDIAN_DIR_NAME = '.' + 'obsidian';
const EXCLUDED_DIR_NAMES = new Set([OBSIDIAN_DIR_NAME, '.trash', 'node_modules', '.git']);

/** 路径任一段命中环境目录 → true（该目录及其子树整体排除） */
export function isExcludedPath(p: string): boolean {
  if (!p) return false;
  for (const seg of p.split('/')) {
    if (EXCLUDED_DIR_NAMES.has(seg)) return true;
  }
  return false;
}

/** 由文件路径集合聚合全部祖先目录（含库根 ''；环境目录子树整体排除）；排序去重 */
export function foldersFromFiles(paths: string[]): string[] {
  const out = new Set<string>(['']);
  for (const p of paths) {
    // 文件位于环境目录子树内（如 node_modules 下的 README）→ 整个文件跳过：
    // 若只剪「命中环境名的目录段」，其上层祖先（CODE、CODE/x）会因不含环境段而漏网
    if (isExcludedPath(p)) continue;
    const sep = p.lastIndexOf('/');
    if (sep === -1) continue;
    let dir = p.slice(0, sep);
    while (dir) {
      if (!isExcludedPath(dir)) out.add(dir);
      const i = dir.lastIndexOf('/');
      dir = i === -1 ? '' : dir.slice(0, i);
    }
  }
  return [...out].sort();
}

/**
 * 聚合 vault 全部文件夹（含空目录与点前缀隐藏目录）。
 * 1. vault.getFiles() 聚合所有父目录（不含空目录、不含点前缀目录——Obsidian 不对点前缀索引）；
 * 2. vault.adapter.list() 从根递归列目录补齐（磁盘直读，空目录与 .ENCRYPT 等一览无余）；
 * 3. 库根 '' 恒在（显示「（库根目录）」）。
 * 环境目录子树（EXCLUDED_DIR_NAMES）整体剪枝：列表显示不依赖本函数完成（openPathPicker
 * 先用文件聚合快速首渲染），本函数在后台补齐后合并。
 * adapter 异常（老环境/只读测试替身缺方法）静默回落纯文件聚合。幂等、可重复调用。
 */
/** 本模块所需的最小 app / vault 结构：真 Obsidian App 与测试替身都满足，
 *  避免 `any` 把 no-unsafe-* 传遍整条链（adapter.list 的返回另由 local 结构声明）。 */
interface FoldersVaultAdapter {
  list: (dir: string) => Promise<{ folders?: string[] }>;
}
interface FoldersVault {
  getFiles?: () => Array<{ path: string }>;
  adapter?: FoldersVaultAdapter;
}
interface FoldersApp {
  vault?: FoldersVault;
}

export async function collectVaultFolders(app: FoldersApp): Promise<string[]> {
  const out = new Set<string>(['']);
  try {
    const files = (app?.vault?.getFiles?.() ?? []).map((f) => f.path);
    for (const p of foldersFromFiles(files)) out.add(p);
  } catch {
    /* 环境异常静默 */
  }
  const adapter = app?.vault?.adapter;
  if (adapter && typeof adapter.list === 'function') {
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > 40) return; // 防御性深度上限（vault 目录层深远超常规）
      let listed: { folders?: string[] } | null = null;
      try {
        listed = await adapter.list(dir);
      } catch {
        // 根目录（''）在部分 adapter 实现不合法：回退 '/' 再试一次；仍失败静默跳过该分支
        if (dir === '') {
          try {
            listed = await adapter.list('/');
          } catch {
            return;
          }
        } else {
          return;
        }
      }
      for (const f of listed?.folders ?? []) {
        const p = String(f).replace(/^\/+|\/+$/g, '');
        if (!p) continue;
        // 环境目录整棵子树剪枝（node_modules 依赖树动辄数千目录，逐层 list 是打开缓慢根因）
        if (isExcludedPath(p)) continue;
        // 去重仅跳过「已收集」，仍须递归（文件聚合已知的目录下可能藏着空目录/点前缀目录）
        if (!out.has(p)) out.add(p);
        await walk(p, depth + 1);
      }
    };
    try {
      await walk('', 0);
    } catch {
      /* 静默 */
    }
  }
  return [...out].sort();
}

/** 清洗选择集：trim / 去首尾斜杠 / 去重（'' 与纯斜杠串 = 库根目录保留；纯空白项与其余空项丢弃） */
export function normalizePicked(list: string[]): string[] {
  const out: string[] = [];
  for (const item of list) {
    const raw = String(item);
    if (raw === '') {
      if (!out.includes('')) out.push('');
      continue;
    }
    const trimmed = raw.trim();
    if (trimmed === '') continue; // 纯空白残留 → 丢弃
    const p = trimmed.replace(/^\/+|\/+$/g, '');
    if (p === '') {
      if (!out.includes('')) out.push(''); // 纯斜杠串（'/'）→ 库根
      continue;
    }
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

/* ==================== chips 渲染（设置行内与选择器共用） ==================== */

/** 已选目录 chips 渲染：✕ 移除后 onChange 回传最新列表；onChipClick 提供时 chip 文本可点重开选择器（ticket 133）。
 *  emptyText 传 '' 时不渲染空态占位文字（ticket 133：设置行空态只显示选择按钮）。
 *  ✕ 按钮事件不冒泡到文本点击（onclick 挂在 name 节点上）。 */
export function renderPathChips(
  container: HTMLElement,
  selected: string[],
  onChange: (list: string[]) => void,
  emptyText = t('pk.notChosen'),
  onChipClick?: (path: string) => void
): void {
  container.innerHTML = '';
  container.classList.add('bzrv-path-picker-chips');
  if (selected.length === 0) {
    if (!emptyText) return;
    const empty = createSpan();
    empty.className = 'bzrv-path-picker-chips-empty';
    empty.textContent = emptyText;
    container.appendChild(empty);
    return;
  }
  for (const path of selected) {
    const label = path === '' ? t('pk.root') : path;
    const chip = createSpan();
    chip.className = 'bzrv-path-picker-chip' + (onChipClick ? ' bzrv-path-picker-chip--click' : '');
    const name = createSpan();
    name.className = 'bzrv-path-picker-chip-name';
    name.textContent = label;
    if (onChipClick) name.onclick = () => onChipClick(path);
    const x = createEl('button');
    x.className = 'bzrv-path-picker-chip-x';
    x.textContent = '✕';
    x.appendChild(Object.assign(createSpan(), { className: 'bzrv-sr-only', textContent: t('pk.removeLabel', { label }) }));
    x.onclick = () => onChange(selected.filter((p) => p !== path));
    chip.appendChild(name);
    chip.appendChild(x);
    container.appendChild(chip);
  }
}

/* ==================== 设置行助手（chips + 选择…/添加…按钮，无手输输入框） ==================== */

export interface PathSettingRowOptions {
  /** 挂载容器（分组卡片 body / 设置页容器） */
  parent: HTMLElement;
  name: string;
  desc?: string;
  /** single = 单值（chips 至多一个，✕ 清除即未选择）；multi = 多值 */
  mode: 'single' | 'multi';
  /** 当前值：单值 = 路径字符串（'' = 未选择）；多值 = 数组 */
  value: string | string[];
  /** 选择器标题（缺省用 name） */
  pickerTitle?: string;
  /** 选择器内补充说明 */
  pickerDesc?: string;
  /** 按钮文案（缺省：single → 「选择…」；multi → 「添加…」） */
  buttonText?: string;
  /** 确定按钮文案（透传选择器） */
  okText?: string;
  /** 绑定值为空时的回落展示 chip（锁定态，只显示实际生效目录、不落盘；点击重开选择器改显式值）。
   *  与设置面板 settings-panel/renderer.ts 的 fallbackChip 同一语义——两个渲染器必须同口径，
   *  否则同一个 schema 在「域内 ⚙️ 弹窗」和「设置面板」显示两种样子（2026-10-31 图片目录行踩到）。 */
  fallbackChip?: string;
  /** 空态文案（ticket 133 起废弃：设置行空态只显示按钮、不渲染占位文字；字段保留兼容 schema 传参，实现不再读取） */
  emptyText?: string;
  /** 选择器确定 / chip ✕ 移除后的统一回调（list = 最新目录清单；单值 [] = 未选择）。
   *  返回 string[]（或其 Promise）= 改写/否决后的最终清单（如异步确认被取消时回退旧值），
   *  行内 chips 与按钮以该返回值重渲染；返回 void = 以 list 为准。 */
  onChange: (list: string[]) => void | string[] | Promise<void | string[]>;
}

/** 构建路径设置行（2026-11-21 统一成数据目录样式）：Setting（名称/描述）+ 控件区一颗
 *  「文件夹图标 + 当前路径 + 选择」的 pill。已选时每个目录一颗同形 pill，右侧 ✕ 移除；
 *  点击 pill 本身重开选择器。空态 pill 写「选择文件夹」，有回落值时把回落目录写进 pill。
 *  控件区仍只有一层包裹（markSettingSplitRows 不拆行），移动端名称/描述与控件区同行。
 *  不保留手输文本框（ADR-0061 拍板 3：路径一律经选择器录入，限 vault 内）。
 *  返回 { refresh } 供外部按需重渲染（如设置被其他入口改动后回同步）。 */
export function renderPathSettingRow(opts: PathSettingRowOptions): { refresh: () => void; settingEl: HTMLElement } {
  const readValue = (): string[] => {
    const v = opts.value;
    return Array.isArray(v) ? [...v] : v ? [v] : [];
  };
  let current = readValue();
  const setting = new Setting(opts.parent).setName(opts.name);
  if (opts.desc) setting.setDesc(opts.desc);
  setting.settingEl.classList.add('bzrv-path-picker-setting-row');

  /** 统一变更入口：onChange 返回 Promise 时异步解析改写清单后重渲染；同步返回（含 void）立即重渲染。
   *  N6：域回调同步抛错 / 异步 reject → 人话提示 + 保持旧选中（current 未动，renderAll 回滚）。 */
  const apply = (list: string[]): void | Promise<void> => {
    try {
      const res = opts.onChange(list);
      if (res && typeof (res as { then?: unknown }).then === 'function') {
        return Promise.resolve(res as Promise<void | string[]>)
          .then((final) => {
            current = Array.isArray(final) ? final : list;
            renderAll();
          })
          .catch((e) => {
            notifySaveError(e, opts.name);
            renderAll(); // 回滚：current 保持旧选中
          });
      }
      current = Array.isArray(res) ? res : list;
      renderAll();
    } catch (e) {
      notifySaveError(e, opts.name);
      renderAll(); // 回滚：current 保持旧选中
    }
  };

  const openPicker = () =>
    openPathPicker({
      title: opts.pickerTitle || opts.name,
      desc: opts.pickerDesc,
      mode: opts.mode,
      selected: current,
      okText: opts.okText,
      onConfirm: (list) => {
        void apply(list);
      },
    });

  const control = setting.settingEl.querySelector('.setting-item-control');
  const picks = createDiv({ cls: 'bzrv-path-picker-picks' });
  if (control) control.appendChild(picks);

  /** 一颗 path pill：文件夹图标 + 路径 + 「选择」；整颗可点 = 重开选择器 */
  const pickPill = (parent: HTMLElement, label: string, empty: boolean): HTMLButtonElement => {
    const btn = parent.createEl('button', { cls: 'bzrv-path-pick', type: 'button' });
    if (empty) btn.classList.add('bzrv-path-pick--empty');
    btn.createSpan({ cls: 'bzrv-sr-only', text: empty ? t('pk.chooseFolder') : t('pk.changeFolder', { label }) });
    const icon = btn.createSpan({ cls: 'bzrv-path-pick-icon' });
    setIcon(icon, 'folder');
    btn.createSpan({ cls: 'bzrv-path-pick-name', text: label });
    btn.createSpan({ cls: 'bzrv-path-pick-action', text: opts.buttonText || t('pk.choose') });
    btn.onclick = openPicker;
    return btn;
  };

  const render = () => {
    picks.empty();
    if (current.length === 0) {
      pickPill(picks, opts.fallbackChip || t('pk.notChosen'), true);
      return;
    }
    for (const p of current) {
      const wrap = picks.createDiv({ cls: 'bzrv-path-pick-wrap' });
      pickPill(wrap, p || t('pk.root'), false);
      const rm = wrap.createEl('button', { cls: 'bzrv-path-pick-remove', type: 'button' });
      rm.createSpan({ cls: 'bzrv-sr-only', text: t('pk.removeFolder', { path: p || t('deck.root') }) });
      setIcon(rm, 'x');
      rm.onclick = () => {
        void apply(current.filter((x) => x !== p));
      };
    }
  };

  const renderAll = () => render();
  const refresh = () => {
    current = readValue();
    render();
  };
  render();
  return { refresh, settingEl: setting.settingEl };
}

/* ==================== 目录选择器（Obsidian 原生，2026-11-20 起） ====================
 * 原来这里是一张自绘卡片弹窗（搜索框 + 列表 + 新建文件夹 + 确定 / 取消）。
 * 2026-11-20 反馈：换成 Obsidian 自己的快速选择器（FuzzySuggestModal），与 bz-reader 同款
 * 手感——搜索、键盘上下、Esc 全走宿主原生。Modal 本体在 folder-pick.ts（依赖宿主，真机验），
 * 纯口径在 folder-pick-logic.ts（node 单测）。
 *
 * 显隐是运行时值：系统文件夹选择器（本文件下半）仍用 DISPLAY_NONE，避免静态样式误判。 */
const DISPLAY_NONE = 'none';

/** 关闭当前选择器。原生 FuzzySuggestModal 由宿主按 Esc 自行关闭，无需插件清浮层；
 *  保留这个导出兼容可能的外部 import（当前仓库内无调用）。 */
export function closePathPicker(): void { /* no-op：原生 modal 自管生命周期 */ }

/** 两次选择是否同一集合（顺序无关） */
function sameSelection(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

/** 打开目录选择器（原生）：单选选一项即回；多选连续选、按 Esc 提交已选集合。
 *  签名保持不变，设置面板数据目录 / 监听文件夹 / 出题文件夹三个调用点无需改动。 */
export function openPathPicker(opts: PathPickerOptions): void {
  const app = getApp();
  const mode: 'single' | 'multi' = opts.mode === 'multi' ? 'multi' : 'single';
  const current = normalizePicked(opts.selected || []);
  void pickFolderNative(app, { title: opts.title, mode, selected: current }).then((list) => {
    const picked = normalizePicked(list);
    if (mode === 'single' && picked.length === 0) return; // 单选取消 = 不回调（沿用原语义）
    if (sameSelection(picked, current)) return;           // 没变化就不打扰（多选 Esc 直接退出）
    opts.onConfirm(picked);
  });
}
/* ==================== 系统文件夹选择器（vault 外，issue 457） ==================== */

/**
 * 系统文件夹选择器：走宿主原生目录对话框，可选 **vault 之外** 的目录（脸谱数据源这类
 * 「外部工具产出目录」用；vault 内目录一律走 openPathPicker，库内路径可渲染、库外不可）。
 *
 * 原生链（无 Obsidian API，逐级兜底）：
 * 1. Electron 远程对话框：`@electron/remote`.dialog.showOpenDialog（新版宿主）→
 *    `electron.remote`.dialog（旧版宿主）；用户取消 → null。
 * 2. `<input type="file" webkitdirectory>`：选中目录内任一文件后取父目录。Electron ≥32
 *    已删 `File.path`，故路径经 `electron.webUtils.getPathForFile` 取（两条都试）。
 * 3. 都不行（移动端 / 浏览器）→ null，调用侧按「用户取消」处理，不弹错。
 *
 * 返回值统一正斜杠归一（域侧一律 `${dir}/${name}` 拼接，Windows 反斜杠混拼易漏）。
 * （历史）旧评审壳曾经 setSystemFolderPicker 注入构造目录演示同一交互。
 */
export type SystemFolderPicker = () => Promise<string | null>;

/** 注入点（仅测试用；插件端不注入 = 原生链） */
let systemPickerImpl: SystemFolderPicker | null = null;

/** 注入演示级选择器（传 null 复原原生链） */
export function setSystemFolderPicker(fn: SystemFolderPicker | null): void {
  systemPickerImpl = fn;
}

/** Electron / dialog 的最小可见面：本文件只用到这些字段（真模块结构更大，取交集即可） */
interface ElectronDialogLike {
  showOpenDialog?: (options: unknown) => Promise<{ canceled?: boolean; filePaths?: string[] }>;
}
interface NodeElectronModule {
  webUtils?: { getPathForFile?: (f: File) => string | null | undefined };
  remote?: { dialog?: ElectronDialogLike } | null;
  dialog?: ElectronDialogLike;
}

/** 取宿主 node 侧模块（非桌面宿主无 require → null） */
function requireNode(moduleName: string): NodeElectronModule | null {
  try {
    const w = window as unknown as { require?: (m: string) => unknown };
    const m = w.require ? w.require(moduleName) : null;
    return m && typeof m === 'object' ? m : null;
  } catch {
    return null;
  }
}

/** 路径归一：反斜杠 → 正斜杠、去尾斜杠（保留根盘符 `D:`） */
function normalizeSystemPath(p: string): string {
  const s = String(p ?? '').trim().replace(/\\/g, '/');
  return s.length > 1 ? s.replace(/\/+$/, '') : s;
}

/** 取父目录（输入 = 目录内任一文件的绝对路径） */
function parentDirOf(filePath: string): string {
  const s = String(filePath).replace(/\\/g, '/');
  const i = s.lastIndexOf('/');
  return i <= 0 ? s : s.slice(0, i);
}

/**
 * File 对象的磁盘绝对路径：旧 Electron 的 `File.path` → 新 Electron 的 `webUtils.getPathForFile`。
 *
 * 导出是因为凡是从 `<input type="file">` 反推磁盘位置的地方都得走这两条 ——
 * Electron ≥32 删了 `File.path`，只读它的写法在新宿主上一律拿到空串（工具坞
 * 「导入脚本」就栽在这里）。别在外面对 `file.path` 再写一遍。
 */
export function fileDiskPath(f: File): string {
  const legacy = (f as File & { path?: string }).path;
  if (typeof legacy === 'string' && legacy) return legacy;
  const webUtils = requireNode('electron')?.webUtils;
  if (webUtils?.getPathForFile) {
    try {
      return String(webUtils.getPathForFile(f) ?? '');
    } catch {
      /* 取不到当没有 */
    }
  }
  return '';
}

/** 兜底链二：webkitdirectory 输入框（选中目录内任一文件，取其父目录） */
function pickDirViaInput(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = createEl('input');
    input.type = 'file';
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
    input.style.display = DISPLAY_NONE;
    markOwned(input);
    document.body.appendChild(input);
    let settled = false;
    const finish = (v: string | null): void => {
      if (settled) return;
      settled = true;
      window.removeEventListener('focus', onFocus);
      input.remove();
      resolve(v);
    };
    // 取消检测：对话框关闭后窗口回焦、而 change 未派发（迟 200ms 让 change 先行）
    const onFocus = (): void => {
      window.setTimeout(() => {
        const f = input.files?.[0];
        if (!f) finish(null);
      }, 200);
    };
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      const p = f ? fileDiskPath(f) : '';
      finish(p ? parentDirOf(p) : null);
    });
    window.addEventListener('focus', onFocus);
    input.click();
  });
}

/** 原生链：Electron 对话框优先，webkitdirectory 兜底 */
async function nativePickSystemFolder(): Promise<string | null> {
  const remote = requireNode('@electron/remote') ?? requireNode('electron')?.remote ?? null;
  const dialog = remote?.dialog;
  if (dialog?.showOpenDialog) {
    const res = await dialog.showOpenDialog({
      title: t('pk.chooseFolder'),
      properties: ['openDirectory', 'dontAddToRecent'],
    });
    const picked = res?.filePaths?.[0];
    if (picked && !res?.canceled) return normalizeSystemPath(picked);
    return null; // 用户取消：不再落兜底（否则会连开两次对话框）
  }
  return pickDirViaInput();
}

/** 弹出系统文件夹选择器。返回绝对路径（正斜杠归一）；null = 取消 / 环境不支持（不弹错） */
export async function pickSystemFolder(): Promise<string | null> {
  try {
    const pick = systemPickerImpl ?? nativePickSystemFolder;
    const dir = await pick();
    return dir ? normalizeSystemPath(dir) : null;
  } catch (e) {
    notifyActionError(e, t('pk.chooseFolder'));
    return null;
  }
}

/** 文件多选过滤器（name = 组名，ext = 不带点的扩展名表） */
export interface PickFilesFilter {
  name: string;
  ext: string[];
}

/**
 * 弹出系统**文件**多选对话框（vault 内外都行；509 补充素材的图片 / 录音导入用）。
 * 只走 Electron 原生链（多文件路径无 input 兜底——Electron ≥32 已删 File.path）；
 * 取消 / 环境不支持返回空数组（不弹错）。路径正斜杠归一。
 */
export async function pickSystemFiles(title: string, filters: PickFilesFilter[]): Promise<string[]> {
  const remote = requireNode('@electron/remote') ?? requireNode('electron')?.remote ?? null;
  const dialog = remote?.dialog;
  if (!dialog?.showOpenDialog) return [];
  try {
    const res = await dialog.showOpenDialog({
      title,
      properties: ['openFile', 'multiSelections', 'dontAddToRecent'],
      // Electron 认 extensions 字段（PickFilesFilter.ext 是域侧叫法，这里做一次映射）
      filters: filters.map((f) => ({ name: f.name, extensions: f.ext })),
    });
    if (res?.canceled) return [];
    return (res?.filePaths ?? []).map((p) => normalizeSystemPath(p)).filter(Boolean);
  } catch (e) {
    notifyActionError(e, t('pk.chooseFile'));
    return [];
  }
}