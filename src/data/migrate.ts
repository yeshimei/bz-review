/**
 * 从 bz 导入复习数据（src/data/migrate.ts）
 *
 * bz 里的复习计划存在 `CONFIG/STORAGE/review.json`，本插件默认写
 * `CONFIG/REVIEW/review.json`——两个插件同时装也不会互相覆盖。
 *
 * 迁移只做一次、只读源文件、目标非空就不动：迁移失败最多是「没导进来」，
 * 绝不会把 bz 那边已经攒了几个月的数据改坏。
 */
import type { App } from 'obsidian';
import { jsonFileStore, storageFile } from '../core/storage';
import { parseBzReviewJson } from './migrate-parse';
import { FREE_CARD_LIMIT, FREE_NOTE_LIMIT } from './entitlement';
import { DEFAULT_REVIEW_DIR } from '../core/storage-dir';

/** 复习域自己产出的数据文件（换数据目录时要跟着走） */
export const REVIEW_DATA_FILES = ['review.json', 'review-quiz.json', 'review-fit.json'] as const;

/** 空数据文件：等于没内容，可以覆盖 */
function looksEmpty(text: string): boolean {
  const s = String(text ?? '').trim();
  return !s || s === '[]' || s === '{}' || s === 'null';
}

/**
 * 逐级建目录。
 *
 * `adapter.mkdir` 不保证递归建父级（core/remote-asset.ts 里也记着这个坑），
 * 所以 `A/B/C` 这种要一层层建，单次调用会在父级不存在时失败。
 */
async function ensureDir(app: App, dir: string): Promise<void> {
  const parts = String(dir ?? '').split('/').filter(Boolean);
  let cur = '';
  for (const part of parts) {
    cur = cur ? `${cur}/${part}` : part;
    try {
      await app.vault.adapter.mkdir(cur);
    } catch {
      /* 已存在 */
    }
  }
}

/**
 * 换数据目录时把已有数据搬过去。
 *
 * 之前改了「数据目录」就直接存新路径，什么也不做——面板下一秒变成「今日已清空 /
 * 还没有任何复习条目」，18 条全不见，零提示。用户唯一的结论就是数据丢了。
 * （数据其实还在旧目录，改回去能自愈，但界面上没有任何线索。）
 *
 * 三条口径：
 * - **复制不移动**：旧目录原样保留，搬错了还能改回去，不会造成不可逆损失。
 * - **目标非空就不覆盖**：新目录已经有数据时保留新的，把名字记进 `kept`。
 * - **源是空的就不搬**：否则换目录会把旧目录里的空壳 `[]` 也搬过去。
 */
export async function copyReviewData(
  app: App,
  fromDir: string,
  toDir: string,
): Promise<{ copied: string[]; kept: string[] }> {
  const trim = (d: string): string => String(d ?? '').trim().replace(/\/+$/, '');
  const from = trim(fromDir);
  const to = trim(toDir);
  const copied: string[] = [];
  const kept: string[] = [];
  if (!from || !to || from === to) return { copied, kept };
  await ensureDir(app, to);
  for (const name of REVIEW_DATA_FILES) {
    let src = '';
    try {
      src = await app.vault.adapter.read(`${from}/${name}`);
    } catch {
      continue; // 源目录没有这个文件
    }
    if (looksEmpty(src)) continue;
    let dst = '';
    try {
      dst = await app.vault.adapter.read(`${to}/${name}`);
    } catch {
      dst = '';
    }
    if (!looksEmpty(dst)) {
      kept.push(name);
      continue;
    }
    try {
      await app.vault.adapter.write(`${to}/${name}`, src);
      copied.push(name);
    } catch {
      kept.push(name);
    }
  }
  return { copied, kept };
}
import type BzSettings from '../settings';

export type { ParsedBzReview } from './migrate-parse';
export { parseBzReviewJson } from './migrate-parse';

/** bz 的复习数据位置（固定，不跟它的设置走——移植时宁可找不到，也不猜错） */
export const BZ_REVIEW_PATH = 'CONFIG/STORAGE/review.json';

export interface BzImportStats {
  /** 复习笔记条目数（bz 主仓没有划线卡概念，别显示「卡片数」） */
  notes: number;
  /** 已到期未完成的条目数 */
  due: number;
  /** 累计复习次数 */
  reviews: number;
}

/**
 * 从 bz 的复习条目里算导入前简要统计。纯函数，坏字段按 0 算。
 */
export function bzStatsOfItems(items: readonly unknown[]): BzImportStats {
  const today = new Date().toISOString().slice(0, 10);
  let due = 0;
  let reviews = 0;
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const it = raw as {
      completed?: unknown;
      nextReviewDate?: unknown;
      totalReviews?: unknown;
      reviewHistory?: unknown;
    };
    const date = typeof it.nextReviewDate === 'string' ? it.nextReviewDate.slice(0, 10) : '';
    if (it.completed !== true && date && date <= today) due += 1;
    const n = typeof it.totalReviews === 'number' && Number.isFinite(it.totalReviews) ? it.totalReviews : 0;
    reviews += n > 0 ? n : Array.isArray(it.reviewHistory) ? it.reviewHistory.length : 0;
  }
  return { notes: items.length, due, reviews };
}

/** 只读地看一眼 bz 的数据，拿不到 / 解析失败都返回 null */
export async function peekBzImport(app: App): Promise<BzImportStats | null> {
  try {
    const raw = await app.vault.adapter.read(BZ_REVIEW_PATH);
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return bzStatsOfItems(parsed);
  } catch {
    return null;
  }
}

export interface MigrateResult {
  ok: boolean;
  message: string;
  imported?: number;
}

export async function migrateFromBz(app: App, settings: BzSettings): Promise<MigrateResult> {
  const dstPath = storageFile('review.json', (settings.storagePath || DEFAULT_REVIEW_DIR).trim());

  const exists = async (p: string): Promise<boolean> => {
    try {
      return await app.vault.adapter.exists(p);
    } catch {
      return false;
    }
  };

  if (!(await exists(BZ_REVIEW_PATH))) {
    return { ok: false, message: '没找到 bz 的复习数据（CONFIG/STORAGE/review.json），不用导入。' };
  }
  if (await exists(dstPath)) {
    /* 只看「文件在不在」会误伤：插件启动读一次 review.json 就顺手把它建成了
       `[]`。而老用户的真实顺序是「装插件 → 设置 → 导入」，此时文件早就在了，
       于是导入对所有老用户都是死路——还会提示「你已经有复习数据了」，让人以为
       自己早就导过。所以判的是**有没有条目**，不是有没有文件。 */
    let existing = '';
    try {
      existing = await app.vault.adapter.read(dstPath);
    } catch {
      existing = '';
    }
    let hasData = false;
    try {
      const parsed: unknown = JSON.parse(existing);
      hasData = Array.isArray(parsed) ? parsed.length > 0 : !!parsed;
    } catch {
      // 目标文件是坏的：同样不覆盖，但把它当成「有数据」，让用户先自己处理
      hasData = existing.trim().length > 0;
    }
    if (hasData) {
      return { ok: false, message: `本插件已经有复习数据（${dstPath}），不覆盖。` };
    }
  }

  let raw = '';
  try {
    raw = await app.vault.adapter.read(BZ_REVIEW_PATH);
  } catch {
    return { ok: false, message: '读不了 bz 的复习数据，导入中止。' };
  }

  const parsed = parseBzReviewJson(raw);
  if (!parsed.ok) return { ok: false, message: parsed.message };
  const items = parsed.items;

  try {
    await jsonFileStore<unknown[]>(dstPath).write(items);
  } catch (e) {
    return { ok: false, message: `写入失败：${(e as Error)?.message || '未知错误'}` };
  }
  /* 导入不按配额截断——老用户攒的数据不该因为换了插件就少一半。但**得说一声**：
     85 条原样搬进来，而免费版上限是 20 篇 + 50 条，用户完全不知道自己在超限状态，
     之后加任何新笔记都被拦，只会觉得「导入之后就不能用了」。 */
  const cardCount = items.filter((i: unknown) => {
    if (!i || typeof i !== 'object') return false;
    const rec = i as { kind?: unknown; card?: unknown };
    return rec.kind === 'card' && !!rec.card;
  }).length;
  const noteCount = items.length - cardCount;
  const overNotes = Math.max(0, noteCount - FREE_NOTE_LIMIT);
  const overCards = Math.max(0, cardCount - FREE_CARD_LIMIT);
  const overPart = [overNotes > 0 ? `${overNotes} 篇笔记` : '', overCards > 0 ? `${overCards} 条划线` : '']
    .filter(Boolean)
    .join('、');
  return {
    ok: true,
    message:
      `已从 bz 导入 ${items.length} 条复习记录。bz 那边的数据没动。` +
      (overPart ? ` 其中 ${overPart}超出免费版上限——已有数据不会删，但免费版不能再加新的。` : ''),
    imported: items.length,
  };
}

/**
 * 导入的统一动线：先看统计 → 二次确认 → 才复制。
 * 入口有两个（设置页按钮 / 命令面板），都走这一条，别各写一份确认。
 */
export async function importFromBzWithConfirm(app: App, settings: BzSettings): Promise<void> {
  const { notice } = await import('../core/notice');
  const stats = await peekBzImport(app);
  if (!stats) {
    notice('没找到可导入的 bz 复习数据（CONFIG/STORAGE/review.json）', 'warning');
    return;
  }
  const { openFlowDialog } = await import('../core/flow-dialog');
  const choice = await openFlowDialog({
    title: '从 bz 导入复习计划？',
    message:
      `检测到 bz 里有 ${stats.notes} 条复习笔记，其中 ${stats.due} 条已到期，累计复习 ${stats.reviews} 次。\n` +
      '导入只复制，不改变 bz 的数据；目标已有复习数据时不覆盖。',
    actions: [
      { label: '取消', value: 'cancel' },
      { label: '确认导入', value: 'ok', cta: true },
    ],
  });
  if (choice !== 'ok') {
    notice('已取消导入', 'info');
    return;
  }
  const res = await migrateFromBz(app, settings);
  notice(res.message, res.ok ? 'success' : 'warning');
}
