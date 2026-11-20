/* ============================================================
 * 打开笔记里的那一段（review/note-jump.ts）
 *
 * 选段卡的原文存在库里的笔记中，不在卡上。「回到原文」要做到两件事：
 *   1. 打开那篇笔记（文件可能被移走 → 静默返回 false，调用方给人话提示）；
 *   2. 把加入时记下的字符范围重新选中，让人一眼看到当时复习的是哪句。
 *
 * obsidian 只做 type-only import：文件位置 / 编辑器形态全靠 app 参数注入，
 * 这样 node 测试能 import 本模块而不拉进宿主运行时。真机行为走 obsidian-visual-test。
 * ============================================================ */
import type { App } from 'obsidian';
import type { NoteSource } from './note-source';

/** 鸭子类型：不 import TFile 运行时值，只看路径与扩展名 */
interface FileLike {
  path: string;
  extension?: string;
}

interface EditorLike {
  offsetToPos(offset: number): { line: number; ch: number };
  setSelection(from: { line: number; ch: number }, to: { line: number; ch: number }): void;
  scrollIntoView(range: { from: { line: number; ch: number }; to: { line: number; ch: number } }, center?: boolean): void;
}

interface ViewLike {
  editor?: EditorLike;
}

interface LeafLike {
  view: ViewLike;
  openFile(file: unknown, opts?: unknown): Promise<unknown>;
}

/**
 * 打开文件并选中记下的范围；返回是否真的打开了。
 * 用 workspace.getLeaf(false) 复用当前标签页，避免每复习一张就堆一个 tab。
 */
export async function jumpToSourceNote(app: App, src: NoteSource): Promise<boolean> {
  const ws = (app as unknown as { workspace: { getLeaf: (newLeaf: boolean) => LeafLike } }).workspace;
  const vault = (app as unknown as { vault: { getAbstractFileByPath(path: string): unknown } }).vault;
  const file = vault?.getAbstractFileByPath(src.path) as FileLike | null;
  if (!file || typeof file.path !== 'string') return false;
  const leaf = ws?.getLeaf?.(false);
  if (!leaf) return false;
  await leaf.openFile(file, { active: true });
  /* openFile 返回的 Promise 在页面挂载前就可能 resolve；下一帧再设选区，
     否则拿到的还是上一份文档的 editor。两次 requestAnimationFrame 更稳。 */
  await nextFrame();
  await nextFrame();
  const editor = leaf.view?.editor;
  if (!editor || typeof editor.offsetToPos !== 'function') return true; // 文件已打开，选区没设上也不算失败
  try {
    const from = editor.offsetToPos(src.from);
    const to = editor.offsetToPos(src.to);
    editor.setSelection(from, to);
    editor.scrollIntoView({ from, to }, true);
  } catch {
    /* 笔记被改短、范围越界：文件还是打开了，不把人困在报错里 */
  }
  return true;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    const raf = (cb: () => void): void => { window.requestAnimationFrame(cb); };
    raf(() => resolve());
  });
}
