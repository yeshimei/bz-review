/* ============================================================
 * bz · Anki 文本导入解析（review/anki-cards.ts，2026-11-20，纯函数）
 *
 * Anki（读作「安基」，源自日语「暗记」，最出名的间隔重复制卡软件）导出的
 * 纯文本/TSV 每行一张卡：
 *   · 基础卡：正面<TAB>背面（列数更多时只取前两列）
 *   · 挖空卡：正文里带 {{c1::答案}} / {{c2::答案::提示}}，可带附加列
 *
 * 本仓的挖空引擎用 {{1}} + blanks 数组（见 cloze.ts），所以导入时把 Anki 的
 * {{cN::答案}} 转成 {{序号}}（按出现顺序重编号），答案收进 blanks。
 * 解析刻意窄：只认这两种，空行/注释行跳过，不猜「这行看着像卡片」。
 * ============================================================ */
import type { ReviewCard } from './data';

export interface ParsedAnkiCard {
  card: ReviewCard;
  /** 这行认成哪种卡 */
  syntax: 'qa' | 'cloze';
}

/** Anki 挖空标记：{{c1::答案}} 或 {{c1::答案::提示}}，提示部分忽略 */
const ANKI_CLOZE_RE = /\{\{c(\d+)::([^}]+?)(?:::[^}]*)?\}\}/g;

/** 把 Anki 挖空标记换成 {{序号}}，按出现顺序重编号；返回正文与各空答案 */
function convertCloze(raw: string): { text: string; blanks: string[] } | null {
  const blanks: string[] = [];
  let slot = 0;
  const text = String(raw ?? '').replace(ANKI_CLOZE_RE, (_m, _num: string, answer: string) => {
    const a = String(answer ?? '').trim();
    if (!a) return '';
    slot += 1;
    blanks.push(a);
    return `{{${slot}}}`;
  });
  return blanks.length ? { text: text.trim(), blanks } : null;
}

/**
 * 解析 Anki 导出的 TSV 文本。
 *
 * key 用 `anki:<来源>#<行号>`：同一份文件反复导入按钥匙去重，不会重复排卡；
 * 文件里同一行内容改了就是另一把钥匙（导入结果里报数说清）。
 */
export function parseAnkiCards(content: string, sourcePath: string, title?: string): ParsedAnkiCard[] {
  const lines = String(content ?? '').split(/\r?\n/);
  const out: ParsedAnkiCard[] = [];
  const seen = new Set<string>();
  const book = String(title || sourcePath.split('/').pop()?.replace(/\.(txt|tsv|csv)$/i, '') || sourcePath);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    /* Anki 导出偶尔带 #separator:Tab 之类的头，跳过 */
    if (/^#/.test(line.trim())) continue;

    const cells = line.split('\t').map((c) => c.trim());
    const first = cells[0] ?? '';
    const second = cells[1] ?? '';
    if (!first && !second) continue;
    const key = `anki:${sourcePath}#${i}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const cloze = convertCloze(first);
    if (cloze) {
      out.push({
        syntax: 'cloze',
        card: {
          key,
          bookTitle: book,
          text: cloze.text,
          /* 列表标题去掉 {{1}} 标记（跟 AI 挖空卡回填口径一致），别让用户看到占位符 */
          displayTitle: cloze.text.replace(/\{\{\d+\}\}/g, '').trim(),
          mode: 'cloze',
          cloze: { text: cloze.text, blanks: cloze.blanks, at: Date.now() },
          backlink: `obsidian://open?path=${encodeURIComponent(sourcePath)}`,
        },
      });
      continue;
    }

    /* 基础卡：正面 + 背面；背面空则跳过（不能造一张背面白卡的卡） */
    if (!first || !second) continue;
    out.push({
      syntax: 'qa',
      card: {
        key,
        bookTitle: book,
        text: second,
        displayTitle: first,
        mode: 'flashcard',
        qa: { q: first, a: second, at: Date.now() },
        backlink: `obsidian://open?path=${encodeURIComponent(sourcePath)}`,
      },
    });
  }

  return out;
}
