# Review（复习）—— 干活约定

Obsidian 插件，域 = `src/<域>/`，`core` 是共享层、`data` 是数据与授权层。中文输出。

## 动手之前：先读，再说，等回话

先分清轻重：简单改动直接做，不用走下面的清单流程。

「简单」只有两类：只动文档、注释、文案、错别字或排版格式；或用户已经把改法说死、照做即可且只碰一个文件、不改行为、没有取舍的小修（例如删掉一句话、改一个数字、换一个链接）。超出这两类，一律走下面流程。

在改动代码之前，请先勘察相关代码细节，不要直接修改代码。然后按顺序列出五个清单，每个清单都要有编号，清单内每一项也用序号列出；每项用一句话或一段话，通俗、简洁地说明，不要附任何代码细节或技术细节，每一项都使用递增序号，使用表格组织结构：

1. 针对我提出的问题/需求，说明你是如何理解的、准备怎么做。
2. 指出我可能疏忽、会导致问题的地方，并附上你的建议。
3. 就以上问题，列出可以优化、增强的方向。
4. 列出你不确认、需要我回答的问题。
5. 代码实现完成后，先进行代码审查（Code Review），根据审查意见完成修复，并做必要的回归验证。随后按照用户列出的问题清单逐条进行真机测试，测试范围覆盖桌面端和移动端，最后输出一份 HTML + 本地服务方式预览截图格式的测试报告，报告中逐项附上：问题描述、解决后通俗易懂的一句话说明、对应截图证据；必要时提供修复前后对比。每条问题还需记录测试结论（通过/不通过/待确认），未通过项说明原因及后续处理。
6. 每次都在 worktree 里改代码，改完只部署到测试库；没有我的明确指令，不得合并到主分支。
7. 等我确认后再改动代码。

## 硬约束（看见就是错）

1. 样式只认 `src/<域>/styles.css`（共享基线 `src/core/`、组件 `src/core/ui/`），构建时聚合成根 `styles.css`；域内禁内联视觉与裸选择器——构建期对裸选择器硬断言失败，锚点是 `[data-bzrv]` / `#bzrv-`，私有变量 `--bzrv-*`。
2. 生成物一律不手改：根 `main.js`、根 `styles.css`，都是构建聚合产物，改源再构建。
3. 命令 ID 用 `review-<动作>`；通知正文不带 emoji，新语义先查 `src/core/notice.ts` 的 `ICONS`，确无匹配再加类型（图标 + 颜色 class + 默认时长），别把 emoji 写进正文。
4. 数据默认写库根 `bz-review/storage/review.json`（另有 `review-quiz.json` / `review-fit.json`），与 bz 的 `CONFIG/STORAGE/review.json` 分开；「从 bz 导入」只导一次、不覆盖、不动 bz 的数据（`src/data/migrate.ts`）。storagePath 已是显式值一律原样透传，别当成要搬家。
5. 改动走仓库外 worktree 并从最新 master 分叉，worktree 内不构建。
6. 授权是离线验签，签名密钥只在 `scripts/keys/`（gitignore），绝不进提交、绝不外发；基础版笔记与划线卡合计 50 条、高级版不限，功能两边完全一致——数量门控别写成功能差异；批量导入按导入后合计判断，允许越过 50 的这一次整批放行并提醒，合计已满则整批拒。
7. 给 bz Reader 的门面是插件实例上的 `reviewApi`（`src/main.ts`），契约 `version` 只在语义变更时升；分工是「Reader 决定哪些内容值得复习，Review 只负责复习」，别在 Review 里重做选题/出题。
8. 未定稿探索稿只放 `.scratch/<名>/`，不得混入 `src/`。
9. 强调色是全局设计变量，不是装饰：选中态、主按钮、链接、进度条、chip、焦点环、状态点等一切「交互色」都必须走强调色 token，禁止写死铜色。每个原型 / 设计都要带强调色切换并验过每一档的可读性；规则见下节「强调色（accent）」。
10. 禁止悬停气泡属性

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
| 排期算法（FSRS-7 全量，无阶梯） | `src/review/fsrs.ts`、`src/review/queue.ts`、`src/review/weights.ts` |
| 四种复习方式 | `src/review/card-mode.ts` + `tests/card-mode.test.ts` |
| 激活码 / 数量门控 | `src/data/entitlement.ts`、`src/data/license.ts`、`scripts/gen-keys.mjs`、`scripts/issue-license.mjs` |
| 样式作用域与聚合 | `scripts/build-css.mjs`、`scripts/css-scope.mjs` 文件头 |
| 通知语义与图标 | `src/core/notice.ts` 的 `ICONS` |
| 头行几何（与 Reader 对齐的那套数） | `src/core/ui/tokens.css` 的 `--bzrv-head-*`；Reader 对应 `src/shell/styles/study.css` 的 `.bzs-stuhead` / `.bzs-stuacts` |
| 测试怎么写（纯逻辑 / 搬 UI 测试） | `vitest.config.ts` 文件头 |

本文与代码冲突时以代码为准，并顺手改这里。
