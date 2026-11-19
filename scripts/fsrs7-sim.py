# -*- coding: utf-8 -*-
"""
FSRS-7 长期仿真（评估稿，非插件代码）
=====================================
复刻官方 srs-benchmark/models/fsrs_v7.py 的公式，造一个虚拟学生：
  - 每天新增固定数量新卡，首次评级 good
  - 卡片到期时按模型算真实留存概率 R(t)，以 R 概率答对(good)、1-R 答错(again)
  - 按评级更新 (S_long, S_short, D)，按目标留存率 DR 迭代求下次间隔
快进 20 年，在一周/一个月/半年/1~20 年里程碑采集累计数据。

这不是强化学习（没有 reward/policy 优化），是蒙特卡洛仿真——
与 Anki 官方 simulator / srs-benchmark 同一类做法。
"""
import numpy as np

# 官方 FSRS-7 默认 34 参数（srs-benchmark/models/fsrs_v7.py init_w）
W = np.array([
    0.1104, 2.2395, 3.9221, 11.7841, 6.1686, 0.6457, 3.6807, 1.9795, 0.0, 1.3826,
    0.7024, 0.5999, 0.8146, 0.6398, 1.0, 1.3207, 0.6707, 3.8668, 0.4416, 0.0934,
    1.8631, 0.6162, 1.0869, 0.1567, 0.0801, 0.2421, 0.9464, 0.1433, 0.7145,
    0.0, 0.5667, 0.3734, 0.5333, 0.3048,
], dtype=float)

S_MIN = 1e-4
MIN_T = 1.0 / 86400.0
MAX_T = 36500.0


def init_d(G):
    G = np.asarray(G, dtype=float)
    return np.clip(W[4] - np.exp(W[5] * (G - 1)) + 1, 1, 10)


def init_state(G):
    idx = np.asarray(G, dtype=int) - 1
    return W[idx], 0.8 * W[idx], init_d(G)


def _fc_params(sl, ss, d):
    d1 = -np.clip(W[23] * ss ** (W[33] - 0.3), 0.01, 0.95)
    f1 = np.exp(np.clip(np.log(max(W[25], 1e-9)) / d1, -700.0, 60.0)) - 1.0
    a1 = f1 / ss
    d2 = -np.clip(W[24], 0.01, 0.95)
    f2 = max(W[26], 1e-9) ** (1.0 / d2) - 1.0
    dts = np.exp((d - 5) * (W[32] - 0.3))
    a2 = f2 * dts / sl
    w1 = W[27] * ss ** (-W[29])
    w2 = W[28] * sl ** W[30] * np.exp((d - 5) * (W[31] - 0.5))
    return d1, a1, d2, a2, w1, w2


def R_curve(t, sl, ss, d):
    d1, a1, d2, a2, w1, w2 = _fc_params(sl, ss, d)
    i1 = np.maximum(a1 * t + 1.0, 1e-12)
    i2 = np.maximum(a2 * t + 1.0, 1e-12)
    ret = (w1 * i1 ** d1 + w2 * i2 ** d2) / (w1 + w2)
    return np.clip(ret * (1 - 2e-5) + 1e-5, 0.0, 1.0)


def short_recall(t, ss):
    d1 = -np.clip(W[23] * ss ** (W[33] - 0.3), 0.01, 0.95)
    f1 = np.exp(np.clip(np.log(max(W[25], 1e-9)) / d1, -700.0, 60.0)) - 1.0
    a1 = f1 / ss
    return np.maximum(a1 * t + 1.0, 1e-12) ** d1


def solve_interval(sl, ss, d, target=0.9, cap=MAX_T, n=60):
    """二分法求 R(t)=target 的 t（R 单调递减，二分绝对收敛，稳过牛顿）。"""
    lo = np.zeros_like(sl)
    hi = np.full_like(sl, cap)
    for _ in range(n):
        mid = (lo + hi) / 2
        above = R_curve(mid, sl, ss, d) > target
        lo = np.where(above, mid, lo)
        hi = np.where(above, hi, mid)
    return (lo + hi) / 2

def next_stab(s, d, r, G, a):
    hard = np.where(G == 2, W[a + 6], 1.0)
    easy = np.where(G == 4, W[a + 7], 1.0)
    s_fail = W[a + 3] * ((s + 1.0) ** W[a + 4] - 1.0) * np.exp((1.0 - r) * W[a + 5])
    pls = np.minimum(s, s_fail)
    sinc = np.exp(W[a] - 1.5) * (11.0 - d) * s ** (-W[a + 1]) * (
        np.exp((1.0 - r) * W[a + 2]) - 1.0
    ) * hard * easy + 1.0
    return np.where(G > 1, np.maximum(pls, s * sinc), pls)


def step(sl, ss, d, t, G):
    R = R_curve(t, sl, ss, d)
    r1 = short_recall(t, ss)
    nsl = next_stab(sl, d, R, G, 7)
    nss = next_stab(ss, d, r1, G, 15)
    nss = np.where(G == 1, np.minimum(nss, 0.8 * nsl), nss)
    L = np.where(G == 1, R + 0.1, 1.0)
    dd = -W[6] * (G - 3) * (10 - d) / 9 * L
    nd = np.clip(0.01 * init_d(np.array(4.0)) + 0.99 * (d + dd), 1, 10)
    return np.maximum(nsl, S_MIN), np.maximum(nss, S_MIN), nd


# 里程碑（天）：1周 / 1月 / 半年 / 1~20 年
MILESTONES = [(7, '1 周'), (30, '1 个月'), (182, '半年')] + [
    (y * 365, f'{y} 年') for y in range(1, 21)
]


def simulate(years=20, new_per_day=20, dr=0.9, seed=42, cap_days=365):
    rng = np.random.default_rng(seed)
    days = int(years * 365)
    cap = new_per_day * days + 10
    sl = np.zeros(cap); ss = np.zeros(cap); d = np.zeros(cap)
    last = np.full(cap, -1, dtype=np.int64)
    due = np.full(cap, 10 ** 9, dtype=np.int64)
    active = np.zeros(cap, dtype=bool)
    n = 0

    # 新卡首次评级固定 good -> 初始状态与首次间隔只算一次
    g0 = np.array([3])
    s0, ss0, d0 = init_state(g0)
    first_iv = float(solve_interval(np.array([s0[0]]), np.array([ss0[0]]), np.array([d0[0]]), dr, cap=cap_days)[0])
    first_due_days = max(1, int(np.ceil(first_iv)))

    per_day_rev = np.zeros(days, dtype=np.int64)
    per_day_cor = np.zeros(days, dtype=np.int64)
    per_day_iv = np.zeros(days, dtype=float)
    ms_set = {d for d, _ in MILESTONES if d <= days}
    snapshots = {}

    for day in range(days):
        # 新增新卡（初始状态相同，直接赋标量）
        hi = min(n + new_per_day, cap)
        sl[n:hi] = s0[0]; ss[n:hi] = ss0[0]; d[n:hi] = d0[0]
        last[n:hi] = day
        due[n:hi] = day + first_due_days
        active[n:hi] = True
        n = hi

        # 到期卡
        idx = np.where(active[:n] & (due[:n] <= day))[0]
        if idx.size:
            t = (day - last[idx]).astype(float)
            Rreal = R_curve(t, sl[idx], ss[idx], d[idx])
            ok = rng.random(idx.size) < Rreal
            G = np.where(ok, 3, 1)
            nsl, nss, nd = step(sl[idx], ss[idx], d[idx], t, G)
            sl[idx], ss[idx], d[idx] = nsl, nss, nd
            last[idx] = day
            ivs = solve_interval(nsl, nss, nd, dr, cap=cap_days)
            due[idx] = day + np.maximum(1, np.ceil(ivs)).astype(np.int64)
            per_day_rev[day] = idx.size
            per_day_cor[day] = int(ok.sum())
            per_day_iv[day] = float(np.mean(ivs))

        if day + 1 in ms_set:
            end = day + 1
            recent_rev = per_day_rev[max(0, end - 30):end]
            recent_cor = per_day_cor[max(0, end - 30):end]
            recent_iv = per_day_iv[max(0, end - 30):end]
            recent_iv = recent_iv[recent_iv > 0]
            tot_rev = int(per_day_rev[:end].sum())
            tot_cor = int(per_day_cor[:end].sum())
            snapshots[end] = {
                'cards': n,
                'reviews': tot_rev,
                'correct': tot_cor,
                'retention': tot_cor / tot_rev if tot_rev else 0,
                'daily_avg': float(recent_rev.mean()),
                'daily_peak': int(recent_rev.max()),
                'avg_interval': float(recent_iv.mean()) if recent_iv.size else 0,
            }
    return snapshots, first_iv


def main():
    np.seterr(all='ignore')
    snaps, first_iv = simulate(years=20)
    print(f"首次 good 调度间隔 = {first_iv:.2f} 天\n")

    # Markdown 表格
    print('| 时间跨度 | 累计卡片 | 累计复习 | 累计答对 | 实际留存率 | 近30天日均复习 | 近30天单日峰值 | 近30天平均间隔 |')
    print('|---|---:|---:|---:|---:|---:|---:|---:|')
    label = {d: t for d, t in MILESTONES}
    for d in sorted(snaps):
        s = snaps[d]
        print(f"| {label[d]} | {s['cards']:,} | {s['reviews']:,} | {s['correct']:,} | "
              f"{s['retention']*100:.2f}% | {s['daily_avg']:.0f} | {s['daily_peak']:,} | "
              f"{s['avg_interval']:.1f} 天 |")


if __name__ == '__main__':
    main()
