import { createSign, generateKeyPairSync } from 'node:crypto';
import { setVerifyPublicKeysForTest } from '../../src/data/license';

/**
 * 测试用签发器：运行时生成两对临时 P-256 密钥，全程只在内存里，不落盘、不进仓库。
 *
 * 旧实现读 scripts/keys/private.pem（被 .gitignore 排除），干净克隆/CI 下密钥不存在，
 * 验签测试整段 runIf 跳过——「481 个测试通过」对授权核心其实零覆盖。但把测试私钥
 * 提交进仓库又等于公开泄露。办法是这里生成临时对：公钥注入 verifyLicense，私钥签码，
 * 测试进程结束即弃。真机签发（scripts/gen-keys.mjs / issue-license.mjs）完全不变。
 */

function makeKeyPair(): { privatePem: string; publicB64: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicB64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
}

const LOCAL = makeKeyPair();
const READER = makeKeyPair();

// 临时公钥注入验签器，让 verifyLicense 用它们而不是内嵌的生产公钥。
setVerifyPublicKeysForTest(LOCAL.publicB64, READER.publicB64);

export interface Payload {
  v?: 1 | 2;
  id?: string;
  name?: string;
  patron?: boolean;
  plan?: string;
  exp?: number;
}

/** DER 的 ECDSA 签名 → IEEE-P1363 裸格式（r||s 各 32 字节） */
function derToP1363(der: Buffer): Buffer {
  let at = 2;
  const readInt = (): Buffer => {
    const len = der[at + 1];
    const val = der.subarray(at + 2, at + 2 + len);
    at += 2 + len;
    const out = Buffer.alloc(32);
    let start = 0;
    while (start < val.length && val[start] === 0) start += 1;
    val.copy(out, 32 - (val.length - start), start);
    return out;
  };
  return Buffer.concat([readInt(), readInt()]);
}

const b64url = (buf: Buffer): string =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function signWith(privatePem: string, payload: Payload, prefix: string): string {
  const bytes = Buffer.from(JSON.stringify({ v: 2, ...payload }), 'utf8');
  const signer = createSign('sha256');
  signer.update(bytes);
  const der = signer.sign({ key: privatePem, dsaEncoding: 'der' });
  return `${prefix}.${b64url(bytes)}.${b64url(derToP1363(der))}`;
}

/** Review 本地高级版码 */
export function signCode(payload: Payload, prefix = 'BZP2'): string {
  return signWith(LOCAL.privatePem, payload, prefix);
}

/** Reader 签发的码：赞助人 / 专属定制码带 patron: true */
export function signReaderCode(payload: Payload, prefix = 'BZR2'): string {
  return signWith(READER.privatePem, payload, prefix);
}

/** 兼容旧测试的导出名：密钥在内存，永远可用 */
export const HAS_KEYS = true;
export const HAS_READER_KEYS = true;
