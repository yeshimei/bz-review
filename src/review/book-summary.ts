/**
 * 按书 / 按章节的复习档案（纯函数，零 DOM，node 直测）
 *
 * analysis/data.ts 的派生是全局口径：整库平均留存率、整库评级分布。
 * 用户真正会问的是「这本书读完成记住了多少」「哪一本最该重读」——
 * 这里只在现有 R / 评级 / 排期字段上加一层分组，不碰调度逻辑、不另写公式。
 *
 * 分组口径复用 deck.ts 的原则：划线卡按书名，笔记按所在文件夹，两类不混组。
 */
import type { ReviewItem } from './data';
import { DEFAULT_W, currentR } from './fsrs';
import { t } from '../i18n/strings';

export type BookGroupKind = 'book' | 'notes';

export interface BookEntry {
  name: string;
  r: number | null;
  reviews: number;
}

export interface BookSummary {
  /** 界面显示名：书名，或笔记所在文件夹 */
  book: string;
  kind: BookGroupKind;
  /** 在册条数（含已完成，不删数据） */
  total: number;
  /** 还在复习的条数 */
  active: number;
  done: number;
  /** 不同章节数；笔记组恒为 0 */
  chapters: number;
  /** 评级总次数 */
  reviews: number;
  /** 可算条目的平均留存率；无可算条目为 null，不拿 0 冒充 */
  avgR: number | null;
  /** again / 总评级；无评级为 null */
  againRate: number | null;
  overdue: number;
  weak: BookEntry[];
  strong: BookEntry[];
}

interface Grouped {
  key: string;
  book: string;
  kind: BookGroupKind;
  items: ReviewItem[];
}

function groupOf(it: ReviewItem): { key: string; book: string; kind: BookGroupKind } {
  if (it?.kind === 'card' && it.card) {
    const book = String(it.card.bookTitle ?? '').trim() || t('books.untitledBook');
    return { key: `book:${book}`, book, kind: 'book' };
  }
  const path = String(it?.filePath ?? '');
  const cut = path.lastIndexOf('/');
  const folder = cut > 0 ? path.slice(0, cut) : '';
  const book = folder || t('books.ungrouped');
  return { key: `notes:${book}`, book, kind: 'notes' };
}

function nameOf(it: ReviewItem): string {
  const name = String(it?.name ?? '').trim();
  if (name) return name;
  const text = String(it.card?.text ?? '').trim();
  if (text) return text.slice(0, 24);
  return String(it?.filePath ?? t('common.untitled'));
}

/** 旧数据里可能还留着 isCompleted / isMissing 两个历史字段名，读取时类型收窄后再取 */
type LegacyFlags = ReviewItem & { isCompleted?: unknown; isMissing?: unknown };
const isDone = (it: ReviewItem): boolean => !!(it.completed || (it as LegacyFlags).isCompleted);
const isLive = (it: ReviewItem): boolean => !isDone(it) && !(it as LegacyFlags).isMissing;

/** 按书汇总。w / now 可注入，便于测试与重放；缺省走 FSRS 默认权重与当前时刻。 */
export function bookSummariesOf(
  items: readonly ReviewItem[],
  opts?: { w?: number[]; now?: number | Date }
): BookSummary[] {
  const w = opts?.w || DEFAULT_W;
  const nowMs = opts?.now != null ? new Date(opts.now).getTime() : Date.now();
  const groups = new Map<string, Grouped>();

  for (const it of items ?? []) {
    const g = groupOf(it);
    let bucket = groups.get(g.key);
    if (!bucket) {
      bucket = { ...g, items: [] };
      groups.set(g.key, bucket);
    }
    bucket.items.push(it);
  }

  const out: BookSummary[] = [];
  for (const g of groups.values()) {
    const live = g.items.filter(isLive);
    const chapters = new Set(
      g.items
        .filter((it) => it?.kind === 'card' && it.card)
        .map((it) => String(it.card?.chapterTitle ?? '').trim())
        .filter(Boolean)
    );

    let reviews = 0;
    let again = 0;
    for (const it of g.items) {
      for (const h of Array.isArray(it.reviewHistory) ? it.reviewHistory : []) {
        reviews++;
        if (String(h.rating ?? '') === 'again') again++;
      }
    }

    const entries: BookEntry[] = [];
    const rs: number[] = [];
    for (const it of live) {
      const r = currentR(it, w, nowMs);
      if (r != null && Number.isFinite(r)) {
        rs.push(r);
        entries.push({
          name: nameOf(it),
          r,
          reviews: Array.isArray(it.reviewHistory) ? it.reviewHistory.length : 0,
        });
      }
    }
    entries.sort((a, b) => (a.r ?? 2) - (b.r ?? 2) || b.reviews - a.reviews);

    const overdue = live.filter((it) => {
      if (!it.nextReviewDate) return false;
      const t = new Date(it.nextReviewDate).getTime();
      return Number.isFinite(t) && t <= nowMs;
    }).length;

    out.push({
      book: g.book,
      kind: g.kind,
      total: g.items.length,
      active: live.length,
      done: g.items.length - live.length,
      chapters: chapters.size,
      reviews,
      avgR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null,
      againRate: reviews ? again / reviews : null,
      overdue,
      weak: entries.slice(0, 5),
      strong: entries.slice().reverse().slice(0, 5),
    });
  }

  return out.sort(
    (a, b) => a.kind.localeCompare(b.kind) || b.active - a.active || a.book.localeCompare(b.book, 'zh-CN')
  );
}

const pct = (v: number | null): string => (v == null ? '—' : `${Math.round(v * 100)}%`);

/** 纯本地 Markdown 报告：能离开插件、能贴进笔记或打印，零服务器成本。 */
export function bookReportMarkdown(
  summaries: readonly BookSummary[],
  opts?: { now?: number | Date }
): string {
  /* 本地日期：toISOString() 是 UTC，东八区凌晨导出会写成前一天。 */
  const d = new Date(opts?.now ?? Date.now());
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const lines = [t('books.reportTitle'), '', t('books.reportIntro', { date: day, n: summaries.length }), ''];
  if (!summaries.length) {
    lines.push(t('books.reportEmpty'), '');
    return lines.join('\n');
  }
  for (const s of summaries) {
    const unit = s.kind === 'book' ? t('books.cards') : t('books.notesUnit');
    lines.push(`## ${s.book}`, '');
    lines.push(
      t('books.reportLine', {
        n: s.total,
        unit,
        active: s.active,
        done: s.done,
        chapter: s.kind === 'book' ? t('books.reportChapter', { n: s.chapters }) : '',
      })
    );
    lines.push(
      t('books.reportAvg', {
        avg: pct(s.avgR),
        again: pct(s.againRate),
        reviews: s.reviews,
        overdue: s.overdue,
      })
    );
    if (s.weak.length) lines.push(t('books.reportWeak', { list: s.weak.map((e) => `${e.name}（${pct(e.r)}）`).join('、') }));
    if (s.strong.length) lines.push(t('books.reportStrong', { list: s.strong.map((e) => `${e.name}（${pct(e.r)}）`).join('、') }));
    lines.push('');
  }
  return lines.join('\n');
}
