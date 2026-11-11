import esbuild from "esbuild";
import process from "process";
import fs from "fs";
import path from "path";
import { buildStyles, watchStyles } from "./scripts/build-css.mjs";

// production = 发布构建（压缩、无 sourcemap），落仓库根 + 库里的插件目录
// once = 一次性开发构建（不压缩、inline sourcemap）
// 缺省 = watch 常驻
const mode = process.argv[2] === "production" ? "production" : process.argv[2] === "once" ? "once" : "watch";
const prod = mode === "production";

// 日常开发显式把 BZ_REVIEW_VAULT_DIR 指到测试库：
//   E:/Obsidian/bz reader/.obsidian/plugins/bz-review
// 缺省（发版）落主库。
const VAULT_PLUGIN_DIR =
  process.env.BZ_REVIEW_VAULT_DIR || "E:/Obsidian/叫我包仔/.obsidian/plugins/bz-review";
const RELEASE_MAIN = path.join(process.cwd(), "main.js");

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", "os", "node:fs", "node:path"],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  minify: prod,
  charset: "utf8",
  define: { __BZ_DEV__: prod ? "false" : process.env.BZ_REVIEW_VAULT_DIR ? "true" : "false" },
  loader: { ".png": "dataurl", ".json": "json" },
  outfile: path.join(VAULT_PLUGIN_DIR, "main.js"),
});

function copyStatic() {
  for (const file of ["manifest.json", "styles.css"]) {
    const src = path.join(process.cwd(), file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(VAULT_PLUGIN_DIR, file));
    }
  }
}

if (mode === "watch") {
  await context.watch();
  buildStyles();
  watchStyles();
  copyStatic();
  console.log("watching for changes...");
} else {
  await context.rebuild();
  buildStyles();
  copyStatic();
  if (prod) {
    fs.copyFileSync(path.join(VAULT_PLUGIN_DIR, "main.js"), RELEASE_MAIN);
    console.log("✓ copied main.js → 仓库根目录");
  }
  process.exit(0);
}
