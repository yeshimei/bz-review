// scripts/build-css.mjs — 样式按域拆分，构建时聚合成根 styles.css
//
// Obsidian 每个插件只加载根目录这一个 styles.css，所以 CSS 必须在构建时拼起来。
// 源文件改动后跑 npm run dev / npm run build 重新生成，不要手改根文件。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_DIR = process.env.BZ_REVIEW_VAULT_DIR || "E:/Obsidian/叫我包仔/.obsidian/plugins/bz-review";

const SOURCES = [
  "src/core/vendor/normalize.css",
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
  const css = parts.join("");
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
