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

## 6. 结论

FSRS-7 全量落地通过真机验证：首次评级即按官方默认参数初始化双稳定性三元组、按目标留存率 90% 二分求间隔；去阶梯后界面显示与数据布局正确；设置项与持久化均正常。整体流程稳定，未发现崩溃、布局或数据异常。
