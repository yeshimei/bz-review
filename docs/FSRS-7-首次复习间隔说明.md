# FSRS-7 首次复习间隔说明（供外部核验）

> 数字来自插件**真实代码**：`src/review/fsrs.ts`。
> 复现命令：`node --experimental-strip-types scripts/fsrs7-first-interval.ts`
> （脚本内交叉校验了 `scheduleNext` 与直接求解一致。）

## 结果

目标留存率 DR = 0.9（官方默认推荐），权重为官方 FSRS-7 默认 34 参数，最长间隔不限（插件默认）。

| 首次评级 | G | 初始 S_long(天) | 初始 S_short(天) | 初始 D | 理论间隔(天) | 实际间隔（最短1分钟钳位后） | 提示文案 |
|---|---:|---:|---:|---:|---:|---:|---|
| again（忘了） | 1 | 0.1104 | 0.0883 | 6.17 | ≈0 | 0.0007 天 ≈ 1 分钟 | 1m |
| hard（困难） | 2 | 2.2395 | 1.7916 | 5.26 | 0.5975 | 0.5975 天 ≈ 14.3 小时 | 14h |
| good（一般） | 3 | 3.9221 | 3.1377 | 3.53 | 4.7777 | 4.7777 天 ≈ 4 天 18 小时 | 5d |
| easy（简单） | 4 | 11.7841 | 9.4273 | 1.00 | 53.8695 | 53.8695 天 ≈ 54 天 | 54d |

## 计算口径（可据此逐步验算）

**1. 首次评级初始化**（官方 wiki "Initial stability"/"Initial difficulty"）：

```
S_long,0 = w[G-1]           # G=1..4 对应 again/hard/good/easy
S_short,0 = 0.8 × S_long,0
D_init(G) = clamp( w[4] − exp(w[5]×(G−1)) + 1, 1, 10 )
```

例：good → w[2]=3.9221，S_short=3.1377；D=clamp(6.1686−e^1.2914+1)=3.53。

**2. 遗忘曲线**（双稳定性加权，官方 wiki "Retrievability"）：

```
d_short = w[23] × S_short^(w[33]−0.3)
f_short = w[25]^(-1/d_short) − 1
R_short(t) = (1 + f_short·t/S_short)^(-d_short)

d_long = w[24]
f_long  = w[26]^(-1/d_long) − 1
R_long(t) = (1 + f_long·t/S_long·e^((w[32]−0.3)(D−5)))^(-d_long)

W_short = w[27] × S_short^(-w[29])
W_long  = w[28] × S_long^w[30] × e^((w[31]−0.5)(D−5))
R(t) = (W_short·R_short(t) + W_long·R_long(t)) / (W_short + W_long)
```

**3. 间隔**：二分求 `R(t) = 0.9` 的 t（R 对 t 单调递减，60 次二分，返回 `(lo+hi)/2`）。无解析解——这是 FSRS-7 与 v4 的关键区别。

**4. 落盘钳位**：`max(t, 1/1440 天)`（1 分钟下限），scale=1、最长不限。故 again 的近零理论间隔被抬到 1 分钟。

## 参数（官方 FSRS-7 默认 34 维，`srs-benchmark/models/fsrs_v7.py` 的 `init_w`）

```
[0.1104, 2.2395, 3.9221, 11.7841, 6.1686, 0.6457, 3.6807, 1.9795, 0, 1.3826,
 0.7024, 0.5999, 0.8146, 0.6398, 1, 1.3207, 0.6707, 3.8668, 0.4416, 0.0934,
 1.8631, 0.6162, 1.0869, 0.1567, 0.0801, 0.2421, 0.9464, 0.1433, 0.7145,
 0, 0.5667, 0.3734, 0.5333, 0.3048]
```

## 两点需要核验时特别注意

1. **again 理论间隔 ≈0 是正常的**：again 的初始 S_long 仅 0.1104 天（约 2.65 小时），遗忘极快，R(t) 在极小 t 就跌破 0.9；插件用 1 分钟下限兜底。不是除零或算错。
2. **easy ≈54 天比 Anki 常见值长**：因为这里用的是**纯 FSRS-7 默认参数裸算**，没有套 Anki 对新卡的 `easy-interval` 上限（Anki 有单独的"简单间隔"设置，本插件没有）。[Anki 官方 FAQ Q1](https://docs.ankiweb.net/faqs/frequently-asked-questions-about-fsrs) 明确"首个 easy 间隔超过一周是正常的"，54 天属同一设计方向的上限情形。

## 官方来源

- [The Algorithm · awesome-fsrs wiki](https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm)（FSRS-7 章节，2026-11-16 更新）
- [fsrs_v7.py · srs-benchmark](https://github.com/open-spaced-repetition/srs-benchmark/blob/main/models/fsrs_v7.py)（默认参数与公式源码）
