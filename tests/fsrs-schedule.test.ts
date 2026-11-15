import { describe, expect, it } from 'vitest';
import { DEFAULT_W, FSRS, FSRS_FIRST_INTERVALS, LADDER_MAX, scheduleNext } from '../src/review/fsrs';

const now = new Date('2026-11-15T09:00:00.000Z');

const ladder = (stage: number) => ({
  stage,
  phase: 'ladder' as const,
  stability: 1,
  difficulty: 0.3,
  lastReviewed: undefined,
  reviewStart: '2026-10-01T00:00:00.000Z',
});

describe('阶梯阶段（9 级前）', () => {
  it('忘了退一级、困难不动、一般进一级、简单进两级', () => {
    expect(scheduleNext(ladder(4), 'again', now).stage).toBe(3);
    expect(scheduleNext(ladder(4), 'hard', now).stage).toBe(4);
    expect(scheduleNext(ladder(4), 'good', now).stage).toBe(5);
    expect(scheduleNext(ladder(4), 'easy', now).stage).toBe(6);
  });

  it('退到底就是 0，不会出负数', () => {
    expect(scheduleNext(ladder(0), 'again', now).stage).toBe(0);
  });

  it('间隔取固定表里的那一步（1m/30m/6h…），不是随手给的', () => {
    const d = scheduleNext(ladder(2), 'good', now);
    expect(d.intervalDays).toBe(FSRS_FIRST_INTERVALS[3]);
    expect(d.phase).toBe('ladder');
  });

  it('爬到第 9 级才算进入 FSRS，并且同一次就初始化 S/D', () => {
    const d = scheduleNext(ladder(LADDER_MAX - 1), 'good', now);
    expect(d.stage).toBe(LADDER_MAX);
    expect(d.phase).toBe('fsrs');
    expect(d.enteringFsrs).toBe(true);
    expect(d.stability).toBeGreaterThan(0);
    expect(d.difficulty).toBeGreaterThan(0);
  });

  it('简单两级的跳跃不会越过 9 级上限', () => {
    const d = scheduleNext(ladder(LADDER_MAX - 1), 'easy', now);
    expect(d.stage).toBe(LADDER_MAX);
  });
});

describe('FSRS 阶段', () => {
  const fsrs = (rating: 'again' | 'hard' | 'good' | 'easy') => {
    const s = { stage: LADDER_MAX, phase: 'fsrs' as const, stability: 10, difficulty: 0.3, lastReviewed: '2026-11-01T00:00:00.000Z', reviewStart: '2026-10-01T00:00:00.000Z' };
    return scheduleNext(s, rating, now);
  };

  it('答得越好间隔越长（同样的记忆状态）', () => {
    const again = fsrs('again').intervalDays;
    const good = fsrs('good').intervalDays;
    const easy = fsrs('easy').intervalDays;
    expect(good).toBeGreaterThan(again);
    expect(easy).toBeGreaterThan(good);
  });

  it('稳定度按评级变化：简单涨、忘了明显回落', () => {
    const before = 10;
    expect(fsrs('easy').stability!).toBeGreaterThan(before);
    expect(fsrs('again').stability!).toBeLessThan(before);
  });

  it('难度落在实现声明的 [1,10] 域内（存量 D 可能低于 1，不被钳抬）', () => {
    for (const r of ['again', 'hard', 'good', 'easy'] as const) {
      const d = fsrs(r);
      expect(d.difficulty!).toBeGreaterThan(0);
      expect(d.difficulty!).toBeLessThanOrEqual(10);
    }
  });

  it('评「简单」难度下降、评「困难」难度上升（方向反了会让间隔越背越长）', () => {
    /* 用 D=5（正常域）取证：0.3 是旧数据的起点，方向判定在那里会被下限吃掉 */
    const at = (rating: 'again' | 'hard' | 'good' | 'easy') =>
      scheduleNext(
        { stage: LADDER_MAX, phase: 'fsrs', stability: 10, difficulty: 5, lastReviewed: '2026-11-01T00:00:00.000Z', reviewStart: '2026-10-01T00:00:00.000Z' },
        rating,
        now
      ).difficulty!;
    expect(at('easy')).toBeLessThan(at('good'));
    expect(at('hard')).toBeGreaterThan(at('good'));
  });

  it('历史阶段从 1 开始记（界面「3/10」的口径），间隔不会为 0', () => {
    const d = fsrs('good');
    expect(d.historyStage).toBeGreaterThanOrEqual(1);
    expect(d.intervalDays).toBeGreaterThan(0);
  });

  it('自己带权重时按传入的算（手填权重真的生效）', () => {
    const heavier = [...DEFAULT_W];
    const a = new FSRS(DEFAULT_W).initS('good');
    const b = new FSRS(heavier).initS('good');
    expect(a).toBeCloseTo(b, 5);
    expect(new FSRS(DEFAULT_W.map((v) => v * 2)).initS('good')).not.toBe(a);
  });
});
