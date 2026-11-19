import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scopeCss, findUnscopedSelectors } from '../scripts/css-scope.mjs';

const ROOT = path.resolve(__dirname, '..');

/** 与 scripts/build-css.mjs 的 SOURCES 保持一致（顺序无关，审计只看规则本身） */
const STYLE_SOURCES = [
  'src/core/reset.css',
  'src/core/styles.css',
  'src/core/ui/tokens.css',
  'src/core/ui/components.css',
  'src/review/styles.css',
  'src/review/analysis/styles.css',
  'src/review/ui/styles/settings-page.css',
  'src/review/ui/styles/changelog.css',
  'src/review/ui/styles/changelog-roadmap.css',
  'src/review/ui/styles/support.css',
  'src/review/ui/styles/unlock.css',
];

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

  it('构建产物里没有重复套作用域', () => {
    const cssFile = path.join(ROOT, 'styles.css');
    if (!fs.existsSync(cssFile)) return; // 还没构建过就跳过
    const css = fs.readFileSync(cssFile, 'utf8');
    expect(css).not.toMatch(/\[data-bzrv\]\s+\[data-bzrv\]/);
  });

  it('构建产物的容器锚点与 scope.ts 常量一致', () => {
    const scopeTs = fs.readFileSync(path.join(ROOT, 'src/core/scope.ts'), 'utf8');
    expect(scopeTs).toContain(`SCOPE_ATTR = 'data-bzrv'`);
    const cssFile = path.join(ROOT, 'styles.css');
    if (!fs.existsSync(cssFile)) return;
    expect(fs.readFileSync(cssFile, 'utf8')).toContain('[data-bzrv]');
  });
});
