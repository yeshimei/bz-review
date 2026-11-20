import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const css = fs.readFileSync(
  path.join(ROOT, 'src/review/ui/styles/settings-page.css'),
  'utf8'
);

function blockAfter(selector: string): string {
  const at = css.indexOf(selector);
  if (at < 0) return '';
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  return css.slice(open, close);
}

/**
 * 真机走查 2026-11-20：上次只清了宿主的 translateX，旋钮仍被
 * Obsidian 原生 .checkbox-container::after { margin-top: 2px } 往下推 2px，
 * 21px 胶囊里变成「上 5px / 下 1px」，看着贴底、显大、偏重。
 */
describe('设置页开关 · 旋钮垂直居中', () => {
  it('旋钮伪元素清掉宿主 margin，top:2px 才真正居中', () => {
    const knob = blockAfter('.bzrv-settings-content .bzs-setgrp .checkbox-container::after');
    expect(knob).toContain('top: 2px');
    expect(knob).toMatch(/margin:\s*0\s*;/);
  });

  it('左右只用 left 定位，不留宿主的 right 双约束', () => {
    const knob = blockAfter('.bzrv-settings-content .bzs-setgrp .checkbox-container::after');
    expect(knob).not.toMatch(/right:\s*(?!\s*auto\b)[^;]+;/);
  });
});
