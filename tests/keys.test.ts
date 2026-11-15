import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RATING_KEYS,
  isValidRatingKeys,
  keyLabelOf,
  normalizeRatingKeys,
  ratingForKey,
  ratingKeys,
} from '../src/review/keys';

describe('评级键位', () => {
  it('默认还是 1-4，老用户不用改任何东西', () => {
    expect(DEFAULT_RATING_KEYS).toBe('1234');
    expect(ratingKeys(undefined)).toEqual({ again: '1', hard: '2', good: '3', easy: '4' });
  });

  it('换成左手区 / vim 键位都能用', () => {
    expect(ratingKeys('asdf')).toEqual({ again: 'a', hard: 's', good: 'd', easy: 'f' });
    expect(ratingKeys('hjkl')).toEqual({ again: 'h', hard: 'j', good: 'k', easy: 'l' });
  });

  it('少字符、多字符、重复键一律退回默认，不让界面变成按了没反应', () => {
    for (const bad of ['', '1', '123', '12345', '1123', '  ', 'abcd e']) {
      expect(normalizeRatingKeys(bad)).toBe(DEFAULT_RATING_KEYS);
      expect(isValidRatingKeys(bad)).toBe(false);
    }
  });

  it('按键能找到对应档位，大小写不敏感', () => {
    expect(ratingForKey('1', '1234')).toBe('again');
    expect(ratingForKey('4', '1234')).toBe('easy');
    expect(ratingForKey('a', 'asdf')).toBe('again');
    expect(ratingForKey('D', 'asdf')).toBe('good');
  });

  it('不是评级键就还回去，别把别的快捷键吞掉', () => {
    expect(ratingForKey('x', 'asdf')).toBeNull();
    expect(ratingForKey('Enter', 'asdf')).toBeNull();
    expect(ratingForKey('', 'asdf')).toBeNull();
  });

  it('界面提示取的是同一份键位，不会出现「显示 1 实际要按 a」', () => {
    expect(keyLabelOf('again', 'asdf')).toBe('a');
    expect(keyLabelOf('easy', undefined)).toBe('4');
  });
});
