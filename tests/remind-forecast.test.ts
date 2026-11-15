import { describe, expect, it } from 'vitest';
import { forecastLoad, forecastSummary, shouldRemindNow } from '../src/review/queue';

const at = (h: number, m = 0) => new Date(2026, 10, 15, h, m, 0);

describe('每日提醒', () => {
  it('到了点才提醒，同一天只提醒一次', () => {
    expect(shouldRemindNow(at(9, 0), '09:00', '')).toBe(true);
    expect(shouldRemindNow(at(9, 0), '09:00', '2026-11-15')).toBe(false);
    expect(shouldRemindNow(at(8, 59), '09:00', '')).toBe(false);
  });

  it('晚一点开着也能补上（下午三点开着库，九点的提醒照样给）', () => {
    expect(shouldRemindNow(at(15, 0), '09:00', '')).toBe(true);
  });

  it('没填 / 填错就当没开提醒（不能让脏值天天弹）', () => {
    expect(shouldRemindNow(at(15, 0), '', '')).toBe(false);
    expect(shouldRemindNow(at(15, 0), '九点', '')).toBe(false);
    expect(shouldRemindNow(at(15, 0), '25:00', '')).toBe(false);
  });
});

describe('未来负荷预测', () => {
  const mk = (id: string, when: Date | null, extra: Record<string, unknown> = {}) => ({
    id,
    filePath: `${id}.md`,
    name: id,
    stage: 1,
    phase: 'ladder' as const,
    reviewHistory: [],
    reviewStart: '2026-11-01T00:00:00.000Z',
    nextReviewDate: when ? when.toISOString() : undefined,
    ...extra,
  });

  const now = new Date(2026, 10, 15, 10, 0, 0);

  it('按天分桶，没到期的日子补 0，长度等于天数', () => {
    const items = [mk('a', new Date(2026, 10, 15, 20, 0)), mk('b', new Date(2026, 10, 17, 9, 0))] as any[];
    const points = forecastLoad(items, 5, now);
    expect(points).toHaveLength(5);
    expect(points[0]).toEqual({ day: '2026-11-15', count: 1 });
    expect(points[1].count).toBe(0);
    expect(points[2].count).toBe(1);
  });

  it('已完成的、挂起的、超出窗口的都不算（否则用户会被假峰值吓到）', () => {
    const items = [
      mk('done', new Date(2026, 10, 16, 9, 0), { completed: true }),
      mk('missing', new Date(2026, 10, 16, 9, 0), { isMissing: true }),
      mk('far', new Date(2026, 11, 30, 9, 0)),
      mk('ok', new Date(2026, 10, 16, 9, 0)),
    ] as any[];
    const points = forecastLoad(items, 5, now);
    expect(points.reduce((s, p) => s + p.count, 0)).toBe(1);
  });

  it('汇总给总量、峰值与峰值那天', () => {
    const points = [
      { day: '2026-11-15', count: 2 },
      { day: '2026-11-16', count: 9 },
      { day: '2026-11-17', count: 0 },
    ];
    expect(forecastSummary(points)).toEqual({ total: 11, peak: 9, peakDay: '2026-11-16' });
    expect(forecastSummary([])).toEqual({ total: 0, peak: 0, peakDay: '' });
  });
});
