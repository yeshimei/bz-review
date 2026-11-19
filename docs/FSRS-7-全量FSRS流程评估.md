# FSRS-7 全量 FSRS（去阶梯）流程评估

> 状态：**已实现并提交**（见 [实现说明](FSRS-7-实现说明.md) 与 [真机验证报告](FSRS-7-真机验证报告.md)）。
> 依据：官方算法 wiki（2026-11-16 更新）、`srs-benchmark/models/fsrs_v7.py`、
> `fsrs_v7_interval_penalty.py`、fsrs-rs README。

## 1. 目标口径（已按用户拍板收敛）

- 算法升级到 FSRS-7：官方最新版，34 参数，记忆状态 `(S_long, S_short, D)` 双稳定性，11 参数遗忘曲线，间隔按目标留存率迭代求解。
- 留存率**开放给用户设置**（默认 0.9，官方推荐值）；拟合全自动后台跑、无设置项。
- 去掉 10 级阶梯，所有卡片从第一次评级起就走 FSRS。

## 2. 现状流程（有阶梯）

- 新卡：`stage=0 / phase=ladder / stability=1 / difficulty=0.3`（`data.ts` 建档）。
- 评级：固定间隔表爬级 `1m → 30m → 6h → 1d → 3d → 7d → 15d → 30d → 60d → 120d`（`again-1 / hard 不变 / good+1 / easy+2`）。
- 爬到 stage≥9 才初始化 S/D（`initS/initD`）进入 FSRS，此后由 S/D/R 动态算间隔。
- 队列三区（逾期/今天/未来）+「开始本轮」只看 `nextReviewDate` 与 R 值，跟 phase 无关。
- 拟合：`app.ts` 每 N 次评级 fire-and-forget 跑 `fitFromItems`，结果写 `review-fit.json`，调度时 `resolveWeights` 读回。

## 3. 去掉阶梯后的复习流程（推演）

新卡建档就不再有 ladder 状态：建档时按 FSRS-7 初始化三元组 `(S_long, S_short, D)`，但**首次评级前 S 不落库**（首次评级决定初始值，见下）。

**第一次见卡（从未复习）**
1. 用户点四档之一 → `scheduleNext` 走 FSRS 分支，判断 `totalReviews===0`（无 lastReviewed）。
2. 初始化：`S_long = w[G-1]`（again/hard/good/easy 分别取 w0..w3），`S_short = 0.8 × S_long`，`D = initD(G)`（FSRS-7 公式 `clamp(w4 − e^(w5(G−1)) + 1, 1, 10)`）。
3. 不经过 S 更新公式（FSRS-7 首次没有"第 0 次复习"，初始 S 直接学出来）。
4. 按目标留存率 R=0.9 迭代求间隔 `I`（求 R(t)=0.9 的 t，用牛顿法/二分，官方 `fsrs_v7_interval_penalty.py` 的 `_interval` 口径）。
5. 落盘 S_long/S_short/D、lastReviewed、`nextReviewDate = now + I`。

**之后每次复习**
1. 队列照旧：到点（或 R<0.9 提前）才出现在「今天/逾期」。
2. 评级时算当前留存：`R(t) = (W_short·R_short + W_long·R_long)/(W_short+W_long)`（双曲线加权，权重依赖 S_short/S_long/D）。
3. 更新长期 S：`a=7`，用混合 R；`S'_long = max(S_long, S_fail)` 或 `S_long·SInc`（again 取失败式，其余成功式）。
4. 更新短期 S：`a=15`，用 `R_short`；again 后额外 `S'_short = min(S'_short, 0.8·S'_long)`。
5. 更新难度：`ΔD = −w6·(G−3)·L·(10−D)/9`（again 时 `L=R+0.1`，其余 `L=1`），`D' = clamp(0.01·D_init(4) + 0.99·(D+ΔD), 1, 10)`。
6. 迭代求新间隔 `I`（R(I)=0.9），乘间隔缩放系数、压到最长间隔上限与 1 分钟下限，落盘。

**拟合（后台，无 UI）**
- 仍按 N 次评级触发；`fit.ts` 换成 34 维联合优化器（官方用 Adam + L2 prior，默认参数起步），从回放日志拟合后写入 `review-fit.json`，调度读回。样本门槛保留（<100 不拟合）。

## 4. 官方默认参数试算（本仓脚本复刻官方公式，R=0.9）

| 首次评级 | S_long | S_short | D | 首次间隔（R=0.9） |
|---|---|---|---|---|
| again | 0.1104d | 0.0883d | 6.17 | ≈0（当天反复） |
| hard | 2.2395d | 1.7916d | 5.26 | ≈14.3h |
| good | 3.9221d | 3.1377d | 3.53 | ≈4.8d |
| easy | 11.7841d | 9.4273d | 1.00 | ≈53.9d |

- good 卡 R 衰减：`t=1d→0.937`、`2d→0.925`、`4d→0.906`、`7d→0.885`（双曲线"当天陡、之后缓"）。
- 官方 Anki FAQ 明确"首次 Good 间隔 3–5 天是正常的"——4.8d 属正常口径，不是算错。
- 对照现状：阶梯首次 good 是 6 小时。FSRS-7 全量口径**首间隔显著变长**，这是产品体感上最大的变化。

## 5. 影响面（要改的文件）

- 核心：`fsrs.ts`（R/S/D/迭代求解）、`fit.ts`（34 维优化器）、`weights.ts`（19→34）、`data.ts`（建档与字段）。
- 调用链：`app.ts`（评级写盘、通知文案）、`queue.ts`、`render.ts`、`deck.ts`、`stats*.ts`、`analysis/*`、`book-summary.ts`（R 口径与权重默认值）。
- 设置：`settings-schema.ts` 移除自动拟合开关/手填权重/拟合频率等项（用户拍板不暴露）。
- 测试：所有断言 DEFAULT_W 长度、阶梯间隔、S/D 数值、拟合的用例重写。
- 文档：README（"两段式/十级阶梯"段）、note、AGENTS.md（FSRS 描述）。

## 6. 关键结论

1. **流程走得通**：去掉阶梯后，首次评级直接学出 `(S_long, S_short, D)`，之后每轮按双曲线算 R、更新三元组、迭代求间隔。队列/三区/额度/撤销都不用改。
2. **最大体感变化**：首次 good 从"6 小时"变成"约 4.8 天"，easy 约 54 天。对新卡偏激进，但这是官方 FSRS-7 的设计（初始稳定性学出来就是这么多）。
3. **最大技术风险**：34 维联合拟合器要自研（官方 Rust/WASM 有 Electron 集成风险），必须配回归测试证明收敛、不产坏参数。

## 7. 关于"首次 easy 54 天会不会全忘"的查证结论

**官方明确答复：正常，不会"全忘"。**

- [Anki 官方 FSRS FAQ Q1](https://docs.ankiweb.net/faqs/frequently-asked-questions-about-fsrs)："My first interval for Good is 3-5 days, and my first interval for Easy is over a week long! Is this normal? **Yes.** FSRS tends to give longer first intervals than SM-2, but for mature cards the opposite is true - FSRS is more conservative."（首次间隔比 SM-2 长是设计如此，成熟卡反而更保守。）
- [Anki 官方 Deck Options · FSRS](https://docs.ankiweb.net/manual/deck-options#fsrs)：desired retention 90% 的语义是"到期时约 90% 概率记得"——**这正是"科学地允许忘 10%"**，不是保证不忘。首次 easy 排长间隔，是因为你点 easy = 告诉算法"这张我一看就会"，算法按最高初始稳定性（w3=11.8d）安排，到期时仍有 90% 概率记得。
- 关键认知：**间隔长 ≠ 会全忘**，它建立在"到 90% 临界点就复查"的模型上。真正的风险是用户误点 easy（其实没记住却点简单），官方在 FSRS 设置里专门警告 Hard 滥用会导致间隔虚高；首次 easy 误点同理——这是评级纪律问题，不是算法 bug。
- 我试算的 54.9 天比官方 FAQ 举例的"over a week"更激进，原因是 FSRS-7 默认 w3=11.78d 比 Anki 内置 FSRS-4.5/5 的初始稳定性大，且我没有套用 Anki 的 `easy-interval` 上限（Anki 对新卡有单独的 easy interval 设置，本仓没有）。**54 天是纯 FSRS-7 默认参数的裸算结果**，需要用户确认接受。

**可调退路（若要缩短首间隔）**：官方唯一认可的手段是 desired retention（提高→缩短所有间隔）。最终实现按用户拍板把留存率**开放为设置项**（默认 0.9），所以用户可自行调高来缩短首间隔。

## 8. 真实插件代码长期仿真（最终验证）

用插件真实排期代码（`src/review/fsrs.ts` 的 `FSRS` / `scheduleNext`）跑蒙特卡洛：每天随机新增 0～5 张、5 个种子取平均、目标留存 0.9、最长间隔不限。脚本 `scripts/fsrs7-sim-real.ts`，完整表格见 README「排期算法的长期仿真验证」。

关键结论（1 个月 → 10 年）：

- 实际留存率全程 86.9%～87.9%，围绕 90% 目标稳定，不随时间恶化；
- again 率稳定约 12%，与"90% 留存对应约 10% 遗忘"吻合；
- 日均复习 7→50 次、单日峰值 13→63，负担由加卡速度（日均约 2.5 张）决定；
- 平均间隔 9→217 天、S_long 中位数 11→682 天，记得越牢排得越疏；
- 平均难度稳定 4.1～5.5，成熟卡半年达 85%、十年 99%。

注：`S_short` 在长期成功回忆下会膨胀到千天级，这是官方 FSRS-7 `a=15` 短期分支的真实特性——它是模型内部量、不等于"天数"语义，故表格不展示其裸值，改以 S_long（有天数语义）作稳定性指标。
