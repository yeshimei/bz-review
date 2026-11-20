/* ============================================================
 * bz · 「加入复习」统一流程的数据形状（review/add-flow-model.ts）
 *
 * 2026-11-21 用户拍板：**任何入口、任何内容都走同一条流程**——
 * 笔记命令、文件树右键、文件夹、面板空态、监听自动收编、编辑区选段、
 * 阅读器书右键 / 工具条 / 划选，全部先经过「挑内容 → 选方式 → 出题面 →
 * 确认入库」，没有哪一条路可以绕过去直接写库。
 *
 * 这个文件只放纯逻辑：整篇笔记的稳定钥匙、来源构造、给模型看的正文截断、
 * 文件夹候选、静默判定、入库结果统一话术。零 DOM、零 IO、零模型调用。
 * ========================================================== */
import type { CardMode } from './card-mode';
import type { ReviewAddSummary } from './reader-api';

/**
 * 整篇笔记卡的钥匙前缀。
 *
 * 与选段卡的 `note:<path>:<from>:<to>` 共用 `note:` 家族，但整篇不带范围——
 * 正文一改，字符偏移就变；钥匙要是跟着变，同一篇笔记每编辑一次就会被当成
 * 新内容再排一遍。
 */
export const NOTE_WHOLE_PREFIX = 'note:';

/** 整篇笔记的稳定钥匙：只认路径，不认正文长度 */
export function noteWholeKey(path: string): string {
  const p = String(path ?? '').trim();
  return p ? `${NOTE_WHOLE_PREFIX}${p}` : '';
}

/** 交给统一制卡流程的一条来源（阅读器那套也长这样，多一个 aiText） */
export interface AddFlowSource {
  key: string;
  bookTitle: string;
  text: string;
  sourceNote?: { path: string; from: number; to: number };
  /**
   * 只给模型看的那份正文。
   *
   * 整篇笔记可能几千字，全塞进提示词既慢又贵；卡上仍存全文（复习时看完整
   * 原文），模型只看前一段。缺省 = 与 text 相同。
   */
  aiText?: string;
}

/** 给模型看的正文上限（字符数）；超出部分不参与出题 */
export const AI_TEXT_LIMIT = 1500;

/** 按字符截断给模型看的正文；返回 clipped 供界面提示「只按前 N 字出题」 */
export function clipForAI(text: string, limit = AI_TEXT_LIMIT): { text: string; clipped: boolean } {
  const raw = String(text ?? '');
  const chars = Array.from(raw);
  const cap = Math.max(1, Math.trunc(Number(limit) || AI_TEXT_LIMIT));
  if (chars.length <= cap) return { text: raw, clipped: false };
  return { text: chars.slice(0, cap).join(''), clipped: true };
}

/**
 * 文件开头 frontmatter 的字节长度（没有就是 0）。
 *
 * 整篇笔记加入复习时，frontmatter 是元数据不是正文：卡上不该显示它，
 * 模型也不该拿它出题；但「回到原文」的字符范围要跳过它，所以这里回长度
 * 而不是只回文本。
 */
export function frontmatterLength(text: string): number {
  const raw = String(text ?? '');
  const m = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
  return m ? m[0].length : 0;
}

/**
 * 一篇笔记 → 一条来源。
 *
 * 正文为空（空笔记 / 只有空白 / 只有 frontmatter）返回 null——空卡进了计划
 * 也只是个占位，复习时什么都看不到。frontmatter 不算正文，从卡上去掉；
 * 出处范围从正文开头算起，跳回原文时不会把元数据一起选上。
 */
export function noteSourceOf(path: string, title: string, text: string): AddFlowSource | null {
  const p = String(path ?? '').trim();
  const raw = String(text ?? '');
  if (!p || !raw.trim()) return null;
  const key = noteWholeKey(p);
  if (!key) return null;
  const skip = frontmatterLength(raw);
  const body = raw.slice(skip);
  if (!body.trim()) return null;
  const clipped = clipForAI(body);
  const src: AddFlowSource = {
    key,
    bookTitle: String(title ?? '').trim() || p.split('/').pop() || p,
    text: body,
    /* 整篇的出处范围就是正文本身：回到原文时打开文件并选中正文 */
    sourceNote: { path: p, from: skip, to: raw.length },
  };
  if (clipped.clipped) src.aiText = clipped.text;
  return src;
}

/** 文件夹里的笔记（递归；folder 为空 = 库根）；只认 .md，大小写不敏感 */
export function folderNotePaths(paths: readonly string[], folder: string): string[] {
  const all = Array.isArray(paths) ? paths : [];
  const base = String(folder ?? '').trim();
  const prefix = base && !base.endsWith('/') ? `${base}/` : base;
  return all
    .filter((p): p is string => typeof p === 'string' && p.toLowerCase().endsWith('.md'))
    .filter((p) => (prefix ? p.startsWith(prefix) : true));
}

/**
 * 「不用每次询问」的唯一判据：设置里的「新卡默认方式」不是「每次问我」。
 *
 * 用户 2026-11-21 原话：除非在设置界面设了不用每次询问，否则任何地方都要走流程。
 * 这里不新增开关——设置里已经有「新卡默认方式」，它就是那个开关。
 */
export function silentModeOf(defaultMethod: CardMode | null | undefined): CardMode | null {
  return defaultMethod ?? null;
}

/** 入库结果 → 一句统一话术（所有入口共用，别再各写一套「已在复习中」） */
export function addSummaryText(res: ReviewAddSummary, unit = '条'): string {
  const added = Math.max(0, Number(res?.added) || 0);
  const exists = Math.max(0, Number(res?.exists) || 0);
  const notFound = Math.max(0, Number(res?.notFound) || 0);
  const rejected = Math.max(0, Number(res?.rejected) || 0);
  const parts: string[] = [];
  if (added) parts.push(`已加入 ${added} ${unit}`);
  if (exists) parts.push(parts.length ? `${exists} ${unit}本来就在计划里` : `这 ${exists} ${unit}已经在复习计划里了`);
  if (notFound) parts.push(`${notFound} ${unit}找不到`);
  if (rejected) parts.push(`${rejected} ${unit}超出基础版上限`);
  if (!parts.length) return '没有可加入的内容';
  return parts.join('，');
}

/** 这批结果里有没有真的加进去（决定通知色档） */
export function addHappened(res: ReviewAddSummary): boolean {
  return (Number(res?.added) || 0) > 0;
}
