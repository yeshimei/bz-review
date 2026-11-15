/**
 * 从 Markdown 笔记里认出卡片（批 4，纯函数）。
 *
 * 为什么要收这一种输入：手写卡片的人（`Q :: A`、`{{cloze}}`）在 Obsidian 圈子里
 * 早就有自己的写法，而这个插件此前只认「从阅读器划线进来」，等于把这批人挡在门外。
 * 认法刻意窄：只认明确的两种语法，不猜「这一行看着像问题」。
 *
 * 钥匙用 `md:<文件路径>#<序号>`：同一篇笔记反复导入不会重复排卡（addCards 按钥匙去重），
 * 但改了文本会变成另一把钥匙——这点在导入结果的提示里说清楚。
 */
import type { ReviewCard } from './data';

export interface ParsedCard {
  card: ReviewCard;
  /** 这行是用哪种语法认出来的（导入结果里分项报数用） */
  syntax: 'qa' | 'cloze';
}

/** `问题 :: 答案`（允许用全角冒号写法 `问题：：答案`） */
const QA_RE = /^\s*(?:[-*+]\s+|\d+[.)]\s+)?(.+?)\s*(?:：：|::)\s*(.+?)\s*$/;
/** 行内挖空 `{{...}}` 或 `==...==` */
const CLOZE_RE = /\{\{(.+?)\}\}|==(.+?)==/;

function stripMd(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^\s*>\s?/, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/[*_`]/g, '')
    .trim();
}

/**
 * 解析整篇笔记。
 *
 * 只扫正文行：代码块、frontmatter、行内代码里的内容不算卡片——
 * 一篇写满语法的技术笔记，不该导进几十张假卡。
 */
export function parseMarkdownCards(content: string, filePath: string, title?: string): ParsedCard[] {
  const lines = String(content ?? '').split(/\r?\n/);
  const out: ParsedCard[] = [];
  const seen = new Set<string>();
  let inFence = false;
  let inFrontmatter = false;
  let index = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (i === 0 && line === '---') {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter) {
      if (line === '---') inFrontmatter = false;
      continue;
    }
    if (/^```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !line) continue;

    const qa = QA_RE.exec(line);
    if (qa) {
      const q = stripMd(qa[1]);
      const a = stripMd(qa[2]);
      if (!q || !a) continue;
      const key = `md:${filePath}#${index++}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        syntax: 'qa',
        card: {
          key,
          bookTitle: title || filePath.split('/').pop()?.replace(/\.md$/i, '') || filePath,
          chapterTitle: q.slice(0, 40),
          text: a,
          comment: q,
          qa: { q, a, at: Date.now() },
          backlink: `obsidian://open?path=${encodeURIComponent(filePath)}`,
        },
      });
      continue;
    }

    const cloze = CLOZE_RE.exec(line);
    if (cloze) {
      const answer = stripMd(cloze[1] ?? cloze[2] ?? '');
      if (!answer) continue;
      const text = stripMd(raw.replace(/\{\{(.+?)\}\}/g, '{{$1}}').replace(/==(.+?)==/g, '==$1=='));
      const key = `md:${filePath}#${index++}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        syntax: 'cloze',
        card: {
          key,
          bookTitle: title || filePath.split('/').pop()?.replace(/\.md$/i, '') || filePath,
          text,
          cloze: { text: text.replace(/\{\{(.+?)\}\}|==(.+?)==/g, '{{1}}'), blanks: [answer], at: Date.now() },
          backlink: `obsidian://open?path=${encodeURIComponent(filePath)}`,
        },
      });
    }
  }

  return out;
}
