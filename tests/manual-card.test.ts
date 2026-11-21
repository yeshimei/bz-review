/**
 * 手动创建卡牌的纯逻辑（review/manual-card.ts）
 *
 * 手输文字没有文件路径当钥匙，也没有「回到原文」的出处。这里把两件事钉住：
 *   · 同一段文字必须生成同一个稳定钥匙——重复创建要能被查重拦住，不能每次都像新卡；
 *   · 空白内容一律不收，超长内容截断（面板上有字数提示，这里守住最后一道）。
 */
import { describe, expect, it } from 'vitest';
import { MANUAL_TEXT_LIMIT, manualCardKey, normalizeManualText } from '../src/review/manual-card';

describe('手动创建卡牌 · 稳定钥匙', () => {
  it('同一段文字生成同一个钥匙，首尾空白不影响', () => {
    expect(manualCardKey('减数分裂的三个阶段')).toBe(manualCardKey('减数分裂的三个阶段'));
    expect(manualCardKey('  减数分裂的三个阶段  ')).toBe(manualCardKey('减数分裂的三个阶段'));
  });

  it('不同文字生成不同钥匙', () => {
    expect(manualCardKey('甲')).not.toBe(manualCardKey('乙'));
  });

  it('钥匙带 manual: 前缀，不与笔记/划线卡撞', () => {
    expect(manualCardKey('甲')).toMatch(/^manual:/);
  });
});

describe('手动创建卡牌 · 文字归一', () => {
  it('空白内容不许提交', () => {
    expect(normalizeManualText('').error).toBeTruthy();
    expect(normalizeManualText('   \n  ').error).toBeTruthy();
  });

  it('正常内容去掉首尾空白后原样保留', () => {
    const r = normalizeManualText('  一段要记住的文字  ');
    expect(r.error).toBeUndefined();
    expect(r.text).toBe('一段要记住的文字');
    expect(r.clipped).toBe(false);
  });

  it('超长内容截到上限并标记 clipped', () => {
    const r = normalizeManualText('字'.repeat(MANUAL_TEXT_LIMIT + 50));
    expect(Array.from(r.text).length).toBe(MANUAL_TEXT_LIMIT);
    expect(r.clipped).toBe(true);
  });
});
