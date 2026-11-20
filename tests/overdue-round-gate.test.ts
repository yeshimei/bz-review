/**
 * 「开始本轮复习」必须有逾期才允许（2026-11-20 用户反馈）。
 *
 * 以前只要 逾期∪今日到期∪R 阈值提前 非空就给按钮，于是「没有逾期、只有今天到期」
 * 也能开始本轮。三区列与开始按钮要同口径：只有逾期列非空才出按钮、才放行。
 */
import { describe, expect, it } from 'vitest';
import { queueViewHtml } from '../src/review/render';
import { roundQueue } from '../src/review/queue';

const mk = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  filePath: `${id}.md`,
  name: id,
  stage: 1,
  phase: 'ladder' as const,
  stability: 1,
  difficulty: 0.3,
  reviewHistory: [],
  reviewStart: '2026-11-01T00:00:00.000Z',
  totalReviews: 3,
  lastReviewed: '2026-11-10T00:00:00.000Z',
  ...extra,
});

describe('开始本轮复习门控：只有有逾期才给按钮', () => {
  /* 日期一律相对「今天」算：以前写死 2026-11-20，过了那天整组用例就过期
     （今天到期变成过去、队列视图落进「今日已清空」分支），与产品行为无关。 */
  const now = Date.now();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const dueToday = new Date(Math.max(startOfToday.getTime(), now - 60_000)).toISOString();
  const dueTomorrow = new Date(startOfToday.getTime() + 3 * 24 * 3600_000).toISOString();
  const dueYesterday = new Date(startOfToday.getTime() - 24 * 3600_000).toISOString();

  it('只有今天到期、没有逾期 → 队列视图不出「开始本轮」按钮', () => {
    const items = [mk('today', { isOverdue: false, nextReviewDate: dueToday })] as any[];
    const html = queueViewHtml(items, { now });
    expect(html).not.toContain('data-act="begin"');
    expect(html).toContain('今天没有到期复习');
  });

  it('有一条逾期 → 出「开始本轮」按钮', () => {
    const items = [mk('overdue', { isOverdue: true, nextReviewDate: dueYesterday })] as any[];
    const html = queueViewHtml(items, { now });
    expect(html).toContain('data-act="begin"');
  });

  it('全清（无逾期无今日）→ 也不出按钮', () => {
    const items = [mk('future', { isOverdue: false, nextReviewDate: dueTomorrow })] as any[];
    const html = queueViewHtml(items, { now });
    expect(html).not.toContain('data-act="begin"');
  });

  it('roundQueue 本身仍按旧口径（逾期∪今日∪提前），门控在渲染与 startRoundSprint 两层，不动纯队列口径', () => {
    // 这条锁住：我们没改 queue 纯函数，避免回归别处（自动跳到逾期等）。
    const items = [mk('today', { isOverdue: false, nextReviewDate: dueToday })] as any[];
    expect(roundQueue(items, 0.9, [])).toHaveLength(1);
  });
});
