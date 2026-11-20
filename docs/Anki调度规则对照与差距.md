# Anki 调度规则对照（源码核对）

> 来源：直接克隆 `ankitects/anki` 源码（sparse checkout `rslib/src/scheduler`），
> 核对 `states/learning.rs`、`states/steps.rs`、`states/relearning.rs`、`answering/*.rs`。
> 目的：把 Anki 真正有价值的工程设计吃进来，而不是盲目搬源码（核心 FSRS 算法我们已用同一套官方公式）。

## 关键认知

Anki 的 FSRS **就是**我们已实现的 FSRS-7（同 `srs-benchmark` 公式）。搬源码能拿到的是**调度外壳**——学习/重新学习步骤、毕业规则、fuzz、短间隔处理——不是更准的遗忘曲线。

## 规则对照表

| 规则 | Anki 官方（源码） | 我们当前实现 | 状态 |
|---|---|---|---|
| 学习步骤默认值 | `learn_steps=[1.0, 10.0]` 分钟 | `1m 10m` | ✅ 对齐 |
| Good 进下一步 | `good_delay_secs` 取下一步 | 实现 | ✅ |
| Good 走完毕业 | `Review`，间隔用 `states.good.interval`（≥0.5d），非 FSRS 才用 graduating_interval | 已改为 FSRS good 首间隔（graduatingDays 仅作下限） | ✅ 已修 |
| Again 回第一步 | `remaining_for_failed()` = 全部步数 | 回 idx=0 | ✅ |
| Hard 第一步 | avg(again, good) 秒 | (1+10)/2=5.5m | ✅ |
| Hard 其它步 | 重复当前步 | 实现 | ✅ |
| Easy 任意步毕业 | `states.easy.interval`，且保证 > good | **我们用 FSRS 首次初始化** | ⚠️ 接近但间隔来源不同 |
| 步骤期记忆状态 | **有**：`fsrs_next_states[评级].memory` | 已改为每步更新并写回 S/D（拟合可用） | ✅ 已修 |
| 步骤期 fuzz | +0~25%（最多5分钟） | 无 | ⚠️ 未做（可选，非核心） |
| 短间隔 (<0.5d) | `fsrs_allow_short_term` 时 LearnState 排当天 | 直接按分钟排 + 跨天强制毕业 | ✅ 等价 |
| 重新学习步骤 | `relearn_steps`（忘了后再走 1m/10m） | 已实现（relearn phase + 设置项） | ✅ 已补 |
| 重新学习 Again | `failing_review_interval` + 重置重学步骤 | Again 回第一步、三元组按 FSRS lapse 更新 | ✅ 已补 |

## 实施结果与真机验证

已按上表前 3 项修正并落地（fuzz 未做，属可选）：

- 学习步骤默认 `1m 10m`、重学步骤默认 `1m 10m`，均可在设置里改/关；
- 步骤期每次评级更新并写回三元组（拟合可用，解决"短步骤让拟合样本变少"的副作用）；
- 毕业间隔走 FSRS good/easy 首间隔（90% 留存率真正作用到毕业）；
- 跨天强制毕业（步骤只在建档当天，避免变成长阶梯）。

真机验证（实例 `bzrv-steps2`）：当天新卡首次 Good → `phase=ladder, stage=1, nextReviewDate=10 分钟后`，三元组写入 3.92/3.14/3.5；无 console error。截图 `51-52-*.png`。

## 注：源码许可

Anki 源码为 AGPL-3.0。我们只**参考规则**（规则/公式属事实，不受版权保护），不复制其代码。实现为独立 TS 代码。
