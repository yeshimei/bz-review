/**
 * 授权状态、数量限制与能力登记（src/data/entitlement.ts）
 *
 * 与 bz / bz Reader / 归物本同构：一个完整包，运行期由激活码决定数量上限。
 *
 * 产品决策（2026-11-18）：基础版与高级版功能完全一致，只限数量——
 *   数量：基础版复习笔记 20 篇 + 划线卡 50 条（两类分别计数），高级版都不限；
 *   能力：全部放开。现有四项免费可用，未来新增功能同样不对基础版关闭。
 *
 * 能力位保留为登记清单（PRO_CAPABILITIES / CAPABILITY_LABELS），
 * 供界面文案、用量口径与测试引用；门控本身恒放行，架构上不再有功能差异。
 */
import { parseLicense, verifyLicense } from './license';

/** 购买页（与 bz Reader / 归物本同一个店铺） */
export const PURCHASE_URL = 'https://wzyp.cn/shop/IFCEI5I3';
/** 交流群（与 bz Reader 同一个群） */
export const GROUP_ID = '1130883117';

/** 基础版：复习笔记上限（篇） */
export const FREE_NOTE_LIMIT = 20;
/** 基础版：划线卡上限（条） */
export const FREE_CARD_LIMIT = 50;

export interface LicenseState {
  /** 是否已解锁高级版 */
  paid: boolean;
  /** 激活码里的署名 */
  name?: string;
  plan?: string;
  /** 过期毫秒戳；0/缺省 = 永久 */
  exp?: number;
  /** 上次验签时间（仅用于设置页人话） */
  checkedAt: number;
}

const EMPTY: LicenseState = { paid: false, checkedAt: 0 };

let state: LicenseState = EMPTY;
let cachedCode = '';

/** main.ts 启动时与激活后写入 */
export function setLicenseState(next: LicenseState, code = ''): void {
  state = next;
  cachedCode = code;
}

export function getLicenseState(): LicenseState {
  return state;
}

export function isPaid(): boolean {
  return state.paid;
}

/** 两类条目的当前计数（由调用方从排期表里数，别在这里读盘） */
export interface PlanCounts {
  notes: number;
  cards: number;
}

/**
 * 额度到顶的专用错误。调用方早先靠消息文本认「基础版最多」，而 quotaBlock
 * 实际说的是「基础版上限」——第 21 篇只能看到一句失败提示，不会弹升级窗。
 * 现在带类型的错误让界面能稳稳认出「这是额度到顶」→ 弹高级功能窗，
 * 而不是把正常的上限拦当成写盘失败。
 */
export class QuotaExceededError extends Error {
  constructor(
    public readonly kind: 'note' | 'card',
    message: string,
  ) {
    super(message);
    this.name = 'QuotaExceededError';
  }
}

/** 当前还能不能再加一篇复习笔记 */
export function canAddNote(notes: number): boolean {
  return isPaid() || notes < FREE_NOTE_LIMIT;
}

/** 当前还能不能再加一条划线卡 */
export function canAddCard(cards: number): boolean {
  return isPaid() || cards < FREE_CARD_LIMIT;
}

/** 还能加几篇（已解锁返回 Infinity） */
export function remainingNotes(notes: number): number {
  return isPaid() ? Infinity : Math.max(0, FREE_NOTE_LIMIT - notes);
}

/** 还能加几条（已解锁返回 Infinity） */
export function remainingCards(cards: number): number {
  return isPaid() ? Infinity : Math.max(0, FREE_CARD_LIMIT - cards);
}

/** 用量面板要的三个数：已用、上限、还剩（解锁后上限是 Infinity，界面按「不限」显示） */
export interface QuotaInfo {
  used: number;
  limit: number;
  remaining: number;
  full: boolean;
}

/**
 * 某一类当前用量。`used` 照实报——迁移进来的老数据可能早就超过上限，
 * 这里不把它按上限截断，否则用户看到「20/20」却明明有 26 条，只会觉得插件在骗人。
 */
export function quotaInfo(kind: 'note' | 'card', counts: PlanCounts): QuotaInfo {
  const used = kind === 'note' ? counts.notes : counts.cards;
  const limit = isPaid() ? Infinity : kind === 'note' ? FREE_NOTE_LIMIT : FREE_CARD_LIMIT;
  return {
    used,
    limit,
    remaining: limit === Infinity ? Infinity : Math.max(0, limit - used),
    full: used >= limit,
  };
}

/**
 * 某一类还有没有余量；到顶时给一句能直接弹给人的话。
 *
 * `counts` 是**当前已存在**的条数：迁移进来的老数据可能早就超过上限，
 * 那种情况一律按「已满」处理——不删用户的东西，只是不能再加新的。
 *
 * 文案刻意写成「已用 20/20」而不是「最多 20 篇」：用户要的是自己现在处在
 * 哪一格，不是再读一遍规则；后面那句「已有数据不会被删」是防恐慌的，
 * 上限提示最容易被误解成「要删我的东西」。
 */
export function quotaBlock(
  kind: 'note' | 'card',
  counts: PlanCounts,
): { ok: boolean; message: string } {
  if (isPaid()) return { ok: true, message: '' };
  const info = quotaInfo(kind, counts);
  if (!info.full) return { ok: true, message: '' };
  const unit = kind === 'note' ? '篇复习笔记' : '条划线卡';
  return {
    ok: false,
    message: `已用 ${info.used}/${info.limit} ${unit}（基础版上限）。激活高级版解锁不限数量，已有数据不会被删。`,
  };
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
  speech: '听卡片',
  sourceLink: '跳回原文',
  bookReport: '按书报告',
  cardManager: '卡片管理器',
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
  if (!state.paid) {
    const parsed = cachedCode ? parseLicense(cachedCode) : null;
    if (parsed?.payload?.exp && Date.now() > parsed.payload.exp) {
      return `基础版：${FREE_NOTE_LIMIT} 篇笔记 + ${FREE_CARD_LIMIT} 条划线，所有功能可用。当前激活码已过期。`;
    }
    return `基础版：${FREE_NOTE_LIMIT} 篇笔记 + ${FREE_CARD_LIMIT} 条划线，所有功能可用；填激活码解锁不限数量。`;
  }
  const who = state.name ? `（${state.name}）` : '';
  const until = state.exp ? `有效期到 ${new Date(state.exp).toLocaleDateString()}` : '永久有效';
  return `高级版已激活${who}：${until}，数量不限、所有功能可用。`;
}

/** 当前真正生效的码（上次验签通过的那枚）。激活失败时用它恢复输入框与落盘值。 */
export function currentLicenseCode(): string {
  return cachedCode;
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
    if (!commitFailure) return { paid: false, checkedAt: Date.now() };
    cachedCode = code;
    state = { paid: false, checkedAt: Date.now() };
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
