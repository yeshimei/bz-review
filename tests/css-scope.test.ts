import { describe, expect, it } from 'vitest';
import { scopeCss, findUnscopedSelectors } from '../scripts/css-scope.mjs';

/** 去掉换行差异，断言更稳 */
const flat = (s: string) => s.replace(/\s+/g, ' ').trim();

/** 作用域后缀（与 css-scope.mjs 保持一致） */
const S = ':is([data-bzrv], [data-bzrv] *)';

describe('scopeCss', () => {
  it('给元素选择器加容器作用域', () => {
    expect(flat(scopeCss('button { padding: 0; }'))).toBe(`button${S} { padding: 0; }`);
  });

  it('给类选择器加容器作用域', () => {
    expect(flat(scopeCss('.bzrv-btn { color: red; }'))).toBe(`.bzrv-btn${S} { color: red; }`);
  });

  it('根元素自己的类必须能命中（不能用祖先前缀）', () => {
    // 弹层根节点自己就是 [data-bzrv]、没有带锚点的祖先：
    // 一旦写成 `[data-bzrv] .bzrv-panel-frame`，面板背景会直接失效。
    const out = flat(scopeCss('.bzrv-panel-frame { background: red; }'));
    expect(out).toContain(S);
    expect(out.startsWith('[data-bzrv] ')).toBe(false);
  });

  it('伪类排在作用域后缀之后', () => {
    expect(flat(scopeCss('.bzrv-btn:hover { color: red; }'))).toBe(
      `.bzrv-btn${S}:hover { color: red; }`
    );
  });

  it('伪元素同样排在后缀之后', () => {
    expect(flat(scopeCss('*::-webkit-scrollbar { width: 8px; }'))).toBe(
      `*${S}::-webkit-scrollbar { width: 8px; }`
    );
  });

  it('后代选择器只作用在最后一段上', () => {
    expect(flat(scopeCss('.bzrv-cs-body .row { color: red; }'))).toBe(
      `.bzrv-cs-body .row${S} { color: red; }`
    );
  });

  it('子选择器只作用在最后一段上', () => {
    expect(flat(scopeCss('.bzrv-cs > p { margin: 0; }'))).toBe(
      `.bzrv-cs > p${S} { margin: 0; }`
    );
  });

  it('逗号列表逐项各加一次', () => {
    expect(flat(scopeCss('.a, .b { color: red; }'))).toBe(
      `.a${S}, .b${S} { color: red; }`
    );
  });

  it('纯变量块保持全局（变量名已带私有前缀）', () => {
    const css = ':root { --bzrv-space-sm: 8px; --bzrv-radius-sm: 8px; }';
    expect(flat(scopeCss(css))).toBe(flat(css));
  });

  it('变量块里混了普通属性就加作用域', () => {
    const out = flat(scopeCss('.theme-dark { color-scheme: dark; --bzrv-text-1: #eee; }'));
    expect(out).toBe(`.theme-dark${S} { color-scheme: dark; --bzrv-text-1: #eee; }`);
  });

  it('@media 内部递归加作用域', () => {
    const out = flat(scopeCss('@media (min-width: 700px) { .a { color: red; } }'));
    expect(out).toBe(`@media (min-width: 700px) { .a${S} { color: red; } }`);
  });

  it('@media 里的变量块不加作用域', () => {
    const out = flat(scopeCss('@media (min-width: 700px) { :root { --bzrv-vvh: 100vh; } }'));
    expect(out).toBe('@media (min-width: 700px) { :root { --bzrv-vvh: 100vh; } }');
  });

  it('@keyframes 内部原样保留', () => {
    const css = '@keyframes bzrvSpin { from { transform: rotate(0); } to { transform: rotate(360deg); } }';
    expect(flat(scopeCss(css))).toBe(flat(css));
  });

  it('已经手写成 [data-bzrv] 的不重复套', () => {
    const css = '[data-bzrv] button { padding: 0; }';
    expect(flat(scopeCss(css))).toBe(flat(css));
  });

  it('作用域化的产物再跑一遍不会叠加', () => {
    const once = scopeCss('.a { color: red; }');
    expect(scopeCss(once)).toBe(once);
  });

  it('自有 ID 选择器不加（ID 全局唯一）', () => {
    const css = '#bzrv-popup { position: fixed; }';
    expect(flat(scopeCss(css))).toBe(flat(css));
  });

  it('自有 ID 的后代选择器也原样', () => {
    const css = '#bzrv-stats-popup .bar-row { color: red; }';
    expect(flat(scopeCss(css))).toBe(flat(css));
  });

  it('属性选择器照样加作用域', () => {
    expect(flat(scopeCss('[data-tip] { position: relative; }'))).toBe(
      `[data-tip]${S} { position: relative; }`
    );
  });

  it('字符串里的花括号不会打断解析', () => {
    const css = '.a { content: "{"; } .b { content: "}"; }';
    const out = flat(scopeCss(css));
    expect(out).toContain(`.a${S}`);
    expect(out).toContain(`.b${S}`);
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
