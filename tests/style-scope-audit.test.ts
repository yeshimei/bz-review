import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scopeCss, findUnscopedSelectors } from '../scripts/css-scope.mjs';
import { SOURCES as STYLE_SOURCES } from '../scripts/build-css.mjs';

const ROOT = path.resolve(__dirname, '..');
/* 直接复用构建脚本的 SOURCES（单一真源）：以前这里手工抄一份，新增样式源忘了同步，
   审计就永远漏掉那个文件。 */
const HAS_BUILD = fs.existsSync(path.join(ROOT, 'styles.css'));

function walkTs(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkTs(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('样式作用域审计', () => {
  it('所有样式源作用域化后没有裸选择器', () => {
    const css = STYLE_SOURCES.map((rel) =>
      fs.readFileSync(path.join(ROOT, rel), 'utf8')
    ).join('\n');
    const bad = findUnscopedSelectors(scopeCss(css));
    expect(bad, `未作用域化的选择器：${bad.slice(0, 10).join(' | ')}`).toEqual([]);
  });

  it('产物里不再有全局元素重置', () => {
    const css = scopeCss(
      STYLE_SOURCES.map((rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')).join('\n')
    );
    // 规则头不能是裸标签（body.theme-light [data-bzrv] 这类带类名/锚点的不算）
    for (const tag of ['html', 'body', 'button', 'input', 'textarea', 'select', 'a', 'img', 'canvas']) {
      const re = new RegExp(`^[ \\t]*${tag}\\s*[{,]`, 'm');
      expect(re.test(css), `${tag} 仍有全局规则`).toBe(false);
    }
  });

  it('每个 body 直挂的弹层前都挂了作用域锚点', () => {
    const files = walkTs(path.join(ROOT, 'src'));
    const missing: string[] = [];
    // 临时 textarea（剪贴板/输入中转）不需要样式，也就不用锚点
    const SKIP = new Set(['ta', 'textarea']);
    for (const f of files) {
      const lines = fs.readFileSync(f, 'utf8').split('\n');
      lines.forEach((line, i) => {
        const m = /document\.body\.appendChild\(([^)]+)\)/.exec(line);
        if (!m) return;
        const arg = m[1].trim();
        const simple = /^[A-Za-z_$][\w$]*$/.test(arg) ? arg : arg.replace(/^this\./, '');
        const leaf = simple.split('.').pop() ?? simple;
        if (SKIP.has(leaf)) return;
        const prev = lines.slice(Math.max(0, i - 3), i).join('\n');
        if (!new RegExp(`markOwned\\(${arg.replace(/[.$]/g, '\\$&')}\\)`).test(prev)) {
          missing.push(`${path.relative(ROOT, f)}:${i + 1} ${arg}`);
        }
      });
    }
    expect(missing, `缺少 markOwned：${missing.join(' | ')}`).toEqual([]);
  });

  // 以下三条依赖已构建的产物：用 skipIf 显式跳过（测试报告里能看到 skipped），
  // 不再在函数体里 `if (!exists) return` 那样静默「通过」——那样会掩盖根本没构建过。
  it.skipIf(!HAS_BUILD)('构建产物里没有重复套作用域', () => {
    const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
    expect(css).not.toMatch(/\[data-bzrv\]\s+\[data-bzrv\]/);
  });

  it('构建产物的容器锚点与 scope.ts 常量一致', () => {
    const scopeTs = fs.readFileSync(path.join(ROOT, 'src/core/scope.ts'), 'utf8');
    expect(scopeTs).toContain(`SCOPE_ATTR = 'data-bzrv'`);
  });
  it.skipIf(!HAS_BUILD)('产物 styles.css 带容器锚点', () => {
    expect(fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8')).toContain('[data-bzrv]');
  });

  it.skipIf(!HAS_BUILD)('开关旋钮样式修复进了产物：两条 checkbox-container::after 都清了宿主 transform（2026-11-20 真机反馈）', () => {
    const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
    /* 源码里 b024e90 已加 transform:none，但产物 styles.css 若没重新构建就还是旧的——
       用户真机看到的就是旧产物：圆点被宿主 translateX 顶出胶囊。这里守住产物同步。 */
    const toggleBlock = css.slice(
      css.indexOf('.bzrv-settings-content .bzs-setgrp .checkbox-container'),
      css.indexOf('.bzrv-settings-content .bzs-setgrp .checkbox-container') + 1600
    );
    expect(toggleBlock.match(/transform:\s*none/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
