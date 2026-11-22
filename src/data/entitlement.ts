/**
 * 授权状态、数量限制与能力登记（src/data/entitlement.ts）
 *
 * 与 bz / bz Reader / 归物本同构：一个完整包，运行期由激活码决定数量上限。
 *
 * 产品决策（2026-11-18，2026-11-20 调整）：基础版与高级版功能完全一致，只限数量——
 *   数量：基础版复习笔记 + 划线卡**合计 50 条**（两类不再分开计数），高级版不限；
 *   能力：全部放开。现有四项免费可用，未来新增功能同样不对基础版关闭。
 *
 * 「超一次」宽限（2026-11-20）：按**导入后合计**决定——
 *   导入前合计 < 50、这批加完会越过 50：整批放行，但回一个 overLimit 给调用方提醒
 *   「这次还能加，下次要先升级」；一旦合计已达 50，再导入就整批拦。
 *   不记额外的「已超一次」状态——合计本身是否已满就是那个状态，重启也不会丢。
 *
 * 能力位保留为登记清单（PRO_CAPABILITIES / CAPABILITY_LABELS），
 * 供界面文案、用量口径与测试引用；门控本身恒放行，架构上不再有功能差异。
 */
import { parseLicense, verifyLicense } from './license';
import type { LicenseFail } from './license';
import { checkRevoked, revokedCheckedAt, revokedCode, revokedDeadAt } from './revoked';
import { t } from '../i18n/strings';

/** 购买页（与 bz Reader / 归物本同一个店铺） */
export const PURCHASE_URL = 'https://wzyp.cn/shop/IFCEI5I3';
/** 交流群（与 bz Reader 同一个群） */
export const GROUP_ID = '1130883117';

/** 基础版：复习条目合计上限（笔记 + 划线卡） */
export const FREE_ITEM_LIMIT = 50;

/* ── 授权事实（2026-11-22，给 bz 的探针读）─────────────────────────
 * 「现在是基础版」底下有四种完全不同的处境：没买 / 到期 / 被封 / 码坏了。
 * 处理方式完全不同（引导购买 / 续费提醒 / 查误封 / 修粘贴），所以要把成因
 * 写进 data.json，让 bz 那边采得到。
 *
 * 这三个类型与 bz 主仓 `src/core/usage/types.ts` 里的同名类型逐字一致——
 * 那边会用白名单校验，多一个字就会被丢掉。改这里必须同时改那边。
 */
export type TierReasonLite = 'ok' | 'none' | 'expired' | 'revoked' | 'invalid' | 'unknown';
export type ActivateFailLite = 'format' | 'invalid' | 'offline' | 'revoked' | 'expired';

/** 一次授权状态的快照（派生值 + 上次激活失败的历史） */
export interface LicenseFactsLite {
  /** true 被判死 / false 核对过没问题 / 缺省 从没成功核对过（别拿 false 冒充） */
  revoked?: boolean;
  revokedAt?: number;
  tierReason: TierReasonLite;
  activateFail?: ActivateFailLite;
  activateFailAt?: number;
}

export interface LicenseState {
  /** 是否已解锁高级版（**不含停用判定**：停用那层在 isPaid() 里现算） */
  paid: boolean;
  /** 激活码里的署名 */
  name?: string;
  plan?: string;
  /** 过期毫秒戳；0/缺省 = 永久 */
  exp?: number;
  /** 上次验签时间（仅用于设置页人话） */
  checkedAt: number;
  /** 上次验签没过时的原因（'expired' / 'invalid' / …）；过了就是 undefined */
  failReason?: LicenseFail;
}

const EMPTY: LicenseState = { paid: false, checkedAt: 0 };

let state: LicenseState = EMPTY;
let cachedCode = '';

/** 上次激活失败的原因与时刻（内存 + 由 main.ts 从 data.json 灌回历史） */
let lastFail: ActivateFailLite | undefined;
let lastFailAt = 0;

/** 授权事实变了就通知一声（main.ts 收到后落盘到 data.json，bz 探针读它） */
let factsHook: (() => void) | null = null;

export function setLicenseFactsHook(fn: (() => void) | null): void {
  factsHook = fn;
}

function notifyFacts(): void {
  try {
    factsHook?.();
  } catch {
    /* 落盘失败不该反过来影响授权判定 */
  }
}

/** 启动时把上次的失败历史灌回来，否则重启一次就看不出「他上次激活栽在哪」 */
export function setLicenseFailHistory(fail: ActivateFailLite | undefined, at: number): void {
  lastFail = fail;
  lastFailAt = Number.isFinite(at) && at > 0 ? at : 0;
}

/** main.ts 启动时与激活后写入 */
export function setLicenseState(next: LicenseState, code = ''): void {
  state = next;
  cachedCode = code;
}

export function getLicenseState(): LicenseState {
  return state;
}

/**
 * 这枚码当前是否被停用名单判死（同步，只读本地那份标记）。
 *
 * 为什么不把结论写进 state：名单核算是**后台异步**的（启动后几十秒、或
 * 用户点设置页「核对」才回来），而 state 只在启动与激活时写一次。若把
 * `paid` 在写 state 时定死，命中停用后界面要等下次重启才降级。改成现算，
 * 后台把标记一落盘，下一次重绘就是基础版。
 *
 * 比较的是**码原文全等**：码被换掉（重新激活一枚新码）时旧标记自然失效，
 * 不会把新码误伤。
 */
function revokedNow(): boolean {
  const dead = revokedCode().trim();
  const mine = cachedCode.trim();
  return !!dead && !!mine && dead === mine;
}

/**
 * 当前是不是高级版。
 *
 * 两层：验签通过（state.paid）**且**没被停用。停用与过期同一档——签名还是
 * 真的，只是作者叫停了这枚码：保留码、只降级，解封后下次启动自动恢复，
 * 用户不用回头翻邮件找码。
 */
export function isPaid(): boolean {
  return state.paid && !revokedNow();
}

/**
 * 档位成因：把「现在是基础版」拆成四种不同的处境。
 *
 * 顺序有讲究：**停用排在到期前面**。一枚码既过期又被封时，作者真正该知道的是
 * 「这枚被封了」（要查是不是误封 / 盗版），而不是「它到期了」（那是正常流失）。
 */
function tierReasonNow(): TierReasonLite {
  if (!cachedCode.trim()) return 'none';
  if (revokedNow()) return 'revoked';
  if (state.paid) return 'ok';
  if (state.failReason === 'expired') return 'expired';
  return 'invalid';
}

/**
 * 当前授权事实（给 bz 的探针读，main.ts 负责落盘到 data.json）。
 *
 * 只输出分类与时间戳，**不含码原文 / 昵称 / 订单号**——那份文件会被同库的
 * 另一个插件读走，码原文出门就等于泄露。
 */
export function licenseFacts(): LicenseFactsLite {
  const dead = licenseRevoked();
  const out: LicenseFactsLite = { tierReason: tierReasonNow() };
  if (dead) {
    out.revoked = true;
    const at = revokedDeadAt();
    if (at > 0) out.revokedAt = at;
  } else if (revokedCheckedAt() > 0) {
    /* 核对成功过、名单里没有它 —— 这才是「核对过没问题」。
       从没核对过（网络一直不通）时**不带这个键**，否则探针会把
       「还没查」算成「查了没事」。 */
    out.revoked = false;
  }
  if (lastFail) {
    out.activateFail = lastFail;
    if (lastFailAt > 0) out.activateFailAt = lastFailAt;
  }
  return out;
}

/**
 * 记一次激活失败。
 *
 * 只记分类和时间，**绝不记码原文**。成功一次就清空——几个月前的一次手滑
 * 不该永远挂在设备档案上。
 */
function noteActivateFail(fail: ActivateFailLite | undefined): void {
  if (fail) {
    lastFail = fail;
    lastFailAt = Date.now();
  } else {
    lastFail = undefined;
    lastFailAt = 0;
  }
  notifyFacts();
}

/** 两类条目的当前计数（由调用方从排期表里数，别在这里读盘） */
export interface PlanCounts {
  notes: number;
  cards: number;
}

/** 两类合计——基础版配额看的是这个总数，不再各数各的 */
export function totalOf(counts: PlanCounts): number {
  return counts.notes + counts.cards;
}

/**
 * 额度到顶的专用错误。调用方早先靠消息文本认「基础版最多」，而 quotaBlock
 * 实际说的是「基础版上限」——加不进去时只能看到一句失败提示，不会弹升级窗。
 * 现在带类型的错误让界面能稳稳认出「这是额度到顶」→ 弹高级功能窗，
 * 而不是把正常的上限拦当成写盘失败。
 *
 * 不再带 kind：配额是笔记 + 划线合计，哪一类到顶都只是「合计满了」这一件事。
 */
export class QuotaExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuotaExceededError';
  }
}

/** 单条能不能再加一条（笔记或卡）：合计没到 50 就行 */
export function canAdd(counts: PlanCounts): boolean {
  return isPaid() || totalOf(counts) < FREE_ITEM_LIMIT;
}

/** 还能加几条（已解锁返回 Infinity） */
export function remaining(counts: PlanCounts): number {
  return isPaid() ? Infinity : Math.max(0, FREE_ITEM_LIMIT - totalOf(counts));
}

/**
 * 批量导入的放行决策（「超一次」宽限，按导入后合计判断）。
 *
 * `incoming` 是这批**有效的新条目数**（去重、排除空项之后）。
 *
 * - 已解锁：整批放行，永不算超限；
 * - 导入前合计已达上限：整批拒绝，`allowed = 0`；
 * - 导入前没满、但加完会越过上限：整批放行，`overLimit = true` 让调用方提醒
 *   「这次还能加，下次要先升级」——用户要的「允许超一次」就是这个分支。
 *
 * 整批一致放行或整批一致拒绝，不做「前 50 条进、后面拒」的逐条截断：
 * 一次导 60 张书卡，要么全进，要么全不进，别让用户拿到半本书。
 */
export interface BatchQuota {
  /** 这批实际允许加入的条数：等于 incoming = 放行；0 = 整批拒绝 */
  allowed: number;
  /** 放行后合计是否超过上限（未解锁才有意义），调用方据此弹「下次要升级」提醒 */
  overLimit: boolean;
}

export function batchQuota(counts: PlanCounts, incoming: number): BatchQuota {
  if (isPaid() || incoming <= 0) return { allowed: incoming, overLimit: false };
  const used = totalOf(counts);
  if (used >= FREE_ITEM_LIMIT) return { allowed: 0, overLimit: true };
  return { allowed: incoming, overLimit: used + incoming > FREE_ITEM_LIMIT };
}

/** 用量面板要的三个数：已用、上限、还剩（解锁后上限是 Infinity，界面按「不限」显示） */
export interface QuotaInfo {
  used: number;
  limit: number;
  remaining: number;
  full: boolean;
}

/**
 * 合计用量。`used` 照实报——迁移进来的老数据可能早就超过上限，
 * 这里不把它按上限截断，否则用户看到「50/50」却明明有 76 条，只会觉得插件在骗人。
 */
export function quotaInfo(counts: PlanCounts): QuotaInfo {
  const used = totalOf(counts);
  const limit = isPaid() ? Infinity : FREE_ITEM_LIMIT;
  return {
    used,
    limit,
    remaining: limit === Infinity ? Infinity : Math.max(0, limit - used),
    full: used >= limit,
  };
}

/**
 * 单条加入还有没有余量；到顶时给一句能直接弹给人的话。
 *
 * `counts` 是**当前已存在**的条数：迁移进来的老数据可能早就超过上限，
 * 那种情况一律按「已满」处理——不删用户的东西，只是不能再加新的。
 *
 * 文案刻意写成「已用 50/50」而不是「最多 50 条」：用户要的是自己现在处在
 * 哪一格，不是再读一遍规则；后面那句「已有数据不会被删」是防恐慌的，
 * 上限提示最容易被误解成「要删我的东西」。
 */
export function quotaBlock(counts: PlanCounts): { ok: boolean; message: string } {
  if (isPaid()) return { ok: true, message: '' };
  const info = quotaInfo(counts);
  if (!info.full) return { ok: true, message: '' };
  return {
    ok: false,
    message: t('ent.used', { used: info.used, limit: info.limit }),
  };
}

/**
 * 批量导入越过上限时的提醒（「超一次」那一次弹）。
 * 明说这次全进去了、下次要先升级，不含 emoji、不说「已拒绝」。
 */
export function overLimitMessage(counts: PlanCounts, incoming: number): string {
  return t('ent.overOnce', { incoming, total: totalOf(counts) + incoming, limit: FREE_ITEM_LIMIT });
}

/**
 * 能力位登记表。仅用于界面文案与口径自查，不再是门控——所有能力恒放行。
 * 名字不在这里塞中文句子，界面文案走 CAPABILITY_LABELS。
 */
export type ProCapability = 'speech' | 'sourceLink' | 'bookReport' | 'cardManager';

/** 已知能力清单（只作登记，不参与放行判断） */
export const PRO_CAPABILITIES: readonly ProCapability[] = [
  'speech',
  'sourceLink',
  'bookReport',
  'cardManager',
] as const;

export const CAPABILITY_LABELS: Record<ProCapability, string> = {
  speech: t('ent.capTts'),
  sourceLink: t('ent.capJump'),
  bookReport: t('ent.capBookReport'),
  cardManager: t('ent.capManager'),
};

/**
 * 能力恒放行（产品决策 2026-11-18）：基础版与高级版功能完全一致，只限数量。
 * 连未知能力名也放行，这样未来新增功能不会被误锁成高级版专属。
 */
export function canUseCapability(_cap: ProCapability): boolean {
  return true;
}

/** 不再有功能拦截：任何入口都不弹升级提示，只保留数量上限的 quotaBlock */
export function capabilityBlock(_cap: ProCapability): { ok: boolean; message: string } {
  return { ok: true, message: '' };
}

/** 设置页的授权状态行 */
export function licenseSummary(): string {
  if (licenseRevoked()) {
    return t('ent.revoked', { limit: FREE_ITEM_LIMIT });
  }
  if (!state.paid) {
    const parsed = cachedCode ? parseLicense(cachedCode) : null;
    if (parsed?.payload?.exp && Date.now() > parsed.payload.exp) {
      return t('ent.baseExpired', { limit: FREE_ITEM_LIMIT });
    }
    return t('ent.baseFree', { limit: FREE_ITEM_LIMIT });
  }
  const who = state.name ? `（${state.name}）` : '';
  const until = state.exp ? t('ent.until', { date: new Date(state.exp).toLocaleDateString() }) : t('ent.forever');
  return t('ent.proActive', { who, until });
}

/** 当前真正生效的码（上次验签通过的那枚）。激活失败时用它恢复输入框与落盘值。 */
export function currentLicenseCode(): string {
  return cachedCode;
}

/**
 * 这枚码验签通过了、但被停用名单判死。
 *
 * 单独给出去，是因为界面要分清「没买」和「被封」：两者都是基础版，
 * 但用户看到的说明完全不同——前者引导去购买，后者要告诉他码被叫停了。
 */
export function licenseRevoked(): boolean {
  return state.paid && revokedNow();
}

/**
 * 用一枚码刷新授权状态（启动时与用户点「激活」时都走这里）。
 * 验签结论缓存进内存；码原文由调用方存 data.json。
 *
 * `commitFailure=false` 给「用户正在试填新码」的入口用：码不认就只回报
 * 「这枚不行」，不动当前授权（与 Reader 的 activateLicense 同口径）。否则
 * 输错一次就把真码的运行期结论冲掉——重启虽能恢复，当前会话已经掉级。
 * 空码是显式清码，任何情况下都提交。
 */
export async function refreshLicense(code: string, commitFailure = true): Promise<LicenseState> {
  if (!code || !code.trim()) {
    state = EMPTY;
    cachedCode = '';
    return state;
  }
  const r = await verifyLicense(code);
  if (!r.ok || !r.payload) {
    if (!commitFailure) return { paid: false, checkedAt: Date.now(), failReason: r.reason };
    cachedCode = code;
    state = { paid: false, checkedAt: Date.now(), failReason: r.reason };
    return state;
  }
  cachedCode = code;
  state = {
    paid: true,
    name: r.payload.name,
    plan: r.payload.plan,
    exp: r.payload.exp ?? 0,
    checkedAt: Date.now(),
  };
  return state;
}

/**
 * 激活一枚码的完整入口：验签 → 联网核对停用名单 → 通过才落状态。
 *
 * 与 Reader 的 `activateLicense` 同口径（2026-11-22 起）。设置页那枚
 * 「激活」按钮走这里，不再直接调 refreshLicense：离线签名只能证明
 * 「这枚码是作者发的」，证明不了「它现在还有效」。
 *
 * 三档结论：
 *   · 验签不过 → 说码无效（哪一步不过由 verifyLicense 给人话）
 *   · 名单命中 → 说已停用，**不落状态**
 *   · 拉不到 / 验签不过 / 旧名单 → 要求联网，不悄悄放行
 *     （否则断网激活一枚已停用的码，就绕过了整套封码）
 *
 * 与 Reader 的差别只有一处：Review 的码是**可选**的，激活失败只是继续用
 * 基础版，不会把人挡在门外，所以这里不需要额外的兜底出口。
 */
export async function activateLicense(
  code: string,
): Promise<{ ok: boolean; message: string; revoked?: boolean; fail?: ActivateFailLite }> {
  const clean = code.trim();
  if (!clean) {
    noteActivateFail('format');
    return { ok: false, message: t('lic.noCode'), fail: 'format' };
  }

  /* 本地已判死的码：断网也贴不回来，不必再等一次网络 */
  if (revokedCode().trim() === clean) {
    noteActivateFail('revoked');
    return { ok: false, message: t('lic.revoked'), revoked: true, fail: 'revoked' };
  }

  const r = await verifyLicense(clean);
  if (!r.ok || !r.payload) {
    /* 验签失败的原因按「用户该做什么」归类：格式不对让他检查粘贴，
       其余（签名改过 / 公钥缺失 / 环境异常）都归「码不认」 */
    const fail: ActivateFailLite =
      r.reason === 'expired' ? 'expired' : r.reason === 'format' || r.reason === 'empty' ? 'format' : 'invalid';
    noteActivateFail(fail);
    return { ok: false, message: r.message, fail };
  }

  const verdict = await checkRevoked(clean);
  if (verdict === 'hit') {
    noteActivateFail('revoked');
    return { ok: false, message: t('lic.revoked'), revoked: true, fail: 'revoked' };
  }
  if (verdict === 'unknown') {
    noteActivateFail('offline');
    return { ok: false, message: t('lic.needOnline'), fail: 'offline' };
  }

  cachedCode = clean;
  state = {
    paid: true,
    name: r.payload.name,
    plan: r.payload.plan,
    exp: r.payload.exp ?? 0,
    checkedAt: Date.now(),
  };
  /* 成功一次就把失败历史清干净：几个月前的一次手滑不该永远挂在档案上 */
  noteActivateFail(undefined);
  return { ok: true, message: r.message };
}
