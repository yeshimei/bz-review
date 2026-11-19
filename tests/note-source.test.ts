/**
 * 笔记选段出处（图二）：记录路径 + 字符范围，稳定钥匙不重复排期，
 * 复习时据此跳回原文并选中那一段。纯数据，node 里直接测。
 */
import { describe, expect, it } from 'vitest';
import {
  noteBacklink,
  noteCardKey,
  noteSourceOf,
  selectionRange,
  type NoteSource,
} from '../src/review/note-source';

const src: NoteSource = { path: '笔记/围城.md', from: 12, to: 34 };

describe('笔记选段出处', () => {
  it('钥匙稳定：同一篇同一段重复加入得到同一把钥匙', () => {
    expect(noteCardKey(src)).toBe(noteCardKey({ ...src }));
    expect(noteCardKey(src)).toContain('围城.md');
  });

  it('不同范围 / 不同笔记的钥匙不同', () => {
    expect(noteCardKey(src)).not.toBe(noteCardKey({ ...src, to: 35 }));
    expect(noteCardKey(src)).not.toBe(noteCardKey({ ...src, path: '别的.md' }));
  });

  it('backlink 指向这篇笔记（路径编码），不假装能定位到段落', () => {
    const url = noteBacklink(src.path);
    expect(url).toContain('obsidian://open?path=');
    expect(url).toContain(encodeURIComponent(src.path));
  });

  it('归一：合法出处原样收，越界 / 缺字段 / 脏对象一律不收', () => {
    expect(noteSourceOf(src)).toEqual(src);
    expect(noteSourceOf({ path: 'a.md', from: 3, to: 1 })).toBeNull();
    expect(noteSourceOf({ path: '', from: 0, to: 5 })).toBeNull();
    expect(noteSourceOf({ path: 'a.md', from: -1, to: 5 })).toBeNull();
    expect(noteSourceOf({ path: 'a.md', from: 0, to: 'x' })).toBeNull();
    expect(noteSourceOf(null)).toBeNull();
    expect(noteSourceOf('note:xxx')).toBeNull();
  });

  it('卡片上的出处字段能读回（归一化后丢失脏值）', () => {
    const card = { sourceNote: { path: 'n.md', from: 0, to: 7 } };
    expect(noteSourceOf(card.sourceNote)).toEqual(card.sourceNote);
  });
});

describe('从编辑器读选区范围', () => {
  const editor = (sel: string, from: number, to: number) => ({
    getSelection: () => sel,
    getCursor: (which: string) => (which === 'from' ? { line: 0, ch: from } : { line: 0, ch: to }),
    posToOffset: (pos: { ch: number }) => pos.ch,
  });

  it('有选区就记下 from/to', () => {
    expect(selectionRange(editor('选中这段', 12, 34) as never)).toEqual({ from: 12, to: 34 });
  });

  it('没选内容 / 范围非法返回 null，不记出处', () => {
    expect(selectionRange(editor('', 0, 0) as never)).toBeNull();
    expect(selectionRange(editor('x', 5, 2) as never)).toBeNull();
    expect(selectionRange(null)).toBeNull();
    expect(selectionRange({ getSelection: () => 'x' } as never)).toBeNull();
  });
});
