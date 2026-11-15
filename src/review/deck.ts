/**
 * 牌组与筛选（批 4，纯函数）。
 *
 * 几百条条目挤在「逾期/今天/未来」三列里，实际复习时常常变成「随便点一条」。
 * 牌组给的是复习时的心理单位：一门课、一本书、一个项目——各自按自己的节奏走。
 *
 * 不新造一套分类体系：牌组直接用库里已有的东西——笔记用所在文件夹，
 * 划线卡用书名。用户怎么组织库，牌组就怎么长，不需要再维护一份分组表。
 */
import type { ReviewItem } from './data';
import { DEFAULT_W } from './fsrs';
import { DEFAULT_R_THRESHOLD, partitionQueue } from './queue';

export type GroupBy = 'folder' | 'book';

/* 本地判定，不从 data.ts 引运行时函数：data 依赖 core/utils → obsidian，
   一引就进不了 node 测试环境（这个文件的逻辑本来就只是读字段）。 */
function isCardItem(item: ReviewItem): boolean {
  return item?.kind === 'card' && !!item.card;
}

/** 这条属于哪个牌组（笔记 = 文件夹，划线卡 = 书名）；取不到时给「未分组」 */
export function deckOf(item: ReviewItem): string {
  if (isCardItem(item)) {
    const book = String(item.card?.bookTitle ?? '').trim();
    return book || '未分组';
  }
  const path = String(item.filePath ?? '');
  const cut = path.lastIndexOf('/');
  if (cut <= 0) return '根目录';
  return path.slice(0, cut);
}

/** 一条目挂在哪些牌组下（笔记还可能按标签看，标签由调用方从元数据取） */
export function decksOf(item: ReviewItem, tags?: readonly string[]): string[] {
  const out = [deckOf(item)];
  for (const t of tags ?? []) {
    const v = String(t ?? '').trim();
    if (v) out.push(`#${v.replace(/^#/, '')}`);
  }
  return out;
}

export interface Facets {
  decks: string[];
  /** 全部标签（带 # 前缀），按出现次数降序 */
  tags: string[];
  counts: Record<string, number>;
}

/** 汇总所有牌组与标签（筛选面板的候选项，按条数排序） */
export function collectFacets(items: readonly ReviewItem[], tagsByPath?: Map<string, string[]>): Facets {
  const counts: Record<string, number> = {};
  const tagCounts: Record<string, number> = {};
  for (const it of items) {
    for (const d of [deckOf(it)]) counts[d] = (counts[d] ?? 0) + 1;
    for (const t of tagsByPath?.get(it.filePath) ?? []) {
      const key = `#${t.replace(/^#/, '')}`;
      tagCounts[key] = (tagCounts[key] ?? 0) + 1;
    }
  }
  const byCount = (o: Record<string, number>): string[] =>
    Object.keys(o).sort((a, b) => o[b] - o[a] || a.localeCompare(b));
  return { decks: byCount(counts), tags: byCount(tagCounts), counts };
}

export type StatusFilter = 'all' | 'overdue' | 'today' | 'future';

export interface ItemFilter {
  /** 关键字：匹配标题、文件名、卡片原文 */
  query?: string;
  kind?: 'all' | 'note' | 'card';
  /** 牌组（文件夹）或 #标签，空 = 不限 */
  deck?: string;
  /** 只看某一状态（与三区列同口径的粗筛） */
  status?: StatusFilter;
}

function matchesQuery(item: ReviewItem, q: string): boolean {
  if (!q) return true;
  const hay = [item.name, item.filePath, item.card?.text, item.card?.comment, item.card?.bookTitle, item.card?.chapterTitle]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
  return hay.includes(q.toLowerCase());
}

/**
 * 按筛选条件过滤。
 *
 * 状态筛选只做粗筛（逾期 / 今天 / 未来），真正的三区列仍由 partitionQueue 决定：
 * 这里多算一遍会造出两套口径，列表与「开始本轮」迟早对不上。
 */
export function applyFilter(items: readonly ReviewItem[], filter: ItemFilter = {}): ReviewItem[] {
  const q = String(filter.query ?? '').trim();
  const kind = filter.kind ?? 'all';
  const deck = String(filter.deck ?? '').trim();
  const kept = items.filter((it) => {
    if (kind === 'note' && isCardItem(it)) return false;
    if (kind === 'card' && !isCardItem(it)) return false;
    if (deck) {
      const carded = isCardItem(it) ? String(it.card?.bookTitle ?? '').trim() : '';
      const hit = carded ? carded === deck : deckOf(it) === deck;
      /* 标签筛选：调用方把标签也塞进 deck 字段（以 # 开头），这里按牌组名兜底匹配 */
      if (!hit && !deck.startsWith('#')) return false;
      if (!hit && deck.startsWith('#')) return false;
    }
    if (!matchesQuery(it, q)) return false;
    return true;
  });
  const status = filter.status ?? 'all';
  if (status === 'all') return kept;
  /* 状态筛：借三区列的分区结果（口径单源），但两边都有坑——partitionQueue 看的是
     loadItems 预置的 isOverdue/isCompleted 运行期字段，脱离读盘路径（单测、外部调用）
     时这些字段不存在，一条都分不出来。所以先按持久化字段补一遍，再交给 partitionQueue。 */
  const now = Date.now();
  const staged = kept.map((it) => ({
    ...it,
    isCompleted: !!(it as any).isCompleted || !!(it as any).completed,
    isOverdue:
      typeof (it as any).isOverdue === 'boolean'
        ? (it as any).isOverdue
        : !!it.nextReviewDate && new Date(it.nextReviewDate).getTime() <= now,
  })) as ReviewItem[];
  const cols = partitionQueue(staged, DEFAULT_R_THRESHOLD, DEFAULT_W);
  const bucket = status === 'overdue' ? cols.overdue : status === 'today' ? cols.today : cols.future;
  const keys = new Set(bucket.map((i) => i.filePath));
  return kept.filter((i) => keys.has(i.filePath));
}

/** 筛选是否为空（决定要不要显示「清除」） */
export function isEmptyFilter(filter: ItemFilter = {}): boolean {
  return !String(filter.query ?? '').trim() && (filter.kind ?? 'all') === 'all' && !String(filter.deck ?? '').trim() && (filter.status ?? 'all') === 'all';
}

/** 一条筛选的人话描述（状态条上显示「筛选中：某文件夹 · 只看划线」） */
export function describeFilter(filter: ItemFilter = {}): string {
  const bits: string[] = [];
  if (filter.deck) bits.push(filter.deck);
  if (filter.kind === 'note') bits.push('只看笔记');
  if (filter.kind === 'card') bits.push('只看划线');
  if (filter.status && filter.status !== 'all') {
    bits.push(filter.status === 'overdue' ? '只看逾期' : filter.status === 'today' ? '只看今天' : '只看未来');
  }
  const q = String(filter.query ?? '').trim();
  if (q) bits.push(`含「${q}」`);
  return bits.join(' · ');
}
