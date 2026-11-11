import { describe, expect, it } from 'vitest';
import { parseBzReviewJson } from '../src/data/migrate-parse';

describe('从 bz 导入：原文解析', () => {
  it('正常数组原样交出来', () => {
    const items = [{ id: 'a', filePath: 'note.md' }, { id: 'b', filePath: 'reader:x:y' }];
    const r = parseBzReviewJson(JSON.stringify(items));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.items).toHaveLength(2);
  });

  it('空数组算成功，不算错误', () => {
    const r = parseBzReviewJson('[]');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.items).toHaveLength(0);
  });

  it('坏 JSON 给一句人话，不抛', () => {
    const r = parseBzReviewJson('{oops');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('JSON');
  });

  it('不是数组（对象 / 字符串）也拦下', () => {
    expect(parseBzReviewJson('{"items":[]}').ok).toBe(false);
    expect(parseBzReviewJson('"hello"').ok).toBe(false);
  });
});
