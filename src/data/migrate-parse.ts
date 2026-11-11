/**
 * bz 的 review.json 解析（src/data/migrate-parse.ts）
 *
 * 单独一个文件是为了能被纯逻辑测试直接引用：migrate.ts 自己会拉进
 * core/storage（连着 obsidian 模块），测试里没必要为一次 JSON 校验
 * 去搭整套 Obsidian 假环境。
 */
export type ParsedBzReview = { ok: true; items: unknown[] } | { ok: false; message: string };

/**
 * 只做三件事：是不是合法 JSON、是不是数组、空数组也算成功
 * （空数组说明确实没有内容，不算错误）。
 */
export function parseBzReviewJson(raw: string): ParsedBzReview {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, message: 'bz 的复习数据不是合法 JSON，导入中止。' };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, message: 'bz 的复习数据不是数组，导入中止。' };
  }
  return { ok: true, items: parsed };
}
