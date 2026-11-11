/**
 * 授权状态与两类数量限制（src/data/entitlement.ts）
 *
 * 与 bz / bz Reader / 归物本同构：一个完整包，运行期由激活码决定「高级版」是否解锁。
 * 唯一的差别在门控口径——**只锁数量，不锁功能**：
 *   基础版：复习笔记 20 篇 + 划线卡 50 条（两类分别计数）
 *   高级版：两类都不限
 * 提醒、评级、统计、记忆分析、做题家、AI 抽认卡、划线卡三种复习方式——两边完全一致。
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

/**
 * 某一类还有没有余量；到顶时给一句能直接弹给人的话。
 *
 * `counts` 是**当前已存在**的条数：迁移进来的老数据可能早就超过上限，
 * 那种情况一律按「已满」处理——不删用户的东西，只是不能再加新的。
 */
export function quotaBlock(
  kind: 'note' | 'card',
  counts: PlanCounts,
): { ok: boolean; message: string } {
  if (isPaid()) return { ok: true, message: '' };
  if (kind === 'note') {
    if (counts.notes < FREE_NOTE_LIMIT) return { ok: true, message: '' };
    return {
      ok: false,
      message: `基础版最多 ${FREE_NOTE_LIMIT} 篇复习笔记（现有 ${counts.notes} 篇）。激活高级版后可无限添加。`,
    };
  }
  if (counts.cards < FREE_CARD_LIMIT) return { ok: true, message: '' };
  return {
    ok: false,
    message: `基础版最多 ${FREE_CARD_LIMIT} 条划线卡（现有 ${counts.cards} 条）。激活高级版后可无限添加。`,
  };
}

/** 设置页的授权状态行 */
export function licenseSummary(): string {
  if (!state.paid) {
    const parsed = cachedCode ? parseLicense(cachedCode) : null;
    if (parsed?.payload?.exp && Date.now() > parsed.payload.exp) {
      return `基础版：${FREE_NOTE_LIMIT} 篇笔记 + ${FREE_CARD_LIMIT} 条划线。当前激活码已过期。`;
    }
    return `基础版：${FREE_NOTE_LIMIT} 篇笔记 + ${FREE_CARD_LIMIT} 条划线。填激活码解锁不限数量。`;
  }
  const who = state.name ? `（${state.name}）` : '';
  const until = state.exp ? `有效期到 ${new Date(state.exp).toLocaleDateString()}` : '永久有效';
  return `高级版已激活${who}：${until}，数量不限。`;
}

/**
 * 用一枚码刷新授权状态（启动时与用户点「激活」时都走这里）。
 * 验签结论缓存进内存；码原文由调用方存 data.json。
 */
export async function refreshLicense(code: string): Promise<LicenseState> {
  if (!code || !code.trim()) {
    state = EMPTY;
    cachedCode = '';
    return state;
  }
  const r = await verifyLicense(code);
  cachedCode = code;
  if (!r.ok || !r.payload) {
    state = { paid: false, checkedAt: Date.now() };
    return state;
  }
  state = {
    paid: true,
    name: r.payload.name,
    plan: r.payload.plan,
    exp: r.payload.exp ?? 0,
    checkedAt: Date.now(),
  };
  return state;
}
