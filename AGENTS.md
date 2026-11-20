# Review（复习）—— 干活约定

Obsidian 插件，从 bz 的「复习计划」独立出来。域 = `src/<域>/`，`core` 是共享层、`data` 是数据与授权层。中文输出。**bz 里那份复习原样保留不动**，两边数据各存各的、互不影响；这里只改本仓，不碰 bz。

## 动手之前：先读，再说，等回话

先分清轻重：简单改动直接做，不用走下面的清单流程。

「简单」只有两类：只动文档、注释、文案、错别字或排版格式；或用户已经把改法说死、照做即可且只碰一个文件、不改行为、没有取舍的小修（例如删掉一句话、改一个数字、换一个链接）。超出这两类，一律走下面流程。

在改动代码之前，请先勘察相关代码细节，不要直接修改代码。然后按顺序列出五个清单，每个清单都要有编号，清单内每一项也用序号列出；每项用一句话或一段话，通俗、简洁地说明，不要附任何代码细节或技术细节：

1. 针对我提出的问题/需求，说明你是如何理解的、准备怎么做。
2. 指出我可能疏忽、会导致问题的地方，并附上你的建议。
3. 就以上问题，列出可以优化、增强的方向。
4. 列出你不确认、需要我回答的问题。
5. 每次都在 worktree 里改代码，改完只部署到测试库；没有我的明确指令，不得合并到主分支。

等我确认后再改动代码。

所有事情做完后，必须逐项跑真机验证并截图，把每项的描述和完整截图写进一份 Markdown 报告发给我点开查看。

## 硬约束（看见就是错）

1. 样式只认 `src/<域>/styles.css`（共享基线 `src/core/`、组件 `src/core/ui/`），构建时聚合成根 `styles.css`；域内禁内联视觉与裸选择器——构建期对裸选择器硬断言失败，锚点是 `[data-bzrv]` / `#bzrv-`，私有变量 `--bzrv-*`。
2. 生成物一律不手改：根 `main.js`、根 `styles.css`，都是构建聚合产物，改源再构建。
3. 命令 ID 用 `review-<动作>`；通知正文不带 emoji，新语义先查 `src/core/notice.ts` 的 `ICONS`，确无匹配再加类型（图标 + 颜色 class + 默认时长），别把 emoji 写进正文。
4. 数据默认写 `CONFIG/REVIEW/review.json`（另有 `review-quiz.json` / `review-fit.json`），与 bz 的 `CONFIG/STORAGE/review.json` 分开；「从 bz 导入」只导一次、不覆盖、不动 bz 的数据（`src/data/migrate.ts`）。storagePath 已是显式值一律原样透传，别当成要搬家。
5. 改动走仓库外 worktree 并从最新 master 分叉，worktree 内不构建。
6. 授权是离线验签，签名密钥只在 `scripts/keys/`（gitignore），绝不进提交、绝不外发；基础版笔记与划线卡合计 50 条、高级版不限，功能两边完全一致——数量门控别写成功能差异；批量导入按导入后合计判断，允许越过 50 的这一次整批放行并提醒，合计已满则整批拒。
7. 给 bz Reader 的门面是插件实例上的 `reviewApi`（`src/main.ts`），契约 `version` 只在语义变更时升；分工是「Reader 决定哪些内容值得复习，Review 只负责复习」，别在 Review 里重做选题/出题。
8. 未定稿探索稿只放 `.scratch/<名>/`，不得混入 `src/`。
9. 强调色是全局设计变量，不是装饰：选中态、主按钮、链接、进度条、chip、焦点环、状态点等一切「交互色」都必须走强调色 token，禁止写死铜色。每个原型 / 设计都要带强调色切换并验过每一档的可读性；规则见下节「强调色（accent）」。
10. **禁止悬停气泡属性（2026-11-17）**：插件生成的 DOM 一律不挂 `aria-label` / `title`，也不调用 `setTooltip()`——Obsidian 会把它们变成悬停气泡，用户看着像「莫名其妙的小弹窗」。纯图标控件的可读名字改用视觉隐藏文本：模板里写 `<span class="bzrv-sr-only">名字</span>`，DOM API 用 `src/core/ui/sr-text.ts` 的 `srText()` / `withSrText()`；`aria-labelledby` 指向隐藏节点也可以用（它不触发气泡）。提交前跑 `node scripts/check-tooltip-attrs.mjs`，有违规就停。
11. **头行几何与 bz Reader 同源（2026-11-19）**：`.bzrv-panel-head` 的高度、左右留白、右侧图标钮的尺寸/间距/距底一律读 `--bzrv-head-*` token，域内不许再写死数字（窄屏档也是改变量，不写选择器）。基准是 Reader 的 `.bzs-stuhead` / `.bzs-stuacts`（`D:/Obsidian/bz-reader/src/shell/styles/study.css`）：嵌入「复习」页签时四颗图标就住在那条动作栏里，数字一歪切页就跳。

## 强调色（accent）—— 所有原型与设计通用

强调色取自 bz Reader 的偏好项 `accent`，原型与后续设计一律按这套来，别各画各的。

1. **色板精简为 4 档**（bz Reader 原为 8 档，这里只保留常用的）：`auto` 跟随 Obsidian（读宿主 `--interactive-accent`，读不到回退铜金）/ `copper` 铜金 / `indigo` 黛蓝 / `moss` 苔青。每档亮暗各一值，来自 `D:/Obsidian/bz-reader/src/data/prefs.ts:300-374`：

   | 档 | 亮色 | 暗色 |
   |---|---|---|
   | auto | 宿主，回退 `#9a7434` | 宿主，回退 `#c8a464` |
   | copper 铜金 | `#9a7434` | `#c8a464` |
   | indigo 黛蓝 | `#3f5b8f` | `#8aa7d6` |
   | moss 苔青 | `#4c6b52` | `#93b79a` |

2. **token 分层**：主色 `--accent`；柔底 `--accent-soft`（主色 12% 透明）；描边 `--accent-line`（38%）。原型层可再把老名字 `--copper` 别名到 `--accent`，但新代码只用 `--accent` 这组。落地到源码时用本仓私有前缀 `--bzrv-accent*` / `--bzrv-*`，别把 bz Reader 的 `--copper` 原样搬进 `src/`。
3. **注入方式**：根元素上写 `data-accent="<档位>"`，CSS 按 `body[data-accent=…]` 覆盖 `--accent`，派生色用 `color-mix(in srgb, var(--accent) N%, transparent)` 自动跟随。禁止给每个组件写死颜色值。
4. **影响范围（评审时逐项过一遍）**：分段选中 / 页签下划线 / 主按钮 / 链接 hover / 进度条与圆点 / 热力图色阶 / chip 选中 / 状态点 / 焦点环 / 输入框聚焦 / 卡片发丝线 / 高亮。语义色（成功/警告/危险）另算，不跟强调色走。
5. **设置页控件**：分段按钮 + 彩色圆点 swatch（不是下拉），跟随 Obsidian 档的圆点用 `var(--interactive-accent)`。照搬 `D:/Obsidian/bz-reader/src/shell/render/settings.ts:292-299`。
6. **规则**：从现在起任何原型、设计稿、UI 改动都要先确认「切强调色后是否还成立」，评审交付默认带一个可点的强调色切换器；只做亮色评审时也一样先把 token 接好。

## 开发工作流（测试库直出）

改 UI 的快速循环走测试库 `E:/Obsidian/bz reader`（插件目录 `…/.obsidian/plugins/bz-review`）：

- **日常只落测试库**：构建显式带 `BZ_REVIEW_VAULT_DIR="E:/Obsidian/bz reader/.obsidian/plugins/bz-review"`；缺省落主库 `E:/Obsidian/叫我包仔`，漏写就把半成品推进主库了——构建前先确认。`node esbuild.config.mjs` = watch 常驻（同时监听 CSS 自动重出 `styles.css`）；`node esbuild.config.mjs once` = 一次性开发构建；`node esbuild.config.mjs production` = 发布构建（压缩、无 sourcemap），额外把 `main.js` 复制到仓库根。
- **开机直达弹窗**：往测试库数据目录（默认 `CONFIG/REVIEW`）放 `debug-open.json`，内容 `{"command":"review-open"}`（换成目标命令 ID），插件 layout-ready 后自动执行；文件坏 / 命令不存在一律静默跳过。删掉文件即恢复常规启动。
- **门禁口径不变**：改完在 worktree 跑 `npm test`（vitest）+ `npm run typecheck`（tsc --noEmit）+ 自审 + diff 审查；测试库只管「人眼看效果」，不算验证。

## 提交

- Conventional Commits（`feat`/`fix`/`style`/`perf`…），标题一眼能看出改了什么。
- 合入流程：worktree → `git merge master` → 门禁（见上）→ 合回主仓 → 推送。
- **合并之后必须清除 worktree（硬性）**：分支一合回 master，同一个动作里就收尾——`git worktree remove <路径>` → `git worktree prune` → `git branch -d <分支>`。留着的已合并 worktree 只会攒成一片旧目录，还容易让人误以为改动没进主分支。worktree 里挂了 `node_modules` junction 的，先摘 junction 再删目录（Windows 直接递归删会把主仓依赖一起带走）。**没合并的分支一个都不许删**，只清理已合并的那批；清完用 `git worktree list` 复核。
- 本仓目前只有本地分支、没配 remote；要推送先确认目标远端。

## 去哪儿查

| 要什么 | 去哪 |
|---|---|
| 域职责、术语、口径 | `README.md` + 对应域文件头注释 |
| 复习数据落在哪 / 键常量 | `src/review/keys.ts`；迁移与双插件路径 `src/data/migrate.ts` |
| 命令清单 | `src/main.ts` 的 `addCommand` |
| 给 Reader 的契约 / 卡片输入 | `src/review/reader-api.ts` + `src/main.ts` 的 `reviewApi` |
| 排期算法（FSRS / 阶梯） | `src/review/fsrs.ts`、`src/review/queue.ts`、`src/review/weights.ts` |
| 四种复习方式 | `src/review/card-mode.ts` + `tests/card-mode.test.ts` |
| 激活码 / 数量门控 | `src/data/entitlement.ts`、`src/data/license.ts`、`scripts/gen-keys.mjs`、`scripts/issue-license.mjs` |
| 样式作用域与聚合 | `scripts/build-css.mjs`、`scripts/css-scope.mjs` 文件头 |
| 通知语义与图标 | `src/core/notice.ts` 的 `ICONS` |
| 头行几何（与 Reader 对齐的那套数） | `src/core/ui/tokens.css` 的 `--bzrv-head-*`；Reader 对应 `src/shell/styles/study.css` 的 `.bzs-stuhead` / `.bzs-stuacts` |
| 测试怎么写（纯逻辑 / 搬 UI 测试） | `vitest.config.ts` 文件头 |

本文与代码冲突时以代码为准，并顺手改这里。
