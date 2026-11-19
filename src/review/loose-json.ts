/* ============================================================
 * bz · 宽容 JSON 解析（review/loose-json.ts）
 *
 * 模型的 Python 味儿很重：数组最后一个元素后面还要留个逗号
 * （`["A","B","C","D",]`）。严格 JSON.parse 会整段失败，于是辛苦生成的
 * 一整份题库/抽认卡全白费。
 *
 * 只修尾逗号这一种瑕疵——别的语法错误照样当失败，不猜、不补全。猜出来的
 * 东西比没有更糟：用户会把一条读不通的题当成自己的问题。
 * ============================================================ */

/**
 * 只删「数组/对象末尾的逗号」，且跳过字符串字面量内部。
 * 朴素正则会把 `"a,]"` 里的 `,]` 也改掉——字符串内容被静默篡改，
 * 用户的一道题就这么变成另一道题。这里按词法扫一遍，引号内的字符原样保留
 * （含转义 \"）。
 */
function stripTrailingCommasOutsideStrings(src: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inString) {
      out += c;
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === ',') {
      // 向后看：跳过空白后是 ] 或 } 才是尾逗号，丢掉它
      let j = i + 1;
      while (j < src.length && /\s/.test(src[j])) j++;
      if (j < src.length && (src[j] === ']' || src[j] === '}')) continue;
    }
    out += c;
  }
  return out;
}

export function parseLooseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    /* 落到下面修一次 */
  }
  try {
    return JSON.parse(stripTrailingCommasOutsideStrings(String(text)));
  } catch {
    return null;
  }
}
