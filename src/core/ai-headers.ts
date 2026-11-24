/* ============================================================
 * 复习 · 附加请求头（core/ai-headers.ts）
 *
 * 2026-11-22 从 bz Reader 同步：有些 OpenAI 兼容网关除了地址 / 密钥 / 模型之外
 * 还要一个（或几个）自定义请求头才能路由，例如 OpenCode Go 要求
 * `x-opencode-session`。设置页给一段文本，一行一个 `Header: value`：
 *   · 空行与 `#` 开头的注释行忽略；
 *   · 只按**第一个**冒号拆，值里再有冒号（Bearer / URL）不受影响；
 *   · 头名只认 HTTP token 字符，含空格 / 中文的行整行跳过；
 *   · 会破坏请求本身的头（Host / Content-Length 等）一律不收。
 * 纯函数：不读设置、不碰网络。
 * ============================================================ */

/** HTTP 头名允许的字符（RFC 7230 token）；比它宽的名字 requestUrl 也会拒绝 */
const HEADER_NAME_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

/** 这些头交给运行时自己算，用户填了只会把请求弄坏，直接丢。
 *  鉴权头也在内：密钥由通道自己写，用户再填一份只会把真密钥盖掉，报出莫名其妙的 401。 */
const FORBIDDEN = new Set([
  'host', 'content-length', 'transfer-encoding', 'connection', 'keep-alive', 'upgrade',
  'authorization', 'proxy-authorization', 'x-api-key',
]);

/** 附加请求头文本 → 头字典（解析失败的行走跳过，不抛错——一行写坏不该让整份配置不可用） */
export function parseExtraHeaders(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const at = line.indexOf(':');
    if (at <= 0) continue;
    const name = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim();
    if (!HEADER_NAME_RE.test(name)) continue;
    if (FORBIDDEN.has(name.toLowerCase())) continue;
    out[name] = value;
  }
  return out;
}
