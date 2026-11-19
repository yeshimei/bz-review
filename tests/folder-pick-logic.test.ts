import { describe, expect, it } from 'vitest';
import {
  ROOT_LABEL,
  folderItemText,
  togglePicked,
  folderPickPlaceholder,
} from '../src/core/folder-pick-logic';

/**
 * 原生目录选择器的纯逻辑（2026-11-20 反馈：弹窗换成 Obsidian 自己的快速选择）。
 * Modal 本体依赖宿主，只能真机验；这里守三条口径：项的标注、多选累加、提示文案。
 */
describe('folderItemText', () => {
  it('库根显示成人话标签', () => {
    expect(folderItemText('', [], 'single')).toBe(ROOT_LABEL);
  });

  it('单选：当前目录带「当前」标注', () => {
    expect(folderItemText('CONFIG/REVIEW', ['CONFIG/REVIEW'], 'single')).toBe('CONFIG/REVIEW（当前）');
  });

  it('单选：非当前目录不标注', () => {
    expect(folderItemText('books', ['CONFIG/REVIEW'], 'single')).toBe('books');
  });

  it('多选：已选目录带「已选」标注', () => {
    expect(folderItemText('books', ['books', 'notes'], 'multi')).toBe('books（已选）');
  });

  it('多选：未选目录不标注', () => {
    expect(folderItemText('temp', ['books'], 'multi')).toBe('temp');
  });
});

describe('togglePicked', () => {
  it('未选的追加到末尾', () => {
    expect(togglePicked(['books'], 'notes')).toEqual(['books', 'notes']);
  });

  it('已选的移除', () => {
    expect(togglePicked(['books', 'notes'], 'books')).toEqual(['notes']);
  });

  it('不修改原数组', () => {
    const cur = ['books'];
    togglePicked(cur, 'notes');
    expect(cur).toEqual(['books']);
  });
});

describe('folderPickPlaceholder', () => {
  it('单选是一句简单引导，不带多选的 Esc 提示', () => {
    const s = folderPickPlaceholder('single', 0);
    expect(s.length).toBeGreaterThan(0);
    expect(s).not.toContain('Esc');
  });

  it('多选零项时提示可连续选、Esc 完成', () => {
    const s = folderPickPlaceholder('multi', 0);
    expect(s).toContain('连续');
    expect(s).toContain('Esc');
  });

  it('多选已选项时带出数量', () => {
    expect(folderPickPlaceholder('multi', 3)).toContain('3');
  });
});
