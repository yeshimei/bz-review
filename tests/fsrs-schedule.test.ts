import { describe, expect, it } from 'vitest';
import {
  DEFAULT_W,
  DEFAULT_DESIRED_RETENTION,
  FSRS,
  MIN_INTERVAL_DAYS,
  clampIntervalDays,
  formatInterval,
  scheduleNext,
  parseLearningSteps,
  hardStepMinutes,
  currentR,
} from '../src/review/fsrs';

const now = new Date('2026-11-15T09:00:00.000Z');

const fsrsState = (over: Partial<Parameters<typeof scheduleNext>[0]> = {}) => ({
  stage: 0,
  phase: 'fsrs' as const,
  stability: 10,
  stabilityShort: 8,
  difficulty: 5,
  lastReviewed: '2026-11-01T00:00:00.000Z',
  reviewStart: '2026-10-01T00:00:00.000Z',
  ...over,
});

describe('FSRS-7 默认参数与常量', () => {
  it('官方 34 参数，首四个初始稳定性单调递增', () => {
    expect(DEFAULT_W).toHaveLength(34);
    expect(DEFAULT_W[0]).toBeLessThan(DEFAULT_W[1]);
    expect(DEFAULT_W[1]).toBeLessThan(DEFAULT_W[2]);
    expect(DEFAULT_W[2]).toBeLessThan(DEFAULT_W[3]);
  });

  it('默认目标留存率 0.9（官方推荐值）', () => {
    expect(DEFAULT_DESIRED_RETENTION).toBe(0.9);
  });

  it('最长间隔求解上界 100 年，返回有限正数', () => {
    const fsrs = new FSRS();
    const init = fsrs.initState('good');
    const iv = fsrs.intervalForRetention(init.sLong, init.sShort, init.d);
    expect(Number.isFinite(iv)).toBe(true);
    expect(iv).toBeGreaterThan(0);
    expect(iv).toBeLessThanOrEqual(36500);
  });
});

describe('首次评级（去阶梯，首次即初始化三元组）', () => {
  it('没有 lastReviewed 视为首次，phase 恒为 fsrs、stage=0', () => {
    const d = scheduleNext(fsrsState({ lastReviewed: null, stability: 1 }), 'good', now);
    expect(d.phase).toBe('fsrs');
    expect(d.stage).toBe(0);
    expect(d.enteringFsrs).toBe(true);
  });

  it('S_long=w[G-1]、S_short=0.8·S_long、D=initD(G)', () => {
    const fsrs = new FSRS();
    for (const g of ['again', 'hard', 'good', 'easy'] as const) {
      const d = scheduleNext(fsrsState({ lastReviewed: null, stability: 1 }), g, now);
      const init = fsrs.initState(g);
      expect(d.stability).toBeCloseTo(Math.round(init.sLong * 100) / 100, 5);
      expect(d.stabilityShort).toBeCloseTo(Math.round(init.sShort * 100) / 100, 5);
      expect(d.difficulty).toBeCloseTo(Math.round(init.d * 100) / 100, 5);
    }
  });

  it('首次评级四档间隔单调递增（again<hard<good<easy）', () => {
    const iv = (g: 'again' | 'hard' | 'good' | 'easy') =>
      scheduleNext(fsrsState({ lastReviewed: null, stability: 1 }), g, now).intervalDays;
    expect(iv('hard')).toBeGreaterThan(iv('again'));
    expect(iv('good')).toBeGreaterThan(iv('hard'));
    expect(iv('easy')).toBeGreaterThan(iv('good'));
  });
});

describe('遗忘曲线与间隔求解', () => {
  it('R(t) 随 t 单调递减，R(0)=1', () => {
    const fsrs = new FSRS();
    const init = fsrs.initState('good');
    expect(fsrs.R(0, init.sLong, init.sShort, init.d)).toBe(1);
    expect(fsrs.R(10, init.sLong, init.sShort, init.d)).toBeLessThan(fsrs.R(1, init.sLong, init.sShort, init.d));
  });

  it('二分求出的间隔满足 R(interval)=目标留存率', () => {
    const fsrs = new FSRS();
    const init = fsrs.initState('good');
    for (const dr of [0.8, 0.9, 0.95]) {
      const iv = fsrs.intervalForRetention(init.sLong, init.sShort, init.d, dr);
      expect(fsrs.R(iv, init.sLong, init.sShort, init.d)).toBeCloseTo(dr, 3);
    }
  });

  it('留存率越高间隔越短（调高 DR → 复习更勤）', () => {
    const fsrs = new FSRS();
    const init = fsrs.initState('good');
    const low = fsrs.intervalForRetention(init.sLong, init.sShort, init.d, 0.85);
    const high = fsrs.intervalForRetention(init.sLong, init.sShort, init.d, 0.95);
    expect(high).toBeLessThan(low);
  });
});

describe('复习后三元组更新', () => {
  it('成功回忆稳定性不降（SInc≥1），again 明显回落', () => {
    const base = fsrsState();
    const baseS = base.stability as number;
    for (const g of ['hard', 'good', 'easy'] as const) {
      const d = scheduleNext(base, g, now);
      expect(d.stability as number).toBeGreaterThanOrEqual(baseS);
    }
    expect(scheduleNext(base, 'again', now).stability as number).toBeLessThan(baseS);
  });

  it('短期稳定性 in [0.8·S_long, S_long] 量级（遗忘后 cap 生效）', () => {
    const d = scheduleNext(fsrsState(), 'again', now);
    expect(d.stabilityShort as number).toBeLessThanOrEqual(0.8 * (d.stability as number) + 1e-6);
  });

  it('难度落在 [1,10]，评简单下降、评困难上升', () => {
    const at = (g: 'again' | 'hard' | 'good' | 'easy') => scheduleNext(fsrsState(), g, now).difficulty!;
    for (const g of ['again', 'hard', 'good', 'easy'] as const) {
      expect(at(g)).toBeGreaterThanOrEqual(1);
      expect(at(g)).toBeLessThanOrEqual(10);
    }
    expect(at('easy')).toBeLessThan(at('good'));
    expect(at('hard')).toBeGreaterThan(at('good'));
  });

  it('答得越好间隔越长', () => {
    const iv = (g: 'again' | 'hard' | 'good' | 'easy') => scheduleNext(fsrsState(), g, now).intervalDays;
    expect(iv('easy')).toBeGreaterThan(iv('good'));
    expect(iv('good')).toBeGreaterThan(iv('again'));
  });

  it('历史阶段从 1 开始，间隔恒为正', () => {
    const d = scheduleNext(fsrsState(), 'good', now);
    expect(d.historyStage).toBeGreaterThanOrEqual(1);
    expect(d.intervalDays).toBeGreaterThan(0);
  });

  it('传入权重真的生效', () => {
    const a = new FSRS(DEFAULT_W).initS('good');
    const b = new FSRS(DEFAULT_W.map((v) => v * 2)).initS('good');
    expect(b).toBeGreaterThan(a);
  });
});

describe('currentR（当前留存率单源）', () => {
  it('三元组齐全时给出合理 R，缺 lastReviewed 返回 null', () => {
    const item = fsrsState();
    const r = currentR(item, DEFAULT_W);
    expect(r).not.toBeNull();
    expect(r!).toBeGreaterThan(0);
    expect(r!).toBeLessThanOrEqual(1);
    expect(currentR({ ...item, lastReviewed: null }, DEFAULT_W)).toBeNull();
  });

  it('缺 stabilityShort 时按 0.8·S_long 回退，不报错', () => {
    const item = fsrsState();
    delete (item as { stabilityShort?: number }).stabilityShort;
    expect(currentR(item, DEFAULT_W)).not.toBeNull();
  });
});

describe('间隔钳位与文案（保留口径）', () => {
  it('下限 1 分钟', () => {
    expect(MIN_INTERVAL_DAYS).toBeCloseTo(1 / 1440, 10);
    expect(clampIntervalDays(0, 1, 0)).toBeCloseTo(1 / 1440, 10);
  });

  it('缩放只乘不除、非法按 1；上限只压大的', () => {
    expect(clampIntervalDays(7, 2, 0)).toBe(14);
    expect(clampIntervalDays(7, 0, 0)).toBe(7);
    expect(clampIntervalDays(1000, 1, 365)).toBe(365);
    expect(clampIntervalDays(0.25, 1, 365)).toBeCloseTo(0.25, 10);
  });

  it('间隔说人话', () => {
    expect(formatInterval(1 / 1440)).toBe('1m');
    expect(formatInterval(0.25)).toBe('6h');
    expect(formatInterval(7)).toBe('7d');
    expect(formatInterval(0)).toBe('1m');
  });
});

describe('Anki 式学习步骤', () => {
  const opts = { stepsMins: [1, 10], graduatingDays: 1, sameDay: true };
  const stepState = (stage: number) => ({ stage, phase: 'ladder' as const, stability: 1, stabilityShort: 0.8, difficulty: 0.3, lastReviewed: null, reviewStart: '2026-11-20T09:00:00.000Z' });

  it('解析步骤串：只认分钟，空/含小时视为关闭', () => {
    expect(parseLearningSteps('1m 10m')).toEqual([1, 10]);
    expect(parseLearningSteps('1, 10, 30')).toEqual([1, 10, 30]);
    expect(parseLearningSteps('')).toBeNull();
    expect(parseLearningSteps('1h 10m')).toBeNull();
    expect(parseLearningSteps('1d')).toBeNull();
  });

  it('Hard 第一步取前两步均值，单步取 1.5 倍', () => {
    expect(hardStepMinutes([1, 10], 0)).toBe(5.5);
    expect(hardStepMinutes([1], 0)).toBe(1.5);
  });

  it('Good 进下一步；步骤期也写 S/D（Anki 步骤期有 memory_state，拟合可用）', () => {
    const d = scheduleNext(stepState(0), 'good', now, DEFAULT_W, 0.9, opts);
    expect(d.phase).toBe('ladder');
    expect(d.stage).toBe(1);
    expect(d.stability).not.toBeNull();
    expect(d.stability).toBeGreaterThan(0);
    expect(d.intervalDays).toBeCloseTo(10 / 1440, 6);
    expect(d.graduated).toBe(false);
  });

  it('Again 回第一步；Hard 停在现步', () => {
    expect(scheduleNext(stepState(1), 'again', now, DEFAULT_W, 0.9, opts).stage).toBe(0);
    const hard = scheduleNext(stepState(1), 'hard', now, DEFAULT_W, 0.9, opts);
    expect(hard.stage).toBe(1);
    expect(hard.intervalDays).toBeCloseTo(10 / 1440, 6); // 第二步 Hard = 重复当前步
  });

  it('走完最后一步 Good 毕业：三元组已就绪、间隔走 FSRS（非固定 1 天）', () => {
    const d = scheduleNext(stepState(1), 'good', now, DEFAULT_W, 0.9, opts);
    expect(d.phase).toBe('fsrs');
    expect(d.graduated).toBe(true);
    expect(d.enteringFsrs).toBe(true);
    expect(d.stability).toBeGreaterThan(0);
    // Anki FSRS 模式毕业间隔 = FSRS 首间隔（good 默认约 4.8 天），不是固定 graduating interval
    const init = new FSRS().initState('good');
    const expected = new FSRS().intervalForRetention(init.sLong, init.sShort, init.d, 0.9);
    expect(d.intervalDays).toBeCloseTo(expected, 1);
    expect(d.intervalDays).toBeGreaterThan(1);
  });

  it('Easy 任意步直接毕业', () => {
    const d = scheduleNext(stepState(0), 'easy', now, DEFAULT_W, 0.9, opts);
    expect(d.phase).toBe('fsrs');
    expect(d.graduated).toBe(true);
    expect(d.stability).toBeCloseTo(new FSRS().initState('easy').sLong, 2);
  });

  it('跨天（sameDay=false）强制跳过步骤，走 FSRS 首次', () => {
    const d = scheduleNext(stepState(0), 'good', now, DEFAULT_W, 0.9, { ...opts, sameDay: false });
    expect(d.phase).toBe('fsrs');
    expect(d.graduated).toBe(false); // 这是裸 FSRS 首次，非步骤毕业
  });

  it('关掉步骤（stepsMins=null）直接走 FSRS', () => {
    const d = scheduleNext(stepState(0), 'good', now, DEFAULT_W, 0.9, { stepsMins: null });
    expect(d.phase).toBe('fsrs');
  });
});

describe('Anki 重新学习步骤（relearn）', () => {
  const relearnOpts = { stepsMins: null, relearnStepsMins: [1, 10], graduatingDays: 1, sameDay: true };
  const fsrsState = { stage: 0, phase: 'fsrs' as const, stability: 30, stabilityShort: 24, difficulty: 5, lastReviewed: '2026-11-19T09:00:00.000Z', reviewStart: '2026-10-01T00:00:00.000Z' };
  const relearnState = (stage: number) => ({ ...fsrsState, phase: 'relearn' as const, stage });

  it('FSRS 阶段点「忘了」→ 进重学第一步（1m），三元组按 FSRS 更新', () => {
    const d = scheduleNext(fsrsState, 'again', now, DEFAULT_W, 0.9, relearnOpts);
    expect(d.phase).toBe('relearn');
    expect(d.stage).toBe(0);
    expect(d.intervalDays).toBeCloseTo(1 / 1440, 6);
    expect(d.stability).toBeLessThan(fsrsState.stability); // lapse 后稳定性下降
  });

  it('重学 Good 进下一步；Again 回第一步', () => {
    expect(scheduleNext(relearnState(0), 'good', now, DEFAULT_W, 0.9, relearnOpts).stage).toBe(1);
    expect(scheduleNext(relearnState(1), 'again', now, DEFAULT_W, 0.9, relearnOpts).stage).toBe(0);
  });

  it('重学走完/ Easy → 重新毕业回 FSRS，间隔走 FSRS', () => {
    const d = scheduleNext(relearnState(1), 'good', now, DEFAULT_W, 0.9, relearnOpts);
    expect(d.phase).toBe('fsrs');
    expect(d.graduated).toBe(true);
    expect(d.intervalDays).toBeGreaterThan(MIN_INTERVAL_DAYS);
    const easy = scheduleNext(relearnState(0), 'easy', now, DEFAULT_W, 0.9, relearnOpts);
    expect(easy.phase).toBe('fsrs');
    expect(easy.graduated).toBe(true);
  });

  it('关掉重学步骤（relearnStepsMins=null）→ 忘了直接走 FSRS', () => {
    const d = scheduleNext(fsrsState, 'again', now, DEFAULT_W, 0.9, { stepsMins: null, relearnStepsMins: null, sameDay: true });
    expect(d.phase).toBe('fsrs');
  });
});
