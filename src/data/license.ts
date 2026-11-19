/* ============================================================
 * Review · 激活码（data/license.ts）
 *
 * 格式 `BZP2.<base64url(payload)>.<base64url(sig)>`：
 *   payload = UTF-8 JSON `{ v: 2, id, name?, plan, exp? }`
 *   exp 是毫秒时间戳，缺省/0 = 永久；
 *   sig = ECDSA P-256 + SHA-256，IEEE-P1363 裸格式（r||s 各 32 字节）。
 *
 * 离线验签，不联网：公钥内嵌在包里，激活一次管到 exp 为止。
 * 这套机制与 bz / bz Reader / 归物本同源，前缀与密钥对各自独立：
 * 普通高级版码只在本插件有效；**例外**是赞助人 / 专属定制码
 * （payload.patron === true，Reader 私钥签发），两款插件都能激活。
 * ============================================================ */

/** ECDSA P-256 公钥（SPKI DER 的 base64）。由 scripts/gen-keys.mjs 生成。 */
const PUBKEY_SPKI_B64 =
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEF6+mBvqMpLZTZIK7w5nTzVbqRJ9MfLMcbp1fcq4FPFqYa4S/EstvYC7KcUcLSRpiaXOLxspUVUzAsjqbrD65sQ==';

/** bz Reader 的公钥：只用来验它签发的赞助人 / 专属定制码。 */
const READER_PUBKEY_SPKI_B64 =
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEDlauLuKMfRhggbifaU3QcR1R+gX7518ibeYfPeyFzLYcQesrjY0vViS/SukngZqMZDPwBbebtPoGqw/pLJRnxg==';

/**
 * 测试专用公钥注入点。
 * 生产代码永不调用；测试在运行时用 Node crypto 生成临时密钥对，把公钥（base64 SPKI）
 * 注入这里、私钥只留在内存签码，测试结束即弃。这样授权验签的核心路径能被真正测到，
 * 而仓库/Git 历史里不需要存放任何测试私钥（存在即等于泄露）。
 */
let testLocalPubB64: string | null = null;
let testReaderPubB64: string | null = null;
export function setVerifyPublicKeysForTest(local?: string | null, reader?: string | null): void {
  testLocalPubB64 = local ?? null;
  testReaderPubB64 = reader ?? null;
}

export type LicensePlan = 'lifetime' | 'year' | 'trial';

export interface LicensePayload {
  v: 1 | 2;
  id?: string;
  name?: string;
  /**
   * 赞助人 / 专属定制标记。Reader 的码带这个字段时可在 Review 激活；
   * 没有的就是 Reader 自己卖的高级版码，仍只在 Reader 有效。
   */
  patron?: boolean;
  plan?: LicensePlan;
  exp?: number;
}

/**
 * 验签失败的原因分类。
 *   empty / format / no-pubkey / invalid / expired / scope / env-error
 */
export type LicenseFail =
  | 'empty'
  | 'format'
  | 'no-pubkey'
  | 'invalid'
  | 'expired'
  | 'scope'
  | 'env-error';

export interface LicenseCheck {
  ok: boolean;
  message: string;
  payload?: LicensePayload;
  reason?: LicenseFail;
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface ParsedLicense {
  /** 决定用哪把公钥验：BZP* 是本地，BZR* 是 Reader 的通用码 */
  prefix: string;
  payloadBytes: Uint8Array;
  sig: Uint8Array;
  payload: LicensePayload;
}

export function parseLicense(code: string): ParsedLicense | null {
  const parts = code.trim().split('.');
  if (parts.length !== 3) return null;
  const prefix = parts[0];
  if (
    prefix !== 'BZP1' &&
    prefix !== 'BZP2' &&
    prefix !== 'BZR1' &&
    prefix !== 'BZR2'
  ) {
    return null;
  }
  try {
    const payloadBytes = b64urlToBytes(parts[1]);
    const sig = b64urlToBytes(parts[2]);
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as LicensePayload;
    if (payload?.v !== 1 && payload?.v !== 2) return null;
    return { prefix, payloadBytes, sig, payload };
  } catch {
    return null;
  }
}

function spkiToCryptoKey(spki: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey('spki', spki, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
}

function dateText(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** 验一枚激活码。任何一步不过都给人话，不抛。 */
export async function verifyLicense(code: string): Promise<LicenseCheck> {
  if (!code.trim()) return { ok: false, reason: 'empty', message: '还没有填激活码。' };
  if (!PUBKEY_SPKI_B64 && !testLocalPubB64) {
    return { ok: false, reason: 'no-pubkey', message: '发行方还没配置公钥。' };
  }
  const parsed = parseLicense(code);
  if (!parsed) {
    return {
      ok: false,
      reason: 'format',
      message: '激活码格式不对：应为 BZP1 / BZP2 / BZR1 / BZR2 开头的三段式。',
    };
  }
  const fromReader = parsed.prefix === 'BZR1' || parsed.prefix === 'BZR2';
  try {
    const pub = fromReader
      ? (testReaderPubB64 ?? READER_PUBKEY_SPKI_B64)
      : (testLocalPubB64 ?? PUBKEY_SPKI_B64);
    const key = await spkiToCryptoKey(
      Uint8Array.from(atob(pub), (c) => c.charCodeAt(0)).buffer,
    );
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      new Uint8Array(parsed.sig).buffer,
      new Uint8Array(parsed.payloadBytes).buffer,
    );
    if (!ok) return { ok: false, reason: 'invalid', message: '激活码验签失败：内容或签名被改过。' };
    /* Reader 的码只对「赞助人 / 专属定制」开口子：普通高级版码仍各自激活。
       用 Reader 私钥签的普通码前缀换成 BZP2 也过不了——公钥跟着前缀走。 */
    if (fromReader && parsed.payload.patron !== true) {
      return {
        ok: false,
        reason: 'scope',
        message: '这是 bz Reader 的高级版激活码。只有赞助人与专属定制码可跨插件使用；两款插件的高级版码请分别在各自的插件激活。',
      };
    }
    const exp = parsed.payload.exp ?? 0;
    if (exp && Date.now() > exp) {
      return { ok: false, reason: 'expired', message: `激活码已于 ${dateText(exp)} 过期。` };
    }
    const who = parsed.payload.name ? `，${parsed.payload.name}` : '';
    const until = exp ? `有效期到 ${dateText(exp)}` : '永久有效';
    return { ok: true, message: `已激活${who}，${until}。`, payload: parsed.payload };
  } catch (e) {
    return {
      ok: false,
      reason: 'env-error',
      message: `验签出错：${(e as Error)?.message || '环境不支持 WebCrypto'}`,
    };
  }
}
