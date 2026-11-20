/**
 * FSRS-7 多场景长期仿真 —— 直接调用插件真实排期代码
 * ================================================================
 * 目的：给视频/文档提供「不像实验室」的数据——按年龄段、职业、使用场景分层，
 * 跑 1 个月到 10 年，多维指标，多随机种子取平均，全部可复现。
 *
 * 与 fsrs7-sim-real.ts 的区别：
 *  - 用事件堆按「天+小数」推进，同一天内能把 1m/10m 学习步骤走完；
 *  - 调用真实 scheduleNext（含学习/重学步骤、Easy>Good、fuzz）；
 *  - 建模真实节奏：工作日/间歇/请假，到期卡在非活跃日顺延（模拟积压）；
 *  - 个体记忆能力用 ability 系数（actualRecall = R(t / ability)）——
 *    能力弱 = 同样真实时间相当于过了更久；不能用 R×ability（目标留存率不可达）。
 *
 * 运行：node --experimental-strip-types scripts/fsrs-sim-personas.ts
 */
import {
  FSRS, DEFAULT_W, DEFAULT_DESIRED_RETENTION, scheduleNext,
  applyReviewFuzz, learningStepFuzzMinutes, fuzzFactor,
  MIN_INTERVAL_DAYS, type Rating,
} from '../src/review/fsrs.ts';

// ==================== 可复现随机 ====================
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ==================== 小根堆（按时刻推进） ====================
interface Event { at: number; card: number }
class Heap {
  private a: Event[] = [];
  get size(): number { return this.a.length; }
  push(e: Event): void {
    const a = this.a;
    a.push(e);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].at <= a[i].at) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  peekAt(): number {
    return this.a.length ? this.a[0].at : Infinity;
  }
  pop(): Event | undefined {
    const a = this.a;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].at < a[m].at) m = l;
        if (r < a.length && a[r].at < a[m].at) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

// ==================== 人群设定 ====================
type Rhythm = 'daily' | 'weekday' | 'mixed' | 'sporadic' | 'vacation';
interface Persona {
  id: string;
  label: string;
  age: string;
  ageBand: '未成年' | '青年' | '中年' | '中老年';
  job: string;
  scene: string;
  newPerDay: number;
  ability: number;       // 真实回忆 = R × ability（个体差异）
  rhythm: Rhythm;
  dr: number;            // 目标留存率设置
  examBoost?: number;    // 考前 N 天内新卡倍率
}

const PERSONAS: Persona[] = [
  { id: 'P1', label: '小学生', age: '9-12 岁', ageBand: '未成年', job: '学生', scene: '古诗/英语单词，家长陪练', newPerDay: 4, ability: 0.92, rhythm: 'daily', dr: 0.9 },
  { id: 'P2', label: '初中生', age: '13-15 岁', ageBand: '未成年', job: '学生', scene: '语数英知识点，上学日为主', newPerDay: 8, ability: 0.95, rhythm: 'mixed', dr: 0.9 },
  { id: 'P3', label: '高中生', age: '15-18 岁', ageBand: '未成年', job: '学生', scene: '高考复习，考前 3 个月加量', newPerDay: 12, ability: 0.97, rhythm: 'daily', dr: 0.9, examBoost: 1.6 },
  { id: 'P4', label: '大学生', age: '19-22 岁', ageBand: '青年', job: '学生', scene: '专业课 + 四六级，寒暑假偏少', newPerDay: 8, ability: 1.0, rhythm: 'vacation', dr: 0.9 },
  { id: 'P5', label: '考研党', age: '22-25 岁', ageBand: '青年', job: '考生', scene: '冲刺期高强度，最后 3 个月再加码', newPerDay: 20, ability: 0.98, rhythm: 'daily', dr: 0.9, examBoost: 1.5 },
  { id: 'P6', label: '考证上班族', age: '26-35 岁', ageBand: '青年', job: '白领', scene: '碎片时间，工作日记、周末几乎不碰', newPerDay: 5, ability: 0.95, rhythm: 'weekday', dr: 0.9 },
  { id: 'P7', label: '医生', age: '28-40 岁', ageBand: '青年', job: '医师', scene: '医学知识海量，值班日偶尔中断', newPerDay: 14, ability: 1.0, rhythm: 'mixed', dr: 0.9 },
  { id: 'P8', label: '程序员', age: '25-40 岁', ageBand: '青年', job: '工程师', scene: '技术笔记 + 英语，随项目节奏断续', newPerDay: 3, ability: 1.0, rhythm: 'sporadic', dr: 0.9 },
  { id: 'P9', label: '中老年爱好者', age: '55-70 岁', ageBand: '中老年', job: '退休/兴趣', scene: '读书笔记、养生知识，慢而稳', newPerDay: 2, ability: 0.9, rhythm: 'daily', dr: 0.9 },
];

// ==================== 单条卡 ====================
interface Card {
  createdAt: number;
  lastAt: number;
  sLong: number; sShort: number; d: number;
  reviews: number;
  phase: 'ladder' | 'fsrs' | 'relearn';
  stage: number;
}

interface Metrics {
  cards: number; reviews: number; correct: number;
  dailyAvg: number; dailyPeak: number; backlogPeak: number;
  avgInterval: number; maxInterval: number;
  medianSLong: number; avgD: number; maturePct: number; activePct: number;
}

const MILESTONES = [30, 90, 182, 365, 730, 1095, 1825, 2555, 3650];

/** 活跃日判定用稳定 hash，不消耗主随机序列——新卡/回忆抽样与作息解耦。 */
function isActive(p: Persona, day: number): boolean {
  const dow = day % 7; // 0..4 = 周一..周五
  switch (p.rhythm) {
    case 'daily': return true;
    case 'weekday': return dow < 5;
    case 'mixed': return dow < 5 || fuzzFactor(`${p.id}:mixed:${day}`) < 0.5;
    case 'sporadic': return fuzzFactor(`${p.id}:sporadic:${day}`) < 0.85;
    case 'vacation': {
      const doy = day % 365;
      if (doy >= 180 && doy < 210) return fuzzFactor(`${p.id}:hol:${day}`) < 0.25; // 每年暑假 30 天
      return true;
    }
  }
}

function simulate(p: Persona, seed: number, years: number, dr = p.dr): Map<number, Metrics> {
  const rng = makeRng(seed);
  const fsrs = new FSRS(DEFAULT_W);
  const days = Math.round(years * 365);
  const heap = new Heap();
  const cards: Card[] = [];
  const perDayReviews = new Float64Array(days + 1);
  const perDayCorrect = new Float64Array(days + 1);
  const perDayNew = new Float64Array(days + 1);
  const perDayIvSum = new Float64Array(days + 1);
  const perDayIvN = new Float64Array(days + 1);
  const perDayIvMax = new Float64Array(days + 1);
  const perDayBacklog = new Float64Array(days + 1);
  const perDayActive = new Uint8Array(days + 1);

  let cumReviews = 0, cumCorrect = 0;
  const steps = [1, 10];
  const relearn = [1, 10];
  const out = new Map<number, Metrics>();

  for (let day = 0; day < days; day++) {
    const active = isActive(p, day);
    if (active) perDayActive[day] = 1;

    // 新卡（只在实际活跃日加入；考前倍率）
    if (active) {
      let mult = 1;
      if (p.examBoost && day % 365 >= 275) mult = p.examBoost; // 每年最后 90 天=冲刺期
      if (p.rhythm === 'vacation' && day % 365 >= 180 && day % 365 < 210) mult = 0.3;
      const poisson = (lambda: number): number => {
        let k = 0, acc = 1, lim = p.newPerDay * mult;
        const L = Math.exp(-lim);
        do { k++; acc *= rng(); } while (acc > L && k < 200);
        return k - 1;
      };
      const n = Math.min(poisson(), 100);
      perDayNew[day] = n;
      for (let i = 0; i < n; i++) {
        const idx = cards.length;
        cards.push({ createdAt: day, lastAt: day, sLong: 1, sShort: 0.8, d: 0.3, reviews: 0, phase: 'ladder', stage: 0 });
        heap.push({ at: day + MIN_INTERVAL_DAYS, card: idx });
      }
    }

    // 处理到期事件（含当天学习步骤的分钟级重复）
    while (heap.peekAt() < day + 1) {
      const ev = heap.pop()!;
      if (ev.at >= days) break;
      const eventDay = Math.floor(ev.at);
      if (!isActive(p, eventDay)) {
        // 非活跃日：顺延到下一个活跃日 0 点，记一次积压
        let next = eventDay + 1;
        let guard = 0;
        while (next < days && !isActive(p, next) && guard++ < 400) next++;
        if (next >= days) break;
        perDayBacklog[eventDay]++;
        heap.push({ at: next, card: ev.card });
        continue;
      }

      const c = cards[ev.card];
      const t = Math.max(0, ev.at - c.lastAt);
      // 个体差异：能力弱 = 同样真实时间相当于过了更久（t_eff = t / ability）。
      // 不能用 R×ability：那样目标留存率永远达不到，卡会陷入失败螺旋。
      const r = fsrs.R(t / p.ability, c.sLong, c.sShort, c.d);
      const pRemember = Math.max(0, Math.min(1, r));
      const u = rng();
      const rating: Rating = u < pRemember ? (u < pRemember * 0.18 ? 'hard' : 'good') : 'again';

      const decision = scheduleNext(
        {
          stage: c.stage, phase: c.phase, stability: c.sLong,
          stabilityShort: c.sShort, difficulty: c.d,
          lastReviewed: c.reviews > 0 ? new Date(c.lastAt * 86400000).toISOString() : null,
          reviewStart: new Date(c.createdAt * 86400000).toISOString(),
        },
        rating, new Date(ev.at * 86400000), DEFAULT_W, dr,
        {
          stepsMins: steps, relearnStepsMins: relearn, graduatingDays: 1,
          sameDay: Math.floor(ev.at) === c.createdAt,
        }
      );

      c.sLong = decision.stability ?? c.sLong;
      c.sShort = decision.stabilityShort ?? c.sShort;
      c.d = decision.difficulty ?? c.d;
      c.phase = decision.phase;
      c.stage = decision.stage;
      c.lastAt = ev.at;
      c.reviews++;
      cumReviews++;
      perDayReviews[eventDay]++;
      if (rating !== 'again') { cumCorrect++; perDayCorrect[eventDay]++; }

      // 与插件一致：步骤期用步骤 fuzz，FSRS 期用 review fuzz
      const inSteps = decision.phase === 'ladder' || decision.phase === 'relearn';
      const fuzz = fuzzFactor(`sim:${ev.card}:${c.reviews}`);
      const iv = inSteps
        ? learningStepFuzzMinutes(decision.intervalDays * 1440, fuzz) / 1440
        : applyReviewFuzz(decision.intervalDays, fuzz, MIN_INTERVAL_DAYS, Infinity);
      perDayIvSum[eventDay] += iv;
      perDayIvN[eventDay]++;
      if (iv > perDayIvMax[eventDay]) perDayIvMax[eventDay] = iv;
      heap.push({ at: ev.at + Math.max(MIN_INTERVAL_DAYS, iv), card: ev.card });
    }

    // 必须在当天取快照： cumulative 计数器取到的是「此刻」，不是 10 年终值。
    if (MILESTONES.includes(day + 1)) out.set(day + 1, snap(day + 1));
  }

  function snap(end: number): Metrics {
    const lo = Math.max(0, end - 30);
    let avg = 0, peak = 0, ivAvg = 0, ivMax = 0, ivN = 0, backlog = 0, active = 0, newAvg = 0;
    for (let d = lo; d < end; d++) {
      avg += perDayReviews[d];
      newAvg += perDayNew[d];
      if (perDayReviews[d] > peak) peak = perDayReviews[d];
      if (perDayIvN[d]) { ivAvg += perDayIvSum[d] / perDayIvN[d]; ivN++; }
      if (perDayIvMax[d] > ivMax) ivMax = perDayIvMax[d];
      if (perDayBacklog[d] > backlog) backlog = perDayBacklog[d];
      active += perDayActive[d];
    }
    const sorted = cards.filter((c) => c.reviews > 0).map((c) => c.sLong).sort((a, b) => a - b);
    let dSum = 0, mature = 0;
    for (const c of cards) {
      if (!c.reviews) continue;
      dSum += c.d;
      if (c.reviews >= 3) mature++;
    }
    return {
      cards: cards.length, reviews: cumReviews, correct: cumCorrect,
      dailyAvg: avg / 30, dailyPeak: peak, backlogPeak: backlog,
      avgInterval: ivN ? ivAvg / ivN : 0, maxInterval: ivMax,
      medianSLong: sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0,
      avgD: sorted.length ? dSum / sorted.length : 0,
      maturePct: sorted.length ? mature / sorted.length : 0,
      activePct: active / 30,
    };
  }

  return out;
}

// ==================== 聚合 ====================
const SEEDS = [11, 29, 47];
function avgMetric(maps: Map<number, Metrics>[], day: number): Metrics {
  const acc: Record<string, number> = {};
  let n = 0;
  for (const m of maps) {
    const v = m.get(day);
    if (!v) continue;
    n++;
    for (const k of Object.keys(v)) acc[k] = (acc[k] || 0) + (v as unknown as Record<string, number>)[k];
  }
  const out = {} as Metrics;
  for (const k of Object.keys(acc)) (out as unknown as Record<string, number>)[k] = acc[k] / Math.max(1, n);
  return out;
}
const labelOf = (d: number): string => d === 30 ? '1 个月' : d === 90 ? '3 个月' : d === 182 ? '半年' : `${d / 365} 年`;
const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

// ==================== 调试开关（可选，缩小规模定位瓶颈） ====================
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const LIMIT_DAYS = Number(env.SIM_LIMIT_DAYS || 0) || 0;
const LIMIT_PERSONAS = Number(env.SIM_LIMIT_PERSONAS || 0) || 0;
const LIMIT_SEEDS = Number(env.SIM_LIMIT_SEEDS || 0) || 0;
if (LIMIT_DAYS || LIMIT_PERSONAS || LIMIT_SEEDS) {
  const p0 = PERSONAS.slice(0, LIMIT_PERSONAS || undefined);
  const s0 = SEEDS.slice(0, LIMIT_SEEDS || undefined);
  const t0 = Date.now();
  let probe: Metrics | undefined;
  for (const p of p0) for (const s of s0) probe = simulate(p, s, (LIMIT_DAYS || 3650) / 365).get(Math.min(365, LIMIT_DAYS || 3650));
  console.log(`PROBE personas=${p0.length} seeds=${s0.length} days=${LIMIT_DAYS || 3650} elapsed=${Date.now() - t0}ms`);
  console.log(JSON.stringify(probe));
  process.exit(0);
}

// ==================== 输出 Markdown ====================
console.log('# FSRS-7 多场景长期仿真数据（插件真实代码）\n');
console.log('> 全部数字由 `scripts/fsrs-sim-personas.ts` 调 `src/review/fsrs.ts` 的真实 `scheduleNext()` 跑出。');
console.log(`> 每个场景 ${SEEDS.length} 个固定随机种子取平均；时长 10 年；目标留存率默认 90%。`);
console.log('> 个体回忆概率 = 模型 R(t / 能力系数)（能力弱＝同样真实时间相当于过更久）；非活跃日到期的卡顺延并计积压。\n');

console.log('## 一、人群设定\n');
console.log('| 编号 | 人群 | 年龄 | 身份 | 使用场景 | 日均新增 | 记忆能力 | 作息节奏 |');
console.log('|---|---|---|---|---|---:|---:|---|');
const rhythmName: Record<Rhythm, string> = { daily: '每天', weekday: '工作日', mixed: '工作日+周末半数', sporadic: '断续(85%)', vacation: '每天+寒暑假低频' };
for (const p of PERSONAS) {
  console.log(`| ${p.id} | ${p.label} | ${p.age} | ${p.job} | ${p.scene} | ${p.newPerDay} | ${p.ability.toFixed(2)} | ${rhythmName[p.rhythm]} |`);
}

console.log('\n## 二、九类人群 × 1 个月到 10 年\n');
console.log('> 每格是「累计复习 / 近 30 天日均复习 / 实际留存率 / 近 30 天单日峰值」。\n');
const heads = ['时间点', ...PERSONAS.map((p) => `${p.id} ${p.label}`)];
console.log(`| ${heads.join(' | ')} |`);
console.log(`|${heads.map(() => '---').join('|')}|`);
const personaRuns = PERSONAS.map((p) => SEEDS.map((s) => simulate(p, s, 10)));
for (const m of MILESTONES) {
  const cells = personaRuns.map((runs) => {
    const x = avgMetric(runs, m);
    return `${Math.round(x.reviews).toLocaleString()} / ${x.dailyAvg.toFixed(1)} / ${pct(x.correct / Math.max(1, x.reviews))} / ${Math.round(x.dailyPeak)}`;
  });
  console.log(`| ${labelOf(m)} | ${cells.join(' | ')} |`);
}

console.log('\n## 三、多维明细（选取 1 年 / 5 年 / 10 年）\n');
console.log('| 人群 | 时点 | 累计新增 | 累计复习 | 每卡复习 | 实际留存 | again 率 | 日均复习 | 单日峰值 | 积压峰值 | 平均间隔 | 最大间隔 | S_long 中位 | 平均难度 | 成熟卡 |');
console.log('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
for (let i = 0; i < PERSONAS.length; i++) {
  for (const m of [365, 1825, 3650]) {
    const x = avgMetric(personaRuns[i], m);
    console.log(
      `| ${PERSONAS[i].label} | ${labelOf(m)} | ${Math.round(x.cards).toLocaleString()} | ${Math.round(x.reviews).toLocaleString()} | ` +
      `${(x.reviews / Math.max(1, x.cards)).toFixed(1)} | ${pct(x.correct / Math.max(1, x.reviews))} | ${pct(1 - x.correct / Math.max(1, x.reviews))} | ` +
      `${x.dailyAvg.toFixed(1)} | ${Math.round(x.dailyPeak)} | ${Math.round(x.backlogPeak)} | ${x.avgInterval.toFixed(0)}天 | ` +
      `${Math.round(x.maxInterval)}天 | ${x.medianSLong.toFixed(0)}天 | ${x.avgD.toFixed(2)} | ${pct(x.maturePct)} |`
    );
  }
}

console.log('\n## 四、年龄段汇总（日均复习，单位：条/天）\n');
console.log('| 年龄段 | 覆盖人群 | 1 年 | 5 年 | 10 年 |');
console.log('|---|---|---:|---:|---:|');
const bands: Array<'未成年' | '青年' | '中老年'> = ['未成年', '青年', '中老年'];
for (const band of bands) {
  const idx = PERSONAS.map((p, i) => (p.ageBand === band ? i : -1)).filter((i) => i >= 0);
  const cell = (m: number): string => {
    let s = 0;
    for (const i of idx) s += avgMetric(personaRuns[i], m).dailyAvg;
    return (s / idx.length).toFixed(1);
  };
  console.log(`| ${band} | ${idx.map((i) => PERSONAS[i].label).join('、')} | ${cell(365)} | ${cell(1825)} | ${cell(3650)} |`);
}

console.log('\n## 五、目标留存率敏感性（大学生 P4，3 种子，1/5 年）\n');
console.log('> 回答「把留存率调高到底多花多少时间」——这是视频里最实用的数字。\n');
console.log('| 目标留存率 | 时点 | 日均复习 | 累计复习 | 平均间隔 | 实际留存 | 每卡复习次数 |');
console.log('|---:|---|---:|---:|---:|---:|---:|');
for (const dr of [0.85, 0.9, 0.95, 0.97]) {
  const runs = SEEDS.map((s) => simulate(PERSONAS[3], s, 5, dr));
  for (const m of [365, 1825]) {
    const x = avgMetric(runs, m);
    console.log(`| ${pct(dr)} | ${labelOf(m)} | ${x.dailyAvg.toFixed(1)} | ${Math.round(x.reviews).toLocaleString()} | ${x.avgInterval.toFixed(0)}天 | ${pct(x.correct / Math.max(1, x.reviews))} | ${(x.reviews / Math.max(1, x.cards)).toFixed(1)} |`);
  }
}

console.log('\n## 六、作息节奏对照（同样每天 5 张新卡，1 年）\n');
console.log('| 节奏 | 日均复习 | 单日峰值 | 积压峰值 | 实际留存 | 到期完成率 |');
console.log('|---|---:|---:|---:|---:|---:|');
for (const rhythm of ['daily', 'weekday', 'mixed', 'sporadic', 'vacation'] as Rhythm[]) {
  const p: Persona = { ...PERSONAS[5], id: `R-${rhythm}`, rhythm, newPerDay: 5 };
  const runs = SEEDS.map((s) => simulate(p, s, 1));
  const x = avgMetric(runs, 365);
  console.log(`| ${rhythmName[rhythm]} | ${x.dailyAvg.toFixed(1)} | ${Math.round(x.dailyPeak)} | ${Math.round(x.backlogPeak)} | ${pct(x.correct / Math.max(1, x.reviews))} | ${pct(x.activePct)} |`);
}
