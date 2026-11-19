/* ============================================================
 * bz · Anki 文件导入（review/anki-import.ts，2026-11-20）
 *
 * 从库里挑一份 Anki 导出的文本，按 anki-cards.ts 解析后入复习计划。
 * 解析是纯函数（可单测），这里只管 Obsidian 的文件选择与提示。
 * ============================================================ */
import { FuzzySuggestModal, TFile, type App } from 'obsidian';
import { notice } from '../core/notice';
import { parseAnkiCards } from './anki-cards';
import type { ReviewDataManager } from './data';

/* Obsidian 的 file.extension 返回不带点的名字（"tsv" 而非 ".tsv"），
   这里直接匹配扩展名本身；兼容带点写法只是防御。 */
const ANKI_EXT = /^\.?(txt|tsv|csv)$/i;

/** Anki 文件选择器：库里所有文本文件，Ctrl+O 那套搜索/键盘手感 */
class AnkiFileModal extends FuzzySuggestModal<TFile> {
  constructor(app: App, private onPick: (file: TFile) => void) {
    super(app);
    this.setTitle('选择 Anki 导出文件');
    this.setPlaceholder('搜文件名，选一份 Anki 导出的 .txt / .tsv');
  }

  getItems(): TFile[] {
    return this.app.vault
      .getFiles()
      .filter((f) => ANKI_EXT.test(f.extension))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onPick(file);
  }
}

/** 打开选择器导入；从命令面板与设置页按钮都走这里 */
export async function importAnkiFromPicker(app: App, dm: ReviewDataManager): Promise<void> {
  const pick = (file: TFile): void => {
    void (async () => {
      const raw = await app.vault.cachedRead(file);
      const cards = parseAnkiCards(raw, file.path, file.basename);
      if (!cards.length) {
        notice('这份文件里没认出 Anki 卡片（认 Tab 分隔问答 / {{c1::挖空}}）', 'warning');
        return;
      }
      const { importCardsFromMarkdown } = await import('./backup-io');
      const res = await importCardsFromMarkdown(dm, cards);
      const qa = cards.filter((c) => c.syntax === 'qa').length;
      const cloze = cards.filter((c) => c.syntax === 'cloze').length;
      notice(
        `Anki 导入 ${res.added} 张（问答 ${qa} / 挖空 ${cloze}）` +
          (res.skipped ? `，跳过 ${res.skipped} 张（已存在）` : '') +
          (res.rejected ? `，${res.rejected} 张超出基础版上限` : ''),
        res.added ? 'success' : 'warning',
      );
      const { reviewApp } = await import('./app');
      void reviewApp.refreshPanel();
    })();
  };

  const files = app.vault.getFiles().filter((f) => ANKI_EXT.test(f.extension));
  if (!files.length) {
    notice('库里没有 .txt / .tsv 文件，先把 Anki 导出文件放进库', 'warning');
    return;
  }
  new AnkiFileModal(app, pick).open();
}

/** 导入当前激活文件（命令面板直接从打开的 Anki 文件导入，省一步选择） */
export async function importAnkiFromActiveFile(app: App, dm: ReviewDataManager): Promise<void> {
  const file = app.workspace.getActiveFile();
  if (!file || !ANKI_EXT.test(file.extension)) {
    await importAnkiFromPicker(app, dm);
    return;
  }
  const raw = await app.vault.cachedRead(file);
  const cards = parseAnkiCards(raw, file.path, file.basename);
  if (!cards.length) {
    notice('这份文件里没认出 Anki 卡片（认 Tab 分隔问答 / {{c1::挖空}}）', 'warning');
    return;
  }
  const { importCardsFromMarkdown } = await import('./backup-io');
  const res = await importCardsFromMarkdown(dm, cards);
  notice(
    `Anki 导入 ${res.added} 张` +
      (res.skipped ? `，跳过 ${res.skipped} 张（已存在）` : '') +
      (res.rejected ? `，${res.rejected} 张超出基础版上限` : ''),
    res.added ? 'success' : 'warning',
  );
  const { reviewApp } = await import('./app');
  void reviewApp.refreshPanel();
}
