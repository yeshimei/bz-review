import { describe, expect, it } from 'vitest';
import { DEFAULT_ACCENT, DEFAULT_SETTINGS, normalizeAccent } from '../src/settings';

describe('强调色：默认铜金与脏值回落', () => {
  it('新装默认是铜金，不跟宿主主题色', () => {
    expect(DEFAULT_ACCENT).toBe('copper');
    expect(DEFAULT_SETTINGS.accent).toBe('copper');
  });

  it('认得的档位原样保留', () => {
    for (const v of ['auto', 'copper', 'indigo', 'moss'] as const) expect(normalizeAccent(v)).toBe(v);
  });

  it('脏值 / 缺值一律回落铜金', () => {
    expect(normalizeAccent(undefined)).toBe('copper');
    expect(normalizeAccent('')).toBe('copper');
    expect(normalizeAccent('plum')).toBe('copper');
    expect(normalizeAccent(42)).toBe('copper');
  });
});
