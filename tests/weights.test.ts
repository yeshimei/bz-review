import { describe, expect, it } from 'vitest';
import { WEIGHTS_LENGTH, parseWeights, resolveWeights, weightsToText } from '../src/review/weights';
import { DEFAULT_W } from '../src/review/fsrs';

const NINETEEN = DEFAULT_W.join(',');

describe('手填调度权重', () => {
  it('19 个数、逗号或空格分隔都认', () => {
    expect(parseWeights(NINETEEN)).toHaveLength(WEIGHTS_LENGTH);
    expect(parseWeights(DEFAULT_W.join(' '))).toHaveLength(WEIGHTS_LENGTH);
  });

  it('个数不对、有负数、有非数字，一律不认（猜错一个数整条曲线就歪）', () => {
    expect(parseWeights('1,2,3')).toBeNull();
    expect(parseWeights(DEFAULT_W.slice(0, 18).join(','))).toBeNull();
    expect(parseWeights([...DEFAULT_W.slice(0, 18), -1].join(','))).toBeNull();
    expect(parseWeights([...DEFAULT_W.slice(0, 18), 'x'].join(','))).toBeNull();
    expect(parseWeights('')).toBeNull();
    expect(parseWeights(null)).toBeNull();
  });

  it('手填优先于拟合：用户明确改过，后台拟合不能悄悄盖回去', () => {
    const manual = DEFAULT_W.map((v, i) => (i === 0 ? 0.9 : v)).join(',');
    const fitted = DEFAULT_W.map(() => 0.1);
    expect(resolveWeights(manual, fitted)[0]).toBe(0.9);
  });

  it('没手填就用拟合值；拟合也没有就默认', () => {
    expect(resolveWeights('', [0.1, 0.1])).toEqual([0.1, 0.1].length === WEIGHTS_LENGTH ? [0.1, 0.1] : DEFAULT_W);
    expect(resolveWeights(undefined, null)).toEqual(DEFAULT_W);
  });

  it('回显文本能再解析回去（设置页来回编辑不丢数）', () => {
    expect(parseWeights(weightsToText(DEFAULT_W))).toEqual(DEFAULT_W);
  });

  it('手填脏值（越界/破坏单调）也过官方 clip，防 R 变 NaN 把间隔塌成 1 分钟', () => {
    const bad = [...DEFAULT_W];
    bad[0] = 9999;          // 超上界 50
    bad[25] = 2;            // 超上界 0.95，且 > w[26]
    bad[26] = 0.01;         // 破坏 w25<=w26 单调
    const got = parseWeights(bad.join(','))!;
    expect(got[0]).toBeLessThanOrEqual(50);
    expect(got[25]).toBeLessThanOrEqual(0.95);
    expect(got[26]).toBeGreaterThanOrEqual(got[25]);
  });
});
