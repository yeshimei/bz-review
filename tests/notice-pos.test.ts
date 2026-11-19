/**
 * 通知落角（core/notice.ts resolveNoticePos）。
 *
 * 2026-11-19：嵌进 bz Reader 时顶部两角是宿主头栏，通知压上去会挡住图标，
 * 所以嵌入形态一律让到下方；独立形态仍按用户偏好原样走。
 */
import { describe, expect, it } from 'vitest';
import { resolveNoticePos } from '../src/core/notice';

describe('resolveNoticePos', () => {
  it('独立形态：按设置，缺省右上', () => {
    expect(resolveNoticePos(undefined, false)).toBe('top-right');
    expect(resolveNoticePos('top-left', false)).toBe('top-left');
    expect(resolveNoticePos('bottom-left', false)).toBe('bottom-left');
  });

  it('嵌入形态：顶部两角全部让到下方', () => {
    expect(resolveNoticePos(undefined, true)).toBe('bottom-right');
    expect(resolveNoticePos('top-right', true)).toBe('bottom-right');
    expect(resolveNoticePos('top-left', true)).toBe('bottom-left');
  });

  it('嵌入形态：本来就在下方的保持不动', () => {
    expect(resolveNoticePos('bottom-right', true)).toBe('bottom-right');
    expect(resolveNoticePos('bottom-left', true)).toBe('bottom-left');
  });

  it('不认识的偏好值按缺省处理', () => {
    expect(resolveNoticePos('middle', false)).toBe('top-right');
  });
});
