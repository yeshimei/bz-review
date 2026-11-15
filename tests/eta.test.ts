import { describe, expect, it } from 'vitest';
import { etaTextOf } from '../src/review/queue';

describe('剩余耗时粗估', () => {
  it('一条一分钟，只给量级', () => {
    expect(etaTextOf(1)).toBe('约 1 分钟');
    expect(etaTextOf(12)).toBe('约 12 分钟');
  });

  it('没有剩余就不显示（别在进度后面挂一个「约 0 分钟」）', () => {
    expect(etaTextOf(0)).toBe('');
    expect(etaTextOf(-3)).toBe('');
    expect(etaTextOf(Number.NaN)).toBe('');
  });
});
