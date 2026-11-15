/**
 * 评级键位（批 2，纯函数）。
 *
 * 四档评级原来把 1-4 写死在面板、弹窗、卡片会话三个地方：用数字键顺手的人
 * 觉得好，习惯 vim / 左手区的人每次都要伸手到数字行。改成一处设置、三处共用，
 * 校验也收在这里——配错（少一个字符、两个键相同）一律退回默认，不让界面进入
 * 「按什么都没反应」的状态。
 */
import type { Rating } from './fsrs';

/** 默认键位（与改造前完全一致，老用户无感） */
export const DEFAULT_RATING_KEYS = '1234';

/** 四档的固定顺序：忘了 / 困难 / 一般 / 简单 */
export const RATING_ORDER: Rating[] = ['again', 'hard', 'good', 'easy'];

/**
 * 规整用户填的键位：必须是 4 个互不相同的非空白字符。
 * 不合格一律退回默认，并在设置里由调用方提示（这里只做判定，不碰界面）。
 */
export function normalizeRatingKeys(raw: unknown): string {
  const s = String(raw ?? '').replace(/\s+/g, '');
  if (s.length !== 4) return DEFAULT_RATING_KEYS;
  if (new Set(s).size !== 4) return DEFAULT_RATING_KEYS;
  return s;
}

export function isValidRatingKeys(raw: unknown): boolean {
  const s = String(raw ?? '').replace(/\s+/g, '');
  return s.length === 4 && new Set(s).size === 4;
}

export function ratingKeys(raw: unknown): Record<Rating, string> {
  const s = normalizeRatingKeys(raw);
  return { again: s[0], hard: s[1], good: s[2], easy: s[3] };
}

/** 按下的键对应哪一档（不是评级键返回 null，调用方据此放行其它快捷键） */
export function ratingForKey(key: string, raw: unknown): Rating | null {
  if (!key) return null;
  const map = ratingKeys(raw);
  const k = key.length === 1 ? key.toLowerCase() : key;
  for (const r of RATING_ORDER) {
    const mapped = map[r];
    if (mapped === key || mapped.toLowerCase() === k) return r;
  }
  return null;
}

/** 界面上显示的键位提示（弹窗/会话头行用） */
export function keyLabelOf(rating: Rating, raw: unknown): string {
  return ratingKeys(raw)[rating];
}
