/**
 * 调度权重（批 3，纯函数）。
 *
 * 以前权重只能由拟合器写：用户想「我这个学科天生忘得快，把基础难度调高一点」，
 * 没有任何入口。现在设置里可以粘一串数字覆盖，拟合器只在没手填时生效——
 * 手填是明确意图，不该被后台拟合悄悄覆盖。
 */
import { DEFAULT_W } from './fsrs';

/** FSRS 权重固定 19 个 */
export const WEIGHTS_LENGTH = DEFAULT_W.length;

/**
 * 解析用户输入的一串权重：逗号/空格/换行分隔都认。
 *
 * 不合格一律返回 null（调用方回退拟合值），不做「尽量猜」——
 * 猜错一个数，整条记忆曲线的间隔就全歪了，而且用户看不出是哪里错。
 */
/** unknown → 安全字符串（typeof 守卫，避免对象默认 stringification） */
function textOf(v: unknown): string {
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  return '';
}

export function parseWeights(input: unknown): number[] | null {
  if (input === null || input === undefined) return null;
  const text = textOf(input).trim();
  if (!text) return null;
  const parts = text.split(/[\s,，;；]+/).filter(Boolean);
  if (parts.length !== WEIGHTS_LENGTH) return null;
  const nums = parts.map((p) => Number(p));
  /* 0 也要拒绝：初始稳定性为 0 会让 R(t,S)=(1+t/(S·d))^-d 除零；
     而 fsrs.initS 用 ?? 兜底不会再把 0 悄悄改成 1——入口不挡就会落一张坏曲线。 */
  if (nums.some((n) => !Number.isFinite(n) || n <= 0)) return null;
  return nums;
}

/** 实际使用的权重：手填合法就用它，否则用拟合值，再否则默认 */
export function resolveWeights(manual: unknown, fitted?: number[] | null): number[] {
  return parseWeights(manual) ?? (Array.isArray(fitted) && fitted.length === WEIGHTS_LENGTH ? fitted : DEFAULT_W);
}

/** 把权重转回可编辑文本（设置页回显用） */
export function weightsToText(w: readonly number[]): string {
  return w.join(', ');
}
