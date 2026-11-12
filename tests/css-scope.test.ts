import { describe, expect, it } from 'vitest';
import { scopeCss, findUnscopedSelectors } from '../scripts/css-scope.mjs';

/** 去掉换行差异，断言更稳 */
const flat = (s: string) => s.replace(/\s+/g, ' ').trim();

describe('scopeCss', () => {
  it('给元素选择器套容器', () => {
    expect(flat(scopeCss('button { padding: 0; }'))).toBe(
      '[data-bzrv] button { padding: 0; }'
    );
  });

  it('给类选择器套容器', () => {
    expect(flat(scopeCss('.bzrv-btn { color: red; }'))).toBe(
      '[data-bzrv] .bzrv-btn { color: red; }'
    );
  });

  it('逗号列表逐项各套一次', () => {
    expect(flat(scopeCss('.a, .b { color: red; }'))).toBe(
      '[data-bzrv] .a, [data-bzrv] .b { color: red; }'
    );
  });

  it('纯变量块保持全局（变量名已带私有前缀）', () => {
    const css = ':root { --bzrv-space-sm: 8px; --bzrv-radius-sm: 8px; }';
    expect(flat(scopeCss(css))).toBe(flat(css));
  });

  it('变量块里混了普通属性就套容器', () => {
    const out = flat(scopeCss('.theme-dark { color-scheme: dark; --bzrv-text-1: #eee; }'));
    expect(out).toBe('[data-bzrv] .theme-dark { color-scheme: dark; --bzrv-text-1: #eee; }');
  });

  it('@media 内部递归套容器', () => {
    const out = flat(scopeCss('@media (min-width: 700px) { .a { color: red; } }'));
    expect(out).toBe('@media (min-width: 700px) { [data-bzrv] .a { color: red; } }');
  });

  it('@media 里的变量块不套容器', () => {
    const out = flat(scopeCss('@media (min-width: 700px) { :root { --bzrv-vvh: 100vh; } }'));
    expect(out).toBe('@media (min-width: 700px) { :root { --bzrv-vvh: 100vh; } }');
  });

  it('@keyframes 内部原样保留', () => {
    const css = '@keyframes bzrvSpin { from { transform: rotate(0); } to { transform: rotate(360deg); } }';
    expect(flat(scopeCss(css))).toBe(flat(css));
  });

  it('已写成 [data-bzrv] 的不重复套', () => {
    const css = '[data-bzrv] button { padding: 0; }';
    expect(flat(scopeCss(css))).toBe(flat(css));
  });

  it('自有 ID 选择器不套（ID 全局唯一）', () => {
    const css = '#bzrv-popup { position: fixed; }';
    expect(flat(scopeCss(css))).toBe(flat(css));
  });

  it('自有 ID 的后代选择器也原样', () => {
    const css = '#bzrv-stats-popup .bar-row { color: red; }';
    expect(flat(scopeCss(css))).toBe(flat(css));
  });

  it('属性选择器照样套容器', () => {
    expect(flat(scopeCss('[data-tip] { position: relative; }'))).toBe(
      '[data-bzrv] [data-tip] { position: relative; }'
    );
  });

  it('字符串里的花括号不会打断解析', () => {
    const css = '.a { content: "{"; } .b { content: "}"; }';
    const out = flat(scopeCss(css));
    expect(out).toContain('[data-bzrv] .a');
    expect(out).toContain('[data-bzrv] .b');
  });

  it('注释原样保留', () => {
    const css = '/* 说明 */ .a { color: red; }';
    expect(flat(scopeCss(css))).toContain('/* 说明 */');
  });

  it('空输入不炸', () => {
    expect(scopeCss('')).toBe('');
  });

  it('@import 这类无块语句原样', () => {
    expect(flat(scopeCss('@import url("a.css");'))).toBe('@import url("a.css");');
  });
});

describe('findUnscopedSelectors', () => {
  it('抓出裸选择器', () => {
    const bad = findUnscopedSelectors('button { padding: 0; } .bzrv-btn { color: red; }');
    expect(bad).toEqual(['button', '.bzrv-btn']);
  });

  it('作用域化后的产物是干净的', () => {
    const css = 'button { padding: 0; } .a { color: red; }';
    expect(findUnscopedSelectors(scopeCss(css))).toEqual([]);
  });

  it('变量块与 keyframes 不算违规', () => {
    const css = ':root { --bzrv-a: 1px; } @keyframes bzrvSpin { to { transform: none; } }';
    expect(findUnscopedSelectors(css)).toEqual([]);
  });

  it('自有 ID 不算违规', () => {
    expect(findUnscopedSelectors('#bzrv-popup .bar-row { color: red; }')).toEqual([]);
  });
});
