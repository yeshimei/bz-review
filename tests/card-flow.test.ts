/**
 * 「开卡前先看一眼」已删除（2026-11-20 用户拍板）。
 *
 * 这条反馈要的是：划线卡设置页不再有那个开关，点开卡片也不再先弹确认框，
 * 相关判定/弹窗代码随之退役。重新生成后的确认（confirmRegenerated）是另一个
 * 功能，照常保留——这里只守「开卡前确认已彻底移除、重新生成确认没被误删」。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

describe('开卡前确认已删除（划线卡「开卡前先看一眼」）', () => {
  it('设置页划线卡组不再有「开卡前先看一眼」开关与 reviewCardConfirm 字段', () => {
    expect(read('src/review/settings-schema.ts')).not.toContain('开卡前先看一眼');
    expect(read('src/settings.ts')).not.toContain('reviewCardConfirm');
  });

  it('点开卡片不再走 confirmCardStart 二次确认', () => {
    const ui = read('src/review/ui.ts');
    expect(ui).not.toContain('confirmCardStart');
    expect(ui).not.toContain('confirmBeforeRound');
    expect(ui).not.toContain('needsCardConfirm');
  });

  it('card-flow.ts 不再导出开卡前那两个判定/弹窗', () => {
    const flow = read('src/review/card-flow.ts');
    expect(flow).not.toContain('export function needsCardConfirm');
    expect(flow).not.toContain('export async function confirmBeforeRound');
  });

  it('重新生成后的确认（confirmRegenerated）仍在，没被一刀切删掉', () => {
    expect(read('src/review/card-flow.ts')).toContain('export async function confirmRegenerated');
    expect(read('src/review/ui.ts')).toContain('confirmRegenerated');
  });
});
