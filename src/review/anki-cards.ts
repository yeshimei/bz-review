/* ============================================================
 * bz · Anki 文本导入解析（review/anki-cards.ts，2026-11-20，纯函数）
 *
 * 目标不是「读个大概」，而是**把 Anki 的纯文本导出尽量完整地搬过来**。
 * Anki（读作「安基」，源自日语「暗记」，最出名的间隔重复制卡软件）的
 * 「笔记纯文本 / Notes in Plain Text」导出并不是简单的一行两列：
 *
 *   · 文件头可以声明分隔符、HTML、以及「牌组 / 笔记类型 / 标签 / GUID」各占第几列；
 *   · 字段里的换行与分隔符用双引号包起来，引号本身写成两个双引号；
 *   · 字段默认带网页格式（<br>、<div>、<b>、&nbsp;…），图片与音频只是引用；
 *   · 一条笔记可能对应 Anki 里的多张卡：每个挖空编号一张、正反模板两张。
 *
 * 这里把这些都按官方格式读掉，再翻译成本仓的卡片形态：
 *   · 问答 → 抽认卡（前两列；后面的字段并入答案，不丢）
 *   · {{c1::答案}} → {{n}} + blanks，按挖空编号拆成多张卡（与 Anki 卡数一致）
 *   · 「基础（含反向卡片）」→ 正反两张卡（可选反向需 Add Reverse 为 y）
 *
 * 解析是纯函数（不碰 DOM / Obsidian），能跑 node 单测；文件选择与写盘在
 * anki-import.ts。所有「读不进来」的行都会在 stats 里分原因记数，绝不静默吞掉。
 * ============================================================ */
import type { ReviewCard } from './data';
import { t } from '../i18n/strings';

export interface ParsedAnkiCard {
  card: ReviewCard;
  /** 这行认成哪种卡 */
  syntax: 'qa' | 'cloze';
  /**
   * 这行引用到的媒体文件名（basename，去重）。纯文本导出只带文件名不带文件；
   * 导入层按名字跟用户补选的媒体文件配对后，才把卡片指向库内真实路径。
   */
  mediaRefs?: string[];
}

export interface AnkiParseStats {
  /** 实际使用的分隔符（给人看：Tab / 逗号 / 分号 …） */
  separatorLabel: string;
  /** 是否按网页格式解析 */
  html: boolean;
  /** 数据行数（不含注释头与空行） */
  records: number;
  /** 认出来的笔记条数（一条笔记可能拆成多张卡） */
  notes: number;
  /** 最终产出的卡片数 */
  cards: number;
  /** 问答卡 / 挖空卡各多少 */
  qa: number;
  cloze: number;
  /** 由正反模板额外生成的卡数 */
  reversed: number;
  /** 含多个挖空编号、被拆成多张卡的笔记数 */
  multiCloze: number;
  /** 图片 / 音频引用数（文本导出不带文件，只能留占位文字） */
  media: number;
  /** 不同媒体文件名数（补选文件时按这个跟人对） */
  mediaNames: number;
  /** 其中成功配对到用户文件的引用数 */
  mediaMatched: number;
  /** 没配上文件的媒体文件名数 */
  mediaMissing: number;
  /** 补选文件撞名后自动改名的数量 */
  renamed: number;
  /** 图片遮挡卡导入成「图片+文字」卡的数量 */
  occlusion: number;
  /** 带标签的笔记数（标签写进卡片备注） */
  tagged: number;
  /** 跳过的数据行，按原因分 */
  skipped: {
    /** 整行为空 */
    empty: number;
    /** 字段不够认卡（例如只有一列又不是挖空） */
    short: number;
    /** 正面为空 */
    emptyFront: number;
    /** 背面为空 */
    emptyBack: number;
    /** 图片遮挡卡：文本导出里没有可用文字 */
    imageOcclusion: number;
    /** 挖空类型却没有挖空标记 */
    noCloze: number;
  };
}

export interface AnkiParseResult {
  cards: ParsedAnkiCard[];
  stats: AnkiParseStats;
}

/** Anki 文件头里认得的指令（小写） */
const HEADER_KEYS = new Set([
  'separator',
  'html',
  'columns',
  'notetype',
  'deck',
  'tags',
  'notetype column',
  'deck column',
  'tags column',
  'guid column',
]);

const SEPARATOR_MAP: Record<string, string> = {
  tab: '\t',
  comma: ',',
  semicolon: ';',
  pipe: '|',
  colon: ':',
  space: ' ',
};

const SEPARATOR_LABEL: Record<string, string> = {
  '\t': 'Tab',
  ',': t('anki.c.comma'),
  ';': t('anki.c.semicolon'),
  '|': t('anki.c.pipe'),
  ':': t('anki.c.colon'),
  ' ': t('anki.c.space'),
};

/** Anki 挖空标记：{{c1::答案}} 或 {{c1::答案::提示}} */
const ANKI_CLOZE_RE = /\{\{c(\d+)::([\s\S]*?)\}\}/g;

interface ClozeToken {
  start: number;
  end: number;
  num: number;
  answer: string;
}

/** 把一段文本里的 Anki 挖空标记找出来（答案与提示按第一个 :: 分开） */
function clozeTokens(text: string): ClozeToken[] {
  const out: ClozeToken[] = [];
  ANKI_CLOZE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ANKI_CLOZE_RE.exec(text))) {
    const body = m[2] ?? '';
    const hintAt = body.indexOf('::');
    const answer = (hintAt >= 0 ? body.slice(0, hintAt) : body).trim();
    out.push({ start: m.index, end: m.index + m[0].length, num: Number(m[1]), answer });
  }
  return out;
}

/**
 * 按「保留哪些挖空编号」渲染一段文本。
 * keep 为空 = 全部填上答案（用于卡片的正文）；keep 有值 = 这些编号变成 {{n}}，其余填答案。
 */
function renderCloze(
  text: string,
  tokens: ClozeToken[],
  keep: ReadonlySet<number> | null,
): { text: string; blanks: string[] } {
  let out = '';
  let last = 0;
  let slot = 0;
  const blanks: string[] = [];
  for (const t of tokens) {
    out += text.slice(last, t.start);
    if (keep && keep.has(t.num)) {
      slot += 1;
      out += `{{${slot}}}`;
      blanks.push(t.answer);
    } else {
      out += t.answer;
    }
    last = t.end;
  }
  out += text.slice(last);
  return { text: out.trim(), blanks };
}

/* ---------------- 文件头与分隔记录 ---------------- */

function splitHeader(content: string): { directives: Record<string, string>; body: string } {
  const lines = content.split(/\r?\n/);
  const directives: Record<string, string> = {};
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (!t) continue;
    const m = /^#\s*([a-z][a-z ]*?)\s*:\s*(.*)$/i.exec(t);
    if (m && HEADER_KEYS.has(m[1].toLowerCase())) {
      directives[m[1].toLowerCase()] = m[2].trim();
      continue;
    }
    /* 文件头区域的 # 行是注释；数据区里以 # 开头的字段不动（这里已经 break 了） */
    if (t.startsWith('#')) continue;
    break;
  }
  return { directives, body: lines.slice(i).join('\n') };
}

/** 分隔符：文件头优先，没写就按第一条数据行猜（Tab 最常见） */
function sniffSeparator(body: string): string {
  const firstLine = body.split(/\r?\n/).find((l) => l.trim()) ?? '';
  const tabs = (firstLine.match(/\t/g) || []).length;
  if (tabs > 0) return '\t';
  const semis = (firstLine.match(/;/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  if (semis > commas) return ';';
  if (commas > 0) return ',';
  return '\t';
}

/**
 * 按分隔符切记录：支持双引号包住换行/分隔符、双引号自身写成两个双引号。
 * 这是 Anki 文本导出的官方转义方式；不按行 split 才不会把一张卡拆成两半。
 */
function parseDelimited(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"' && field === '') {
      quoted = true;
    } else if (c === sep) {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  /* 收尾：最后一行没有换行符也要收进来；纯尾随换行不造空记录 */
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/* ---------------- 网页格式 → 纯文字 ---------------- */

function decodeEntities(raw: string): string {
  return raw.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]+);/gi, (all, body: string) => {
    const key = body.toLowerCase();
    if (key === 'nbsp') return ' ';
    if (key === 'amp') return '&';
    if (key === 'lt') return '<';
    if (key === 'gt') return '>';
    if (key === 'quot') return '"';
    if (key === 'apos') return "'";
    if (key === 'hellip') return '…';
    if (key === 'mdash') return '—';
    if (key === 'ndash') return '–';
    if (key === 'middot') return '·';
    if (key.startsWith('#x')) {
      const code = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : all;
    }
    if (key.startsWith('#')) {
      const code = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : all;
    }
    return all;
  });
}

function baseName(path: string): string {
  const s = String(path ?? '').replace(/\\/g, '/');
  return s.slice(s.lastIndexOf('/') + 1);
}

/**
 * Anki 的网页格式转纯文字：换行保留成 \n，图片/音频留可读占位，
 * 其余标签剥掉、实体解码。卡片在复习界面按纯文本显示（不会渲染 HTML），
 * 所以这一步不是「美化」，而是不做就会看到一堆 <div>&nbsp;。
 */
function htmlToText(raw: string, onMedia: (name: string) => void): string {
  let s = raw;
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<img\b[^>]*>/gi, (tag) => {
    const m = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const name = baseName(m?.[1] || m?.[2] || m?.[3] || '');
    if (name) onMedia(name);
    return name ? t('anki.imgPlaceholder', { name }) : t('anki.imgPlaceholderBare');
  });
  s = s.replace(/\[sound:([^\]]+)\]/gi, (_all, name: string) => {
    const file = baseName(name);
    if (file) onMedia(file);
    return t('anki.audioPlaceholder', { file });
  });
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(div|p|li|tr|h[1-6]|blockquote|table|section|article)>/gi, '\n');
  s = s.replace(/<li\b[^>]*>/gi, '· ');
  s = s.replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  s = s.replace(/\u00a0/g, ' ');
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

function looksLikeHtml(raw: string): boolean {
  return /<(br|div|p|span|b|i|u|strong|em|img|style|script|sup|sub|li|ul|ol|table|tr|td|font)\b[^>]*>/i.test(raw);
}

/* ---------------- 稳定钥匙 ---------------- */

/** FNV-1a 32 位：同一段内容在任何机器上算出同一把钥匙，重复导入才能按钥匙去重 */
function fnv1a(raw: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/* ---------------- 主解析 ---------------- */

function emptyStats(): AnkiParseStats {
  return {
    separatorLabel: 'Tab',
    html: true,
    records: 0,
    notes: 0,
    cards: 0,
    qa: 0,
    cloze: 0,
    reversed: 0,
    multiCloze: 0,
    media: 0,
    mediaNames: 0,
    mediaMatched: 0,
    mediaMissing: 0,
    renamed: 0,
    occlusion: 0,
    tagged: 0,
    skipped: { empty: 0, short: 0, emptyFront: 0, emptyBack: 0, imageOcclusion: 0, noCloze: 0 },
  };
}

/**
 * 解析整份 Anki 纯文本导出。
 *
 * `sourceName` 只用于没写牌组列时的分组名（书名）；`title` 可显式覆盖。
 * 返回每张卡 + 一份给人看的统计（跳过原因、媒体数、拆卡数都在里面）。
 */
export function parseAnkiFile(content: string, sourceName: string, title?: string): AnkiParseResult {
  const stats = emptyStats();
  const rawText = String(content ?? '').replace(/^\uFEFF/, '');
  const { directives, body } = splitHeader(rawText);

  const headerSep = (directives['separator'] || '').trim().toLowerCase();
  const separator =
    SEPARATOR_MAP[headerSep] || (headerSep.length === 1 ? headerSep : '') || sniffSeparator(body);
  stats.separatorLabel = SEPARATOR_LABEL[separator] || `「${separator}」`;

  const rows = parseDelimited(body, separator);
  const htmlFlag = (directives['html'] || '').trim().toLowerCase();
  const htmlHeader = htmlFlag === 'true' ? true : htmlFlag === 'false' ? false : null;

  const colOf = (key: string): number => {
    const n = Number.parseInt(directives[key] || '', 10);
    return Number.isFinite(n) && n > 0 ? n - 1 : -1;
  };
  const notetypeCol = colOf('notetype column');
  const deckCol = colOf('deck column');
  const tagsCol = colOf('tags column');
  const guidCol = colOf('guid column');
  const metaCols = new Set([notetypeCol, deckCol, tagsCol, guidCol].filter((i) => i >= 0));

  const defaultNotetype = (directives['notetype'] || '').trim();
  const globalTags = (directives['tags'] || '').trim();
  const defaultBook = String(title || baseName(sourceName).replace(/\.(txt|tsv|csv)$/i, '') || sourceName);

  /* 没有 html 头就按内容判断：Anki 旧版导出同样带标签，不能因为缺头就原样显示 */
  let html = htmlHeader ?? false;
  if (htmlHeader === null) {
    const first = rows.find((r) => r.some((c) => c.trim()));
    html = first ? looksLikeHtml(first.join('\t')) : false;
  }
  stats.html = html;

  const cards: ParsedAnkiCard[] = [];
  const now = Date.now();

  for (const cells of rows) {
    if (!cells.some((c) => c.trim())) continue;
    stats.records += 1;

    const cell = (idx: number): string => (idx >= 0 ? String(cells[idx] ?? '').trim() : '');
    const notetype = (cell(notetypeCol) || defaultNotetype).trim();
    const deck = cell(deckCol);
    const guid = cell(guidCol);
    const tagText = cell(tagsCol) || globalTags;

    const mediaRefs: string[] = [];
    const media = (name: string): void => {
      stats.media += 1;
      if (name && !mediaRefs.includes(name)) mediaRefs.push(name);
    };
    const fields: string[] = [];
    for (let i = 0; i < cells.length; i++) {
      if (metaCols.has(i)) continue;
      const rawCell = cells[i] ?? '';
      /* 非 HTML 行也可能带 [sound:…]（Anki 音频引用不依赖 html 头），一样收进来 */
      if (!html) {
        rawCell.replace(/\[sound:([^\]]+)\]/gi, (_all, name: string) => {
          media(baseName(name));
          return '';
        });
      }
      fields.push(html ? htmlToText(rawCell, media) : rawCell.trim());
    }
    stats.mediaNames += mediaRefs.length;

    const firstRaw = fields[0] ?? '';
    const secondRaw = fields[1] ?? '';
    const extras = fields.slice(2);

    if (!notetype && !firstRaw && !secondRaw) {
      stats.skipped.empty += 1;
      continue;
    }
    const book = (deck || defaultBook).trim() || defaultBook;

    if (/image\s*occlusion|图片遮挡|圖像遮擋/i.test(notetype)) {
      /*
       * 图片遮挡卡：Anki 的纯文本导出带得过来图片引用与零散文字，但遮罩的 SVG
       * 坐标不在文本里。按「图片 + 文字」导入成遮挡卡：图先挂上（配对成功后
       * 指向库内文件），遮挡区域留空——让用户之后在卡片管理器里点几下补。
       * 绝不静默跳过，免得用户以为整份牌组都导进来了。
       */
      const image = mediaRefs[0] ?? '';
      /* 正文取所有字段里的文字；挖空标记 {{c1::答案}} 还原成答案文本 */
      const spoken = fields
        .map((f) => renderCloze(f, clozeTokens(f), null).text)
        .filter(Boolean)
        .join('\n')
        .trim();
      const baseKey = guid
        ? `anki:guid:${guid}`
        : `anki:${fnv1a(`${notetype}\u0000${fields.join('\u0001')}`)}`;
      cards.push({
        syntax: 'qa',
        card: {
          key: baseKey,
          bookTitle: book,
          text: spoken || image,
          displayTitle: (spoken.split('\n')[0] || image || t('anki.occlusionCard')).slice(0, 40),
          comment: tagText ? t('anki.tagsLine', { tags: tagText }) : t('anki.occlusionNote'),
          mode: 'occlusion',
          occlusion: { image, regions: [] },
        },
        mediaRefs,
      });
      stats.occlusion += 1;
      stats.notes += 1;
      continue;
    }
    if (!firstRaw && !secondRaw) {
      stats.skipped.empty += 1;
      continue;
    }

    const comment = tagText ? t('anki.tagsLine', { tags: tagText }) : undefined;
    if (tagText) stats.tagged += 1;

    const ntLower = notetype.toLowerCase();
    const isClozeType = /cloze|挖空|填空/i.test(ntLower);
    const tokens = clozeTokens(firstRaw);

    if (tokens.length) {
      const full = renderCloze(firstRaw, tokens, null).text;
      const byNum = new Map<number, number>();
      for (const t of tokens) byNum.set(t.num, (byNum.get(t.num) ?? 0) + 1);
      const nums = [...byNum.keys()];
      if (nums.length > 1) stats.multiCloze += 1;

      const baseKey = guid ? `anki:guid:${guid}` : `anki:${fnv1a(`${notetype}\u0000${firstRaw}`)}`;
      /* Anki Cloze 类型第二列就是 Back Extra，第三列起是自定义字段——两处都接在正文后面，内容不丢 */
      const extraText = [secondRaw, ...extras.map((v) => v.trim())].filter(Boolean).join('\n');
      const clozeText = extraText ? `${full}\n${extraText}` : full;

      for (const n of nums) {
        const part = renderCloze(firstRaw, tokens, new Set([n]));
        if (!part.blanks.length) continue;
        cards.push({
          syntax: 'cloze',
          card: {
            key: `${baseKey}#c${n}`,
            bookTitle: book,
            text: clozeText,
            /* 列表标题去掉 {{1}} 标记（与其他挖空卡口径一致） */
            displayTitle: part.text.replace(/\{\{\d+\}\}/g, '').trim(),
            comment,
            mode: 'cloze',
            cloze: { text: part.text, blanks: part.blanks, at: now },
          },
          mediaRefs,
        });
        stats.cloze += 1;
      }
      stats.notes += 1;
      continue;
    }

    if (isClozeType) {
      /* 挖空类型的笔记一个挖空都没有：多半是字段顺序不是第一列，别装作读懂了 */
      stats.skipped.noCloze += 1;
      continue;
    }

    /* 正反模板：Anki 里一条笔记出两张卡；不补反向，用户会觉得少了一半 */
    const optionalReversed = /optional reversed|可选.*(反向|反转|反轉)/i.test(ntLower);
    const reversedFlag = extras.some((v) => /^(y|yes|1|true)$/i.test(v.trim()));
    const wantsReverse = optionalReversed ? reversedFlag : /reversed|反向|反转|反轉/i.test(ntLower);
    const answerExtras =
      optionalReversed && reversedFlag ? extras.filter((v) => !/^(y|yes|1|true)$/i.test(v.trim())) : extras;

    const front = firstRaw.trim();
    const back = [secondRaw.trim(), answerExtras.map((v) => v.trim()).filter(Boolean).join('\n')]
      .filter(Boolean)
      .join('\n')
      .trim();
    if (!front) {
      stats.skipped.emptyFront += 1;
      continue;
    }
    if (fields.length < 2) {
      /* 只有一列又不是挖空：不猜「这行看着像卡片」 */
      stats.skipped.short += 1;
      continue;
    }
    if (!back) {
      stats.skipped.emptyBack += 1;
      continue;
    }

    const baseKey = guid ? `anki:guid:${guid}` : `anki:${fnv1a(`${notetype}\u0000${firstRaw}`)}`;
    cards.push({
      syntax: 'qa',
      card: {
        key: baseKey,
        bookTitle: book,
        text: back,
        displayTitle: front,
        comment,
        mode: 'flashcard',
        qa: { q: front, a: back, at: now },
      },
      mediaRefs,
    });
    stats.qa += 1;

    if (wantsReverse) {
      cards.push({
        syntax: 'qa',
        card: {
          key: `${baseKey}#rev`,
          bookTitle: book,
          text: front,
          displayTitle: back,
          comment,
          mode: 'flashcard',
          qa: { q: back, a: front, at: now },
        },
        mediaRefs,
      });
      stats.reversed += 1;
      stats.qa += 1;
    }
    stats.notes += 1;
  }

  stats.cards = cards.length;
  return { cards, stats };
}

/**
 * 兼容旧调用：只要卡片数组。
 * key 已从「来源路径 + 行号」改成「笔记类型 + 正面」的稳定哈希（有 GUID 用 GUID），
 * 重新导出、行序变化不会整批重复；改了正面才算另一张卡。
 */
export function parseAnkiCards(content: string, sourcePath: string, title?: string): ParsedAnkiCard[] {
  return parseAnkiFile(content, sourcePath, title).cards;
}
