# FSRS-7 引入实现说明

> 状态：实现中。按 [评估](FSRS-7-全量FSRS流程评估.md) 与用户拍板：上 FSRS-7、去 10 级阶梯、
> 留存率设置开放给用户（默认 90%，官方推荐值）、拟合器重写到 34 维。

## 数据承载方案（关键决策）

FSRS-7 记忆状态是三元组 `(S_long, S_short, D)`，当前 v4 是 `(stability, difficulty)`。

为控制改动面、守住 AGENTS.md 数据布局约束：

| 字段 | 语义（v7） | 说明 |
|---|---|---|
| `stability` | = S_long（长期稳定性） | 字段名不变，下游 stats/analysis/CSV 读到的仍是"稳定性"，语义升级为长期 |
| `stabilityShort` | = S_short（短期稳定性） | 新增字段；仅 fsrs.ts 核心计算读写 |
| `difficulty` | = D | 不变 |
| `phase` | 恒为 `'fsrs'` | 去掉阶梯；保留字段承载既有 UI 判断 |
| `stage` | 恒为 0 | 保留字段兼容既有数据结构与 CSV；不再爬级 |

- 首次评级（totalReviews===0）即初始化三元组：`S_long=w[G-1]`、`S_short=0.8·S_long`、`D=initD(G)`。
- 备份 CSV 增列 `stabilityShort`（保留 stage/phase/stability/difficulty 原列，向后可读）。

## 核心公式（复刻官方 srs-benchmark/models/fsrs_v7.py）

- 34 参数默认值取自 `init_w`。
- 遗忘曲线：短期/长期双曲线加权，`W_short·R_short + W_long·R_long`，权重随 S/D 变。
- 成功回忆：`S' = S·(1 + e^(w_a−1.5)·(11−D)·S^(−w_(a+1))·(e^((1−R)·w_(a+2))−1)·H·E)`，a=7 长期（用混合 R）/a=15 短期（用 R_short）。
- 遗忘：`S' = min(S, w_(a+3)·((S+1)^w_(a+4)−1)·e^((1−R)·w_(a+5)))`，短期再加 `min(S'_short, 0.8·S'_long)`。
- 难度：`ΔD = −w6·(G−3)·(10−D)/9·L`（again 时 L=R+0.1），`D' = clamp(0.01·D_init(4)+0.99·(D+ΔD),1,10)`。
- 间隔：二分法求 `R(t)=DR` 的 t（DR = 留存率设置，默认 0.9）。

## 拟合器

- 19→34 维；官方 Adam + L2 prior（sigma 取官方 `_l2_sigma`），默认参数起步。
- 逐维 box 约束取官方 `_CLIP_LO/_CLIP_HI`，再做单调约束（w1≤w2≤w3、w25≤w26）。
- 回放对数似然：hard/good/easy=pass（log R）、again=log(1−R)，状态推进走同一套 FSRS-7 公式。
- 样本门槛保留：<100 跳过、100–299 基础档、≥300 全参档（基础档拟合前 8 维）。
