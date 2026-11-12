// scripts/build-css.mjs — 样式按域拆分，构建时聚合成根 styles.css
//
// Obsidian 每个插件只加载根目录这一个 styles.css，所以 CSS 必须在构建时拼起来。
// 源文件改动后跑 npm run dev / npm run build 重新生成，不要手改根文件。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scopeCss, findUnscopedSelectors } from "./css-scope.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_DIR = process.env.BZ_REVIEW_VAULT_DIR || "E:/Obsidian/叫我包仔/.obsidian/plugins/bz-review";

// normalize.css 不再参与构建：它是标准的全局浏览器重置（html / body / button / a …），
// 在 Obsidian 里等于改写宿主界面。插件自己的基线走 core/reset.css，已限定在 [data-bzrv] 内。
const SOURCES = [
  "src/core/reset.css",
  "src/core/styles.css",
  "src/core/ui/tokens.css",
  "src/core/ui/components.css",
  "src/review/styles.css",
  "src/review/analysis/styles.css",
];

const HEADER = [
  "/* ============================================================",
  " * Review（复习）— 构建聚合产物，请勿手改",
  " *   共享样式 → src/core/styles.css；域样式 → src/review/styles.css",
  " * 重新生成：npm run dev / npm run build（scripts/build-css.mjs）",
  " * ============================================================ */",
  "",
].join("\n");

export function buildStyles() {
  const parts = [HEADER];
  for (const rel of SOURCES) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) throw new Error(`样式源缺失：${rel}`);
    let text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    if (!text.endsWith("\n")) text += "\n";
    parts.push(text);
  }
  // 作用域化：除「纯变量块 + @keyframes」外，所有选择器前面加 [data-bzrv]，
  // 让样式只落在本插件自己的 DOM 子树里（Obsidian 所有插件的样式共用一张表）。
  const css = scopeCss(parts.join(""));

  // 构建期硬断言：一旦有人写出裸选择器，构建直接失败，防止污染回潮。
  const bad = findUnscopedSelectors(css);
  if (bad.length) {
    throw new Error(
      `样式未作用域化（${bad.length} 条）：${bad.slice(0, 8).join(' | ')}${bad.length > 8 ? ' …' : ''}`
    );
  }

  fs.writeFileSync(path.join(ROOT, "styles.css"), css, "utf8");
  if (fs.existsSync(PLUGIN_DIR)) {
    fs.copyFileSync(path.join(ROOT, "styles.css"), path.join(PLUGIN_DIR, "styles.css"));
  }
  return css.length;
}

export function watchStyles(onChange) {
  const srcDir = path.join(ROOT, "src");
  let timer = null;
  fs.watch(srcDir, { recursive: true }, (_e, filename) => {
    if (!filename || !String(filename).endsWith(".css")) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        const size = buildStyles();
        console.log(`✓ styles.css rebuilt (${size} bytes)`);
        if (onChange) onChange();
      } catch (err) {
        console.error("✗ styles.css rebuild failed:", err.message);
      }
    }, 50);
  });
}

if (process.argv[1] && process.argv[1].endsWith("build-css.mjs")) {
  console.log(`✓ styles.css aggregated (${buildStyles()} bytes)`);
}
