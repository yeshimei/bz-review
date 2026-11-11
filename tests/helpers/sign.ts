import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 测试用的签发器：拿 scripts/keys/private.pem 签一枚真码。
 *
 * 刻意不复用 scripts/issue-license.mjs——那个是 CLI，输出到 stdout，
 * 而且它拒绝在密钥不存在时静默继续。测试要的是「能签、能指定过期时间」。
 */
const KEY_PATH = join(process.cwd(), 'scripts', 'keys', 'private.pem');

export interface Payload {
  v?: 1 | 2;
  id?: string;
  name?: string;
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

export function signCode(payload: Payload, prefix = 'BZP2'): string {
  const bytes = Buffer.from(JSON.stringify({ v: 2, ...payload }), 'utf8');
  const signer = createSign('sha256');
  signer.update(bytes);
  const der = signer.sign({ key: readFileSync(KEY_PATH), dsaEncoding: 'der' });
  return `${prefix}.${b64url(bytes)}.${b64url(derToP1363(der))}`;
}

export const HAS_KEYS = (() => {
  try {
    readFileSync(KEY_PATH);
    return true;
  } catch {
    return false;
  }
})();
