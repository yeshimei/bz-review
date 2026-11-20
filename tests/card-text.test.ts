import { describe, expect, it } from 'vitest';
import { aiTextOf } from '../src/review/card-text';

/**
 * 整篇笔记的正文可能几千字：卡上存全文，提示词只吃前一段。
 * 这里守「有节选就用节选、没有就退回全文」这一条口径。
 */
describe('给模型看的正文', () => {
  it('有 aiText 时只给节选', () => {
    expect(aiTextOf({ text: '全文很多字', aiText: '前一段' })).toBe('前一段');
  });

  it('没有 aiText 时退回全文', () => {
    expect(aiTextOf({ text: '全文' })).toBe('全文');
  });

  it('aiText 是空白时当没给', () => {
    expect(aiTextOf({ text: '全文', aiText: '   ' })).toBe('全文');
  });

  it('空卡不抛错', () => {
    expect(aiTextOf(null)).toBe('');
  });
});
