/**
 * 原生目录选择器（core/folder-pick.ts）
 *
 * 2026-11-20 起，所有「选目录」弹窗从自绘卡片弹窗（core/path-picker.ts 的 openPathPicker）
 * 换成 Obsidian 自己的 FuzzySuggestModal —— 与 Ctrl+O 快速切换同一套手感：搜索、键盘上下、
 * Esc 关闭都走宿主原生。用法与 bz-reader 的 core/folder-pick.ts 对齐。
 *
 * 多选（mode='multi'）：FuzzySuggestModal 选一个就自动 close，所以每次 onChooseItem 把项累加
 * 后再 open() 重开，Esc / 点空白时用已选集合兑现 Promise。注意宿主是「先 close、后
 * onChooseItem」，两者同一调用栈——用 setTimeout 延后提交，让 onChooseItem 先落定。
 */
import { FuzzySuggestModal, TFolder, type App } from 'obsidian';
import { folderItemText, folderPickPlaceholder, togglePicked } from './folder-pick-logic';

export interface NativeFolderPickOptions {
  /** 弹窗标题（缺省「选择文件夹」） */
  title?: string;
  /** single = 选一个即提交；multi = 连续选，Esc 提交已选集合 */
  mode?: 'single' | 'multi';
  /** 初始已选（vault 相对路径；'' = 库根） */
  selected?: string[];
}

export class FolderPickModal extends FuzzySuggestModal<TFolder> {
  private resolve: (v: string[]) => void = () => undefined;
  private settled = false;
  private closeTimer: number | null = null;
  private picked: string[];
  private readonly mode: 'single' | 'multi';

  constructor(app: App, private opts: NativeFolderPickOptions = {}) {
    super(app);
    this.mode = opts.mode === 'multi' ? 'multi' : 'single';
    this.picked = [...(opts.selected ?? [])];
    this.setTitle(opts.title || '选择文件夹');
    this.refreshPlaceholder();
  }

  /** 打开并等待提交：单选返回 [路径]，多选返回已选集合（取消 = 初始已选）。 */
  pick(): Promise<string[]> {
    return new Promise<string[]>((resolve) => {
      this.resolve = resolve;
      this.open();
    });
  }

  private refreshPlaceholder(): void {
    this.setPlaceholder(folderPickPlaceholder(this.mode, this.picked.length));
  }

  /** 所有加载的文件夹（TFolder 天然含空目录、排除文件），按路径排序；库根在最前 */
  getItems(): TFolder[] {
    const folders = this.app.vault
      .getAllLoadedFiles()
      .filter((f): f is TFolder => f instanceof TFolder);
    folders.sort((a, b) => (a.path === '' ? -1 : b.path === '' ? 1 : a.path.localeCompare(b.path)));
    return folders;
  }

  getItemText(f: TFolder): string {
    return folderItemText(f.path, this.picked, this.mode);
  }

  onChooseItem(f: TFolder): void {
    const path = f.path; // 库根 = ''
    if (this.mode === 'single') {
      this.settle([path]);
      return;
    }
    // 多选：累加 / 取消这一项，再重开弹窗继续选
    this.picked = togglePicked(this.picked, path);
    this.refreshPlaceholder();
    this.closeTimer = null; // 这次 close 是 choose 触发的，不当「取消」
    this.open();
  }

  onClose(): void {
    super.onClose();
    if (this.closeTimer !== null) window.clearTimeout(this.closeTimer);
    // 宿主 selectSuggestion 先 close 后 onChooseItem：延后一拍，让 onChooseItem 先累加 / 重开；
    // 只有真的关掉（Esc / 点空白）才会走到这里的 setTimeout，按当前已选提交。
    this.closeTimer = window.setTimeout(() => this.settle([...this.picked]), 0);
  }

  private settle(v: string[]): void {
    if (this.settled) return;
    this.settled = true;
    if (this.closeTimer !== null) {
      window.clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
    this.resolve(v);
  }
}

/** 打开原生文件夹选择器。单选返回 [路径]；多选返回连续选择后的集合。 */
export function pickFolderNative(app: App, opts: NativeFolderPickOptions = {}): Promise<string[]> {
  return new FolderPickModal(app, opts).pick();
}
