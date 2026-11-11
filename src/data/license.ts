/* ============================================================
 * Review · 激活码（data/license.ts）
 *
 * 格式 `BZP2.<base64url(payload)>.<base64url(sig)>`：
 *   payload = UTF-8 JSON `{ v: 2, id, name?, plan, exp? }`
 *   exp 是毫秒时间戳，缺省/0 = 永久；
 *   sig = ECDSA P-256 + SHA-256，IEEE-P1363 裸格式（r||s 各 32 字节）。
 *
 * 离线验签，不联网：公钥内嵌在包里，激活一次管到 exp 为止。
 * 这套机制与 bz / bz Reader / 归物本同源，只是换了前缀与密钥对——
 * 四者的码互不通用，各自的私钥也只签各自的。
 * ============================================================ */

/** ECDSA P-256 公钥（SPKI DER 的 base64）。由 scripts/gen-keys.mjs 生成。 */
const PUBKEY_SPKI_B64 =
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEF6+mBvqMpLZTZIK7w5nTzVbqRJ9MfLMcbp1fcq4FPFqYa4S/EstvYC7KcUcLSRpiaXOLxspUVUzAsjqbrD65sQ==';

export type LicensePlan = 'lifetime' | 'year' | 'trial';

export interface LicensePayload {
  v: 1 | 2;
  id?: string;
  name?: string;
  plan?: LicensePlan;
  exp?: number;
}

/**
 * 验签失败的原因分类。
 *   empty / format / no-pubkey / invalid / expired / env-error
 */
export type LicenseFail = 'empty' | 'format' | 'no-pubkey' | 'invalid' | 'expired' | 'env-error';

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

export function parseLicense(
  code: string,
): { payloadBytes: Uint8Array; sig: Uint8Array; payload: LicensePayload } | null {
  const parts = code.trim().split('.');
  if (parts.length !== 3) return null;
  if (parts[0] !== 'BZP1' && parts[0] !== 'BZP2') return null;
  try {
    const payloadBytes = b64urlToBytes(parts[1]);
    const sig = b64urlToBytes(parts[2]);
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as LicensePayload;
    if (payload?.v !== 1 && payload?.v !== 2) return null;
    return { payloadBytes, sig, payload };
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
  if (!PUBKEY_SPKI_B64) {
    return { ok: false, reason: 'no-pubkey', message: '发行方还没配置公钥。' };
  }
  const parsed = parseLicense(code);
  if (!parsed) {
    return { ok: false, reason: 'format', message: '激活码格式不对：应为 BZP1 / BZP2 开头的三段式。' };
  }
  try {
    const key = await spkiToCryptoKey(
      Uint8Array.from(atob(PUBKEY_SPKI_B64), (c) => c.charCodeAt(0)).buffer,
    );
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      new Uint8Array(parsed.sig).buffer,
      new Uint8Array(parsed.payloadBytes).buffer,
    );
    if (!ok) return { ok: false, reason: 'invalid', message: '激活码验签失败：内容或签名被改过。' };
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
