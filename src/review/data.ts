/**
 * 复习计划数据层（ticket 16 修正版：对齐源码 DataManager，日期字段 ISO 字符串）
 * review.json：CONFIG/STORAGE/review.json，jsonStore 读写。
 * D3 可靠写契约原语 1 收编：全部「读→改→写」事务整体入 core per-path 串行队列
 * （enqueueFileTask，键 = review.json 路径）——复习中评级、文件监控批量增删与列表操作
 * 并发写同文件时按序落盘，后写者不再用陈旧基线覆盖先写者；坏文件由 jsonFileStore
 * 留档降级（原语 3）。read/saveItems 保持无锁原语（队列内调用，勿再入队——不可重入）。
 */
import { stripMdExt } from '../core/utils';
import { TFile, type App } from 'obsidian';
import { cardTitleOf } from './card-title';
import { backupOriginal, diskReadText, enqueueFileTask, jsonFileStore, storageFile } from '../core/storage';
import { tryGetSettings } from '../core/settings-provider';
import { FSRS_FIRST_INTERVALS, TOTAL_STAGES } from './fsrs';
import { clipWToBounds } from './fit';
import { canAddCard, canAddNote, quotaBlock, type PlanCounts } from '../data/entitlement';
import {
  fingerprintsOf,
  mergeReviewItems,
  parseReviewFile,
  reviewMeta,
  serializeReviewItems,
  stampChangedItems,
  stripRuntime,
} from './store-format';
import { tombstonesOf } from './trash';
import { clearTrash as clearTrashStore, loadTrash, pushTrash, removeTrashKeys } from './trash-store';
import { writeDailySnapshot } from './snapshot-store';
import { notice } from '../core/notice';

export const REVIEW_FILE_PATH = 'CONFIG/STORAGE/review.json';

/** 复习数据文件路径（ADR-0009 共享数据路径；trim 收敛至 storageFile） */
export function getReviewFilePath(): string {
  const s = tryGetSettings();
  return storageFile('review.json', (s && s.storagePath) || 'CONFIG/STORAGE');
}

/** 旁挂元数据路径（版本号 + 最后写入时间；review.json 保持数组形态，旧版插件照读） */
export function getReviewMetaPath(): string {
  const s = tryGetSettings();
  return storageFile('review-meta.json', (s && s.storagePath) || 'CONFIG/STORAGE');
}

/**
 * 一条「划线卡」的内容（2026-11-11）。
 *
 * 复习计划以前只认**笔记文件**：排期表的钥匙是路径，复习就是打开那篇笔记。
 * 于是「划线 → 复习」只能先造一篇 Markdown 再排期，读十本书划八百条，库里就
 * 多八百篇一句话笔记，文件列表、搜索、图谱全被这些碎片占满。
 *
 * 所以加一类条目：内容直接躺在排期表里，复习时不打开任何文件。钥匙换成
 * `reader:<bookId>:<highlightId>` 这种**不会是真实路径**的字符串——它只需要
 * 在一个库里唯一，不需要能被 vault 解析。
 */
export interface ReviewCard {
  /** 稳定钥匙（`reader:<bookId>:<highlightId>`），同时充当 filePath */
  key: string;
  bookTitle: string;
  chapterTitle?: string;
  /** 划线原文（超长由调用方截断） */
  text: string;
  /**
   * 列表里区分「谁是谁」的简短标题（2026-11-20）。
   *
   * 同一本书同一章往往有十几张卡，光靠书名·章节根本分不清；这里按制卡方式
   * 给每张卡一个短标题：抽认卡取问句、做题卡取第一题题干、全文回忆取全文
   * （都截断）。做题卡的题目存在独立题库、卡上拿不到，所以生成后回填这个
   * 字段；抽认卡/全文卡由 cardTitleOf 直接从卡上内容派生，不必落库。
   * 纯展示字段，编辑界面不暴露给用户。
   */
  displayTitle?: string;
  /** 用户当时的想法 */
  comment?: string;
  /** 回到原文的链接（obsidian:// 协议串） */
  backlink?: string;
  /**
   * 划线前后各一段原文（阅读器推送时带）。
   * 有它才能走「上下文卡」：把划线藏起来，凭前后文回忆。
   * 没有时退化成「出处回忆」，不假装是完整功能。
   */
  context?: { before?: string; after?: string };
  /** AI 生成的抽认卡问答（可选；没有就用内置的「提示→揭示」） */
  qa?: { q: string; a: string; at: number };
  /** 填空卡：挖空后的句子 + 各空位答案 */
  cloze?: { text: string; blanks: string[]; at: number };
  /**
   * 这张卡自己的制卡 / 复习方式（2026-11-15）。
   *
   * 以前方式只有一个全局开关，改一次全库的卡都换样；现在方式在**制卡那一刻**
   * 定下来存在卡上，每张卡各走各的（抽认卡、填空、上下文、做题、展开全文）。
   * 老卡片没有这个字段 —— `card-ai.ts` 的 `modeOfCard()` 回落到全局旧值。
   */
  mode?: 'flashcard' | 'cloze' | 'context' | 'quiz' | 'plain';
  /**
   * 用户手改过（批 2）：后台自动补内容一律跳过，别把刚写的话顶掉。
   * 点「重新生成」仍可覆盖（那条路走 force）。
   */
  manual?: boolean;
}

/** 一条复习历史记录（持久化字段；旧数据可能缺 S/D 等，故都可选） */
export interface ReviewHistoryEntry {
  timestamp: string;
  stage?: number;
  rating: string;
  stability?: number;
  difficulty?: number;
  R?: number;
}

export interface ReviewItem {
  id: string;
  filePath: string;
  name: string;
  /**
   * 条目类型：`note` = 复习一篇笔记（缺省，老数据都是这种）；
   * `card` = 复习一条划线卡（内容在 `card` 字段里，没有文件）。
   */
  kind?: 'note' | 'card';
  /** 条目类型为 card 时的内容 */
  card?: ReviewCard;
  reviewStart: string; // ISO
  stage: number;
  phase: 'ladder' | 'fsrs' | 'relearn';
  /** FSRS-7：长期稳定性（= S_long）。字段名沿用 v4，下游语义升级为长期。 */
  stability: number;
  /** FSRS-7：短期稳定性（= S_short）。可选：老数据/未首次评级的条目没有，调度按 0.8·S_long 回退。 */
  stabilityShort?: number;
  difficulty: number;
  reviewHistory: ReviewHistoryEntry[];
  totalReviews: number;
  averageConfidence: number;
  nextReviewDate: string | null; // ISO
  lastReviewed: string | null; // ISO
  lastDifficulty: string | null;
  completed: boolean;
  /** 待重做（做题会话首次评级 ∈ {忘了,困难} 置位；重做通过只清标记不写 FSRS——ADR-0044） */
  pendingRedo?: boolean;
  /** 置顶/星标（ADR-0077：先于逾期队列排序、仅列表置顶、与 R 优先级互斥） */
  pinned?: boolean;
  /** 挂起：不进本轮复习队列，排期字段一律不动（卡片管理器，高级档） */
  suspended?: boolean;
  /** 埋藏到此刻（ISO）；到期自动回队列，坏日期当没埋（卡片管理器，高级档） */
  buriedUntil?: string;
  /** 运行时：文件在 vault 中不存在（挂起记录，列表删除线展示）；卡片类永远 false */
  isMissing?: boolean;
  // 兼容旧字段（读取时映射）
  reviewStage?: number;
  // 运行时
  file?: TFile;
  isCompleted?: boolean;
  isOverdue?: boolean;
  currentStage?: number;
  totalStages?: number;
}

/** 这条是不是划线卡（没有文件、内容在条目里） */
export function isCardItem(item: ReviewItem | null | undefined): boolean {
  return item?.kind === 'card' && !!item.card;
}

/**
 * 计划里两类各多少（免费版配额口径：划线卡与笔记**分开计数**）。
 *
 * 挂起（文件缺失）和已完成的条目照样占位——数据还在库里，只是现在不复习它。
 * 迁移进来的老数据可能早就超限，那种情况按「已满」处理：不删用户的东西，
 * 只是不能再加新的。
 */
export function planCounts(items: readonly ReviewItem[]): PlanCounts {
  let notes = 0;
  let cards = 0;
  for (const it of items) {
    if (isCardItem(it)) cards += 1;
    else notes += 1;
  }
  return { notes, cards };
}

/* 列表短标题的纯函数在 card-title.ts（不碰 obsidian，可单测）；这里原样
   再导出，既有调用方一行都不用改。 */
export { cardTitleOf } from './card-title';

export class ReviewDataManager {
  app: App;

  constructor(app: App) {
    this.app = app;
  }

  /** 加载条目（向后兼容旧字段；日期兼容 ISO 字符串与数字；非法 nextReviewDate 回退 reviewStart——见下）。
   *  走构造注入的 this.app.vault（A11 审查修复：注释如实——并非模块级 getApp）；
   *  双 dm 实例并存期（index.ensureReview 建例 / reviewApp.ensure 自持例）由各构造方保证 app 新鲜，
   *  勿在实例方法内改走模块级 getApp（会与「实例绑定自己的 vault」语义纠缠）。 */
  async loadItems(): Promise<ReviewItem[]> {
    /* 形态解析收在 store-format：旧版裸数组照常读（下次落盘自动升级），
       带 version/items 的新文件也读得动，两种形态不用在这里各写一遍。 */
    const data: unknown = await jsonFileStore<unknown>(getReviewFilePath()).read();
    /* 磁盘数据不可信：先按 ReviewItem 收窄，再逐条补派生字段（下方 finishSchedule）。 */
    const items = parseReviewFile(data).items as ReviewItem[];
    const valid: ReviewItem[] = [];

    for (const item of items) {
      /* 划线卡：没有文件可查，内容就在条目里。必须在这里分流——下面那段
         「查不到文件 → 标挂起」会把每一张卡都画成删除线、排除出队列。 */
      if (isCardItem(item)) {
        item.file = undefined;
        item.isMissing = false;
        /* 标题每次加载都按当前内容重算（2026-11-20）：老卡存的名字是「围城·第一章」，
           同章十几张全一样；现在 qa/题目/全文都在卡上（或 displayTitle 已回填），
           重算后每张卡各显示自己的那一句。 */
        item.name = cardTitleOf(item.card!);
        this.finishSchedule(item);
        valid.push(item);
        continue;
      }
      const file = this.app.vault.getAbstractFileByPath(item.filePath);
      if (!(file instanceof TFile)) {
        // 挂起记录（ticket 098）：文件不存在 → 保留条目（挂起，列表删除线展示、不计逾期、不进复习队列）
        item.file = undefined;
        item.isMissing = true;
        item.name = item.name || stripMdExt(item.filePath.split('/').pop() || '') || item.filePath;
        item.isCompleted = item.completed || false;
        item.isOverdue = false;
        item.currentStage = (item.stage ?? (item.reviewStage || 1) - 1) + 1;
        item.totalStages = TOTAL_STAGES;
        valid.push(item);
        continue;
      }
      item.file = file;
      item.name = file.basename;
      this.finishSchedule(item);
      valid.push(item);
    }
    return valid;
  }

  /**
   * 排期字段归一（文件类与卡片类共用）。
   *
   * 向后兼容：旧数据用 reviewStage，新数据用 stage；非法 nextReviewDate 回退
   * reviewStart（同样非法则置 null 走「待定」态）并留痕，回写条目、下次落盘自愈。
   */
  private finishSchedule(item: ReviewItem): void {
    if (item.stage === undefined) item.stage = (item.reviewStage || 1) - 1;
    if (item.stability === undefined) item.stability = 1;
    if (item.stabilityShort === undefined && item.stability > 0) item.stabilityShort = 0.8 * item.stability;
    if (item.difficulty === undefined) item.difficulty = 0.3;
    // Anki 式学习步骤：phase 字段就是权威——ladder=在步骤中，fsrs=已毕业。
    // 新卡建档 phase='ladder'；毕业写盘时置 'fsrs'。老 v4 数据没有"步骤"概念，
    // 按其 totalReviews 判断：复习过的归一到 fsrs（不重走步骤），没复习过的进步骤。
    if (item.phase === undefined || item.phase === null) {
      item.phase = ((item.totalReviews || 0) > 0 || item.lastReviewed) ? 'fsrs' : 'ladder';
    }
    // 学习步骤态的 stage 是"第几步"的内部序号（0 起），与老 v4 的 stage（0..9 爬级）不是一回事。
    // 进 ladder 时一律从第一步开始，避免老数据的 stage=1 导致第一次 Good 就"毕业"。
    if (item.phase === 'ladder' && (item.totalReviews || 0) === 0) item.stage = 0;
    const now = new Date();
    const isCompleted = item.completed || false;
    let nextReview = item.nextReviewDate ? new Date(item.nextReviewDate) : null;
    if (item.nextReviewDate && isNaN(nextReview!.getTime())) {
      const fb = item.reviewStart ? new Date(item.reviewStart) : null;
      nextReview = fb && !isNaN(fb.getTime()) ? fb : null;
      console.warn('[review] nextReviewDate 非法，回退 reviewStart：', item.filePath, String(item.nextReviewDate));
      item.nextReviewDate = nextReview ? nextReview.toISOString() : null;
    }
    const isOverdue = !!nextReview && now > nextReview && !isCompleted;
    item.isCompleted = isCompleted;
    item.isOverdue = isOverdue;
    item.currentStage = item.stage + 1;
    item.totalStages = TOTAL_STAGES;
  }

  /**
   * 保存（写前：快照 → 与磁盘现值合并 → 冲突留档 → 落盘）。
   *
   * 为什么要先读一遍盘：这份文件可能刚被另一台设备改过（Obsidian Sync / Syncthing）。
   * 直接盖上去就是「后写者通吃」，对方那几条复习记录当场消失，而且没有任何提示。
   * 现在的顺序是：
   *   1. 读磁盘现值，只给**内容真变了**的条目盖 updatedAt；
   *   2. 按 updatedAt + 回收站墓碑合并（删掉的不会被另一端的旧副本复活）；
   *   3. 有冲突就先把原文留档再弹一句人话；
   *   4. 写之前留当天第一份快照（回滚点）。
   * 运行时字段（file/isCompleted/…）由 stripRuntime 统一剥掉，不落盘。
   */
  async saveItems(items: ReviewItem[], base?: ReadonlyMap<string, string>): Promise<void> {
    const now = new Date();
    const path = getReviewFilePath();
    const raw = await diskReadText(this.app, path);
    let disk: ReviewItem[] = [];
    let diskBroken = false;
    if (raw) {
      try {
        const parsed = parseReviewFile(JSON.parse(raw));
        disk = parsed.items as ReviewItem[];
        diskBroken = parsed.broken;
      } catch {
        diskBroken = true;
      }
    }
    if (diskBroken) await backupOriginal(this.app, path, raw ?? undefined);

    const next = stampChangedItems(items.map((i) => stripRuntime(i)), disk, now);
    const tombstones = tombstonesOf(await loadTrash(this.app));
    const merged = mergeReviewItems(next, disk, { now, tombstones, base });

    if (merged.conflicts.length || merged.revived.length) {
      const saved = await backupOriginal(this.app, path, raw ?? undefined);
      notice(
        `这份复习数据在别的设备上也被改过（${merged.conflicts.length + merged.revived.length} 条）。` +
          `已按更新时间合并，改动前的内容留在 ${saved || 'CONFIG/.CORRUPT'}。`,
        'warning'
      );
    }

    if (raw) await writeDailySnapshot(this.app, raw, now);
    /* 主体保持数组（旧版插件读到不会当成空计划），版本号进旁挂文件。 */
    await jsonFileStore<unknown>(path).write(serializeReviewItems(merged.items));
    try {
      await jsonFileStore<unknown>(getReviewMetaPath()).write(reviewMeta(now));
    } catch (e) {
      console.warn('[review] 元数据写入失败（不影响主体数据）', e);
    }
  }

  /** 读改写事务：fn 基于磁盘现值改动，整体入 per-path 串行队列（D3 原语 1） */
  private mutate<T>(fn: (items: ReviewItem[]) => T | Promise<T>): Promise<T> {
    return enqueueFileTask(getReviewFilePath(), async () => {
      const items = await this.loadItems();
      /* 改动前的快照就是合并基准：fn 之后 items 已经变了，拿不到「原来长什么样」。
         没有它，saveItems 里那次「与磁盘现值合并」会把本机自己的改动当成远端冲突。 */
      const base = fingerprintsOf(items);
      const result = await fn(items);
      await this.saveItems(items, base);
      return result;
    });
  }

  /** 排期字段初值（笔记类与卡片类共用，免得两处各写一份、日后改一处忘一处） */
  private baseSchedule(): Omit<ReviewItem, 'filePath' | 'name'> {
    const now = new Date();
    return {
      id: `review_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`,
      reviewStart: now.toISOString(),
      stage: 0,
      // 新卡进 Anki 式学习步骤（1m/10m）；设置里关掉步骤时由 app.ts 直接按 FSRS 首次评级处理
      phase: 'ladder',
      stability: 1,
      stabilityShort: 0.8,
      difficulty: 0.3,
      reviewHistory: [],
      totalReviews: 0,
      averageConfidence: 0,
      nextReviewDate: new Date(now.getTime() + FSRS_FIRST_INTERVALS[0] * 86400000).toISOString(),
      lastReviewed: null,
      lastDifficulty: null,
      completed: false,
    };
  }

  /** 新条目构造（addItem/addItems 共用；与旧 addItem 逐字段同口径） */
  private newReviewItem(filePath: string, fileName: string): ReviewItem {
    return { ...this.baseSchedule(), filePath, name: fileName };
  }

  /** 划线卡条目构造：内容进条目，filePath 用那把稳定的钥匙 */
  private newCardItem(card: ReviewCard): ReviewItem {
    return {
      ...this.baseSchedule(),
      kind: 'card',
      card: { ...card },
      filePath: card.key,
      name: cardTitleOf(card),
    };
  }

  /**
   * 批量加入划线卡。
   *
   * 与 addItems 同一套口径：单趟 RMW、已存在跳过不抛、返回 { added, skipped }。
   * 钥匙重复就跳过——同一段划线点两次不该排两次。
   */
  addCards(
    cards: readonly ReviewCard[],
  ): Promise<{ added: number; skipped: number; rejected: number; keys: string[] }> {
    return this.mutate((items) => {
      const have = new Set(items.map((i) => i.filePath));
      const counts = planCounts(items);
      const keys: string[] = [];
      let added = 0;
      let skipped = 0;
      let rejected = 0;
      /* Array.isArray 把 readonly ReviewCard[] 收窄成 any[]，这里显式回断言，避免 any 泄漏。 */
      const list = Array.isArray(cards) ? (cards as ReviewCard[]) : [];
      for (const raw of list) {
        const key = String(raw?.key ?? '').trim();
        const text = String(raw?.text ?? '').trim();
        if (!key || !text || have.has(key)) {
          skipped++;
          continue;
        }
        /* 配额到顶：拒这一条，后面的也拒——但**已经进来的不退回**。用户一次加
           六十张时前五十张该落地，而不是整批失败（免费版只是不能继续加）。 */
        if (!canAddCard(counts.cards)) {
          rejected++;
          continue;
        }
        have.add(key);
        items.push(this.newCardItem({ ...raw, key, text }));
        counts.cards += 1;
        keys.push(key);
        added++;
      }
      return { added, skipped, rejected, keys };
    });
  }

  /** 卡片内容原地更新（划线改了文字 / 想法，重建抽认卡用） */
  updateCard(key: string, patch: Partial<ReviewCard>): Promise<boolean> {
    return this.mutate((items) => {
      const item = items.find((i) => i.filePath === key && isCardItem(i));
      if (!item) return false;
      item.card = { ...item.card!, ...patch, key: item.card!.key };
      item.name = cardTitleOf(item.card);
      return true;
    });
  }

  /** 新增条目 */
  addItem(filePath: string, fileName: string): Promise<ReviewItem> {
    return this.mutate((items) => {
      if (items.some((i) => i.filePath === filePath)) throw new Error('该笔记已在复习计划中');
      const block = quotaBlock('note', planCounts(items));
      if (!block.ok) throw new Error(block.message);
      const newItem = this.newReviewItem(filePath, fileName);
      items.push(newItem);
      return newItem;
    });
  }

  /** 批量新增（A13/E4 审查修复：watch 存量收编等 N+1 场景——单趟 RMW，一读一写落盘）。
   *  已存在/空路径跳过不抛错；返回 { added, skipped } 供调用方通知口径。
   *  超配额的那部分记在 rejected 里：前面的照常落地，不整批失败。 */
  addItems(
    list: Array<{ filePath: string; fileName?: string }>,
  ): Promise<{ added: number; skipped: number; rejected: number }> {
    return this.mutate((items) => {
      const have = new Set(items.map((i) => i.filePath));
      const counts = planCounts(items);
      let added = 0;
      let skipped = 0;
      let rejected = 0;
      for (const { filePath, fileName } of list) {
        if (!filePath || have.has(filePath)) {
          skipped++;
          continue;
        }
        if (!canAddNote(counts.notes)) {
          rejected++;
          continue;
        }
        have.add(filePath);
        const name = fileName || stripMdExt(filePath.split('/').pop() || '') || filePath;
        items.push(this.newReviewItem(filePath, name));
        counts.notes += 1;
        added++;
      }
      return { added, skipped, rejected };
    });
  }

  /** 更新条目（按 filePath 定位 + 就地修改 + 落盘） */
  updateItem(filePath: string, updateFn: (item: ReviewItem) => void): Promise<void> {
    return this.mutate((items) => {
      const idx = items.findIndex((i) => i.filePath === filePath);
      if (idx === -1) throw new Error('条目不存在');
      updateFn(items[idx]);
    }).then(() => undefined);
  }

  /** 移除条目：原条目先进回收站（可整条恢复），再落盘 */
  removeItem(filePath: string): Promise<void> {
    return this.mutate(async (items) => {
      const removed: ReviewItem[] = [];
      for (let i = items.length - 1; i >= 0; i--) {
        if (items[i].filePath === filePath) removed.push(items.splice(i, 1)[0]);
      }
      if (removed.length) await pushTrash(this.app, removed);
    }).then(() => undefined);
  }

  /** 批量移除（A13/E4 审查修复：watch 删除确认等 N+1 场景——单趟 RMW，一读一写落盘）。
   *  同路径重复条目全数移除（与 removeItem 同语义）；未命中路径静默跳过；返回移除条数。 */
  removeItems(paths: string[]): Promise<number> {
    const set = new Set(paths);
    return this.mutate(async (items) => {
      const removed: ReviewItem[] = [];
      for (let i = items.length - 1; i >= 0; i--) {
        if (set.has(items[i].filePath)) removed.push(items.splice(i, 1)[0]);
      }
      if (removed.length) await pushTrash(this.app, removed);
      return removed.length;
    });
  }

  /** 撤销移出（ticket 141 通病 1）：原条目（含阶段/排期/历史）原样插回，不走 addItem 重置进度。
   *  同时摘掉回收站里的墓碑——否则下次与另一台设备合并时，它会按「已删除」被再删一次。 */
  restoreItem(item: ReviewItem): Promise<void> {
    return this.mutate((items) => {
      if (items.some((i) => i.filePath === item.filePath)) return;
      items.push(stripRuntime(item));
    })
      .then(() => removeTrashKeys(this.app, [item.filePath]))
      .then(() => undefined);
  }

  /**
   * 从回收站恢复（按钥匙批量）。
   *
   * 顺序刻意是「先写回条目、再摘墓碑」：反过来的话，写回失败就等于条目从回收站
   * 消失了却哪儿都没有——宁可暂时留着墓碑，也不能让用户白点一次。
   */
  async restoreFromTrash(keys: readonly string[]): Promise<number> {
    const want = new Set(keys);
    const entries = (await loadTrash(this.app)).filter((e) => want.has(e.key));
    if (!entries.length) return 0;
    await this.mutate((items) => {
      const have = new Set(items.map((i) => i.filePath));
      for (const e of entries) {
        if (have.has(e.key)) continue;
        items.push({ ...(e.item as ReviewItem) });
        have.add(e.key);
      }
    });
    await removeTrashKeys(this.app, entries.map((e) => e.key));
    return entries.length;
  }

  /** 清空回收站（清完就等于放弃这些条目的墓碑，另一台设备的旧副本可能被合并回来） */
  async clearTrash(): Promise<void> {
    await clearTrashStore(this.app);
  }

  /**
   * 整份写回（批 4 恢复备份用）：先留快照，再直接覆盖，不走合并。
   * 恢复是用户明确要回到某一份，用 newer-wins 合并就恢复不回去了。
   */
  async replaceAll(items: readonly ReviewItem[]): Promise<void> {
    const now = new Date();
    const raw = await diskReadText(this.app, getReviewFilePath());
    if (raw) {
      const { writeSnapshotNow } = await import('./snapshot-store');
      await writeSnapshotNow(this.app, raw, now);
    }
    await jsonFileStore<unknown>(getReviewFilePath()).write(serializeReviewItems(items));
    await jsonFileStore<unknown>(getReviewMetaPath()).write(reviewMeta(now));
  }

  /**
   * 休假顺延（批 3）：把所有条目的下次复习日期整体后移。
   * 只动日期，不动阶段与记忆参数——休假不该改变「你记住了多少」。
   */
  shiftAllNextReview(ms: number): Promise<number> {
    if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve(0);
    return this.mutate((items) => {
      let n = 0;
      for (const it of items) {
        const t = it.nextReviewDate ? new Date(it.nextReviewDate).getTime() : NaN;
        if (!Number.isFinite(t)) continue;
        it.nextReviewDate = new Date(t + ms).toISOString();
        n++;
      }
      return n;
    });
  }

  /**
   * 批量顺延（批 4b）：把选中条目的下次复习日期一起往后推。
   * 单趟 RMW：批量操作最容易写成 N 次读盘，几十条就是几十次整文件重写。
   */
  postponeItems(keys: readonly string[], days: number): Promise<number> {
    const set = new Set(keys);
    const delta = Math.max(1, Math.round(days)) * 86400000;
    return this.mutate((items) => {
      let n = 0;
      for (const it of items) {
        if (!set.has(it.filePath)) continue;
        const base = it.nextReviewDate ? new Date(it.nextReviewDate).getTime() : Date.now();
        it.nextReviewDate = new Date((Number.isFinite(base) ? base : Date.now()) + delta).toISOString();
        n++;
      }
      return n;
    });
  }

  /** 手动指定下次复习日期（批 3）：考试、出差、借书到期都靠它 */
  setNextReview(filePath: string, iso: string): Promise<boolean> {
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return Promise.resolve(false);
    return this.mutate((items) => {
      const it = items.find((i) => i.filePath === filePath);
      if (!it) return false;
      it.nextReviewDate = new Date(t).toISOString();
      return true;
    });
  }

  /**
   * 撤销评级：把条目整体还原为评级前的快照（批 2）。
   * 只覆盖快照里有的字段，不动运行时派生态；条目已被删就返回 false。
   */
  restoreSnapshot(filePath: string, snapshot: Record<string, unknown>): Promise<boolean> {
    return this.mutate((items) => {
      const it = items.find((i) => i.filePath === filePath);
      if (!it) return false;
      Object.assign(it, snapshot);
      return true;
    });
  }

  getOverdueCount(items: ReviewItem[]): number {
    return items.filter((i) => i.isOverdue && !i.isCompleted).length;
  }

  /** 文件重命名时更新路径 */
  updateFilePath(oldPath: string, newPath: string, newName: string): Promise<boolean> {
    return this.mutate((items) => {
      const item = items.find((i) => i.filePath === oldPath);
      if (!item) return false;
      if (items.some((i) => i.filePath === newPath && i.filePath !== oldPath)) return false;
      item.filePath = newPath;
      item.name = newName;
      return true;
    });
  }
}

/** review-fit.json 契约版本：1=基础八参拟合（v4 历史档）；2=全参数拟合（v4=19 / v7=34） */
export const FIT_PARAMS_VERSION = { BASIC: 1, FULL: 2 } as const;

/** 拟合参数落盘（独立存储 review-fit.json，不覆盖 DEFAULT_W、不破坏 review.json 数组结构） */
export interface FittedParams {
  /** 拟合出的权重（FSRS-7 为 34 维；基础档只动 w[0..7]，其余为 DEFAULT_W） */
  w: number[];
  /** 拟合时间戳 ISO */
  fitAt: string;
  /** 参与拟合的样本数 */
  fitCount: number;
  /** 全参(true)还是基础八参(false)拟合 */
  full: boolean;
  /** 契约版本（issue 361）：1=基础八参；2=全 19 参数。
   *  旧八参文件无该字段 → 载入视同 1（零迁移，w 前 8 有效其余本就取 DEFAULT_W）；新拟合写入显式版本。 */
  version?: number;
}


export function getReviewFitFilePath(): string {
  const s = tryGetSettings();
  return storageFile('review-fit.json', (s && s.storagePath) || 'CONFIG/STORAGE');
}

export async function loadFittedParams(app: App): Promise<FittedParams | null> {
  const raw: unknown = await jsonFileStore<unknown>(getReviewFitFilePath()).read();
  if (!raw || typeof raw !== 'object') return null;
  /* 盘上文件不可信：只按「w / version 可能是什么」收窄，不把 any 带进后续判断。 */
  const data = raw as { w?: unknown; version?: unknown };
  if (!Array.isArray(data.w) || data.w.length < 8) return null;
  const w = data.w as unknown[];
  // 全参契约完整性：声称 v2 但权重不足 34 维 → 视为字段不齐（null 回退默认，与 w<8 同口径）
  if (data.version === FIT_PARAMS_VERSION.FULL && w.length < 34) return null;
  // 脏值防御（审查修复）：任一维非有限数 → 整文件视为坏档（null 回退默认，防 markReview RangeError /
  // NaN 毒化记忆曲线）；有限值逐维钳进 W_BOUNDS（与拟合落盘同界——手改文件越界值不再直灌调度）
  if (!w.every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
  return { ...(raw as FittedParams), w: clipWToBounds(w as number[]) };
}

export async function saveFittedParams(app: App, fit: FittedParams): Promise<void> {
  // D3 原语 1 收编：review-fit.json 拟合写同样入 per-path 串行队列（与 loadFittedParams 读竞态无关，防多端/多入口并发拟合写互踩）
  await enqueueFileTask(getReviewFitFilePath(), () => jsonFileStore<FittedParams>(getReviewFitFilePath()).write(fit));
}
