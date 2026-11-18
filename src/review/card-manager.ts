/**
 * 卡片管理器的挂起 / 埋藏（纯函数，零 DOM）
 *
 * 这两个状态只影响「进不进本轮队列」，不改 FSRS 的任何排期字段。
 * 统一由 queue.ts 的 active() 一处拦，三区列、本轮队列、负荷预测自动同口径。
 */

export interface QueueHidden {
  suspended?: boolean;
  buriedUntil?: string;
}

export interface TimeOpts {
  now?: number | Date;
}

const nowMsOf = (opts?: TimeOpts): number =>
  opts?.now != null ? new Date(opts.now).getTime() : Date.now();

/** 埋藏到期自动失效，不需要定时器；坏日期当没埋，避免卡片永久消失 */
export function isBuried(it: QueueHidden | null | undefined, opts?: TimeOpts): boolean {
  const raw = String(it?.buriedUntil ?? '').trim();
  if (!raw) return false;
  const t = new Date(raw).getTime();
  if (!Number.isFinite(t)) return false;
  return t > nowMsOf(opts);
}

export function isHiddenFromQueue(it: QueueHidden | null | undefined, opts?: TimeOpts): boolean {
  return !!it?.suspended || isBuried(it, opts);
}

/** 挂起：只写一个标记，不动 nextReviewDate / stability / difficulty / stage */
export function setSuspended<T extends QueueHidden>(it: T, suspended: boolean): T {
  return { ...it, suspended: suspended ? true : undefined };
}

/** 埋藏：到期时间写到字段里；days 默认 1 天 */
export function buryItem<T extends QueueHidden>(it: T, days = 1, opts?: TimeOpts): T {
  return { ...it, buriedUntil: new Date(nowMsOf(opts) + days * 86400000).toISOString() };
}

/** 恢复：清掉两个标记，排期字段原样保留 */
export function unsuspendAndUnbury<T extends QueueHidden>(it: T): T {
  const next: QueueHidden = { ...it };
  delete next.suspended;
  delete next.buriedUntil;
  return next as T;
}

/** 给 UI 用的一句话说明，明确「不删数据、不改排期」 */
export function hiddenNotice(hidden: 'suspended' | 'buried'): string {
  return hidden === 'suspended'
    ? '已挂起：这条不再进本轮复习，排期没有变，随时可以恢复。'
    : '已埋藏：明天自动回到队列，排期没有变。';
}
