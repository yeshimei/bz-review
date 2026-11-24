/* ============================================================
 * Review · 激活码（data/license.ts）
 *
 * 格式 `BZP2.<base64url(payload)>.<base64url(sig)>`：
 *   payload = UTF-8 JSON `{ v: 2, id, name?, plan, exp? }`
 *   exp 是毫秒时间戳，缺省/0 = 永久；
 *   sig = ECDSA P-256 + SHA-256，IEEE-P1363 裸格式（r||s 各 32 字节）。
 *
 * 验签本身离线：公钥内嵌在包里。停用名单核对与试用码最新版检查另走网络，
 * 那两道门在 entitlement 里做，与这里的签名验证分开。
 * 这套机制与 bz / bz Reader / 归物本同源，前缀与密钥对各自独立：
 * 普通高级版码只在本插件有效；**例外**是赞助人 / 专属定制码
 * （payload.patron === true，Reader 私钥签发），两款插件都能激活。
 * ============================================================ */
import { t } from '../i18n/strings';

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

/** base64url → 字节。停用名单验签也用它，放在这里只留一份实现。 */
export function b64urlToBytes(s: string): Uint8Array {
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

/**
 * 用发行方公钥验一段任意字节的签名（P1363 裸格式 r||s）。
 *
 * 停用名单（data/revoked）复用它：名单是公开文件，必须验签，否则代理 / 机场
 * 塞一份假名单就能把所有付费用户打回基础版——那是比盗版更糟的事故。
 * 验签环境异常一律返回 false：「验不了」不能当成「验过了」。
 *
 * 与 Reader 的同名函数同口径，只是公钥是 Review 自己那把。
 */
export async function verifySignedBytes(bytes: Uint8Array, sig: Uint8Array): Promise<boolean> {
  const pub = testLocalPubB64 ?? PUBKEY_SPKI_B64;
  if (!pub) return false;
  try {
    const key = await spkiToCryptoKey(Uint8Array.from(atob(pub), (c) => c.charCodeAt(0)).buffer);
    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      new Uint8Array(sig).buffer,
      new Uint8Array(bytes).buffer,
    );
  } catch {
    return false;
  }
}

function dateText(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** 验一枚激活码。任何一步不过都给人话，不抛。 */
export async function verifyLicense(code: string): Promise<LicenseCheck> {
  if (!code.trim()) return { ok: false, reason: 'empty', message: t('lic.noCode') };
  if (!PUBKEY_SPKI_B64 && !testLocalPubB64) {
    return { ok: false, reason: 'no-pubkey', message: t('lic.noPublicKey') };
  }
  const parsed = parseLicense(code);
  if (!parsed) {
    return {
      ok: false,
      reason: 'format',
      message: t('lic.badFormat'),
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
    if (!ok) return { ok: false, reason: 'invalid', message: t('lic.badSignature') };
    /* Reader 的码只对「赞助人 / 专属定制」开口子：普通高级版码仍各自激活。
       用 Reader 私钥签的普通码前缀换成 BZP2 也过不了——公钥跟着前缀走。 */
    if (fromReader && parsed.payload.patron !== true) {
      return {
        ok: false,
        reason: 'scope',
        message: t('lic.wrongPlugin'),
      };
    }
    const exp = parsed.payload.exp ?? 0;
    if (exp && Date.now() > exp) {
      return { ok: false, reason: 'expired', message: t('lic.expired', { date: dateText(exp) }) };
    }
    const who = parsed.payload.name ? `，${parsed.payload.name}` : '';
    const until = exp ? t('lic.until', { date: dateText(exp) }) : t('lic.forever');
    return { ok: true, message: t('lic.activated', { who, until }), payload: parsed.payload };
  } catch (e) {
    return {
      ok: false,
      reason: 'env-error',
      message: t('lic.verifyError', { reason: (e as Error)?.message || 'WebCrypto unavailable' }),
    };
  }
}

/**
 * 这枚码是不是试用码（2026-11-22）。
 *
 * 只有试用码受「必须最新版」约束；买断码与赞助人码什么都不限制。
 * 判定放在唯一入口，entitlement 与签发脚本共用同一口径。
 */
export function isTrialCode(payload: LicensePayload | null | undefined): boolean {
  return payload?.plan === 'trial';
}
