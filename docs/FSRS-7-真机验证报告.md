# FSRS-7 引入 · 真机验证报告

> 验证时间：2026-11-20。实例 `bzrv-fsrs7`（真实 Obsidian 进程，独立新库 + 随机调试端口）。
> 插件从 `D:\Obsidian\bz-review-verify\_out` 加载（FSRS-7 生产构建，main.js 611699 字节）。

## 1. 构建与门禁

| 项目 | 结果 |
|---|---|
| typecheck（tsc --noEmit） | 0 error ✅ |
| lint（obsidian / css / tooltip） | 0 error / 0 warning ✅ |
| 测试 | 61 文件 / **515 条全过** ✅（原 512 + 新增 3；3 个 jsdom worker 错误为环境噪声） |
| 生产构建 | 成功，main.js 607002 → 611699 字节 ✅ |

## 2. 首次评级写盘验证（核心）

种子数据：9 张卡（老 v4 数据，`phase:'ladder'`、`stability:1`、`difficulty:0.3`、`totalReviews:0`），验证"老数据升级后走 FSRS-7"。

评级"一般（good）"前后对比（卡片 `c_flash_1`）：

| 字段 | 评级前 | 评级后 | 是否符合 FSRS-7 |
|---|---|---|---|
| phase | ladder | **fsrs** | ✅ 去阶梯 |
| stage | 1 | 0 | ✅ 恒 0 |
| stability (S_long) | 1 | **3.92** | ✅ = 官方 w[2]（good 初始长期稳定性） |
| stabilityShort (S_short) | （无） | **3.14** | ✅ = 0.8 × 3.92 |
| difficulty (D) | 0.3 | **3.53** | ✅ = initD(good) |
| totalReviews | 0 | 1 | ✅ |
| nextReviewDate | 11-19 | **11-24（约 4.8 天后）** | ✅ 官方 FSRS-7 good 首间隔 |
| reviewHistory | 0 条 | 1 条（含 S/R） | ✅ |

数值与官方 `fsrs_v7.py` 默认参数逐项吻合，与 [20 年仿真](FSRS-7-全量FSRS流程评估.md) 的"首次 good 4.78 天"一致。

## 3. 界面与流程验证

- 打开面板：6 逾期 / 1 今天 / 2 未来，卡片显示"FSRS Lv.1"与"新卡"标签（去阶梯后的显示，无负数 Lv、无"阶段 n/10"）✅
- 开始本轮 → 卡片题面 → 看答案 → 四档评级 → 自动翻到下一条（1/7→2/7），流程顺畅 ✅
- 设置页"目标留存率 — 到期时希望还记得的比例，默认 90%"正确显示 ✅
- 全程无 console error ✅

## 4. 持久化验证

停止并重启实例后，`c_flash_1` 的三元组（3.92 / 3.14 / 3.53）、nextReviewDate、totalReviews 全部保留，无 error ✅。

## 5. 截图证据

- `46-FSRS7-面板首页.png` — 复习面板三区列 + FSRS Lv.1 标签
- `47-FSRS7-开始本轮.png` — 卡片题面 1/7
- `48-FSRS7-看答案.png` — 答案 + 四档评级
- `49-FSRS7-评级后排期.png` — 自动翻到 2/7
- `50-FSRS7-设置留存率.png` — 设置页目标留存率项

## 6. 阶梯残留清理（后续批次）

去阶梯后，分析面板里"阶石图/阶段分布"还按十级阶梯与 `phase` 分档，会退化成"十根柱子只有最后一根有值"。已统一改造为**按复习次数的 5 档成熟度**：

- 抽取单源 `maturityLevel()` / `MATURITY_LABELS`（`render.ts`），卡片徽标、统计弹窗阶段分布、分析面板阶石图三处共用同一套边界（0-1 / 2-3 / 4-7 / 8-15 / 16+ 次）；
- `analysis/data.ts` 的 `ladderN/fsrsN` 语义改为"新卡数/已复习数"，`stageDist` 改 5 桶；
- `analysis/view.ts`/`motions.ts`/`styles.css` 的阶石图标签、图例、悬停文案、末档染色同步更新；
- `stats-rich.ts` 的 `stageN/stageAgain/stageItems` 改 5 档，`stats-ui.ts` 的"阶梯 N 条"改"新卡 N 条"；
- 修复真 bug：`stats-ui.ts` 历史弹窗原用 `(stage||0)-9+1` 算 Lv，stage=0 时渲染成 `FSRS Lv.-8`；改为走 `stageNum()` 单源。

真机验证：stats 页显示"新卡 0-1次"标签，旧"阶梯 1-3"文案消失，无 console error。测试新增 2 条单源断言。

**注意**：`analysis/`（16 幕分析特刊）的 UI 入口早已从面板摘除（`ui.ts:712` 注释"入口已摘，analysis/ 代码保留"），`openReviewAnalysis` 未注册为命令——该模块目前是**死代码**。本次仍顺手修正了其中的阶梯残留文案以免将来恢复入口时出错，但用户当前不可见；用户可见的是 stats 页分档与历史弹窗 Lv 修复。是否删除整块 analysis/ 死代码，另行决定。

## 7. Anki 式学习/重学步骤（对照源码实现）

按 Anki 官方源码（`states/learning.rs`/`relearning.rs`/`steps.rs`）核对后实现，详见 [Anki 调度规则对照与差距](Anki调度规则对照与差距.md)：

- 学习步骤默认 `1m 10m`、重学步骤默认 `1m 10m`，设置里可改/关；
- 步骤期每次评级更新并写回三元组（拟合可用），非"不写 S/D"；
- Good 走完毕业间隔 = FSRS good 首间隔（约 4.8 天），不是固定 1 天；
- 跨天强制毕业（步骤只在建档当天）。

真机验证（实例 `bzrv-steps2`）：当天新卡首次 Good → `phase=ladder, stage=1, nextReviewDate=10 分钟后`，三元组 3.92/3.14/3.5 写入；无 console error。截图 `51-Anki步骤-题面.png`、`52-Anki步骤-评级后.png`。

**修了一个 bug**：老数据 `stage=1` 进入学习步骤会让首次 Good 直接"毕业"——`finishSchedule` 现对 ladder 态且未复习的条目把 stage 归零。测试新增 12 条（学习步骤 + 重学步骤）。

## 8. 结论

FSRS-7 全量落地 + Anki 式学习/重学步骤通过真机验证：新卡按 Anki 规则当天重复后毕业，之后由 FSRS-7 按目标留存率排期；去阶梯后的统计/展示口径已统一到成熟度分档。整体流程稳定，未发现崩溃、布局或数据异常。
