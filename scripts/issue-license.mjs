#!/usr/bin/env node
/* ============================================================
 * issue-license.mjs —— 签发 Review（复习）激活码
 *
 *   node scripts/issue-license.mjs --plan lifetime --id REV-2026-0001
 *   node scripts/issue-license.mjs --name 包仔 --plan lifetime
 *
 * 输出形如 BZP2.<payload>.<sig> 的激活码，粘贴到 设置 → 复习 → 授权。
 * 需要 scripts/keys/private.pem（gen-keys.mjs 生成）。
 *
 * 签名 = ECDSA P-256 + SHA-256，IEEE-P1363 裸格式（r||s 各 32 字节）。
 * ============================================================ */
import { createSign } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const keyPath = join(here, 'keys', 'private.pem');
if (!existsSync(keyPath)) {
  console.error('找不到 scripts/keys/private.pem —— 先跑 node scripts/gen-keys.mjs');
  process.exit(1);
}

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const name = arg('name');
const preset = arg('preset');

/* 预设（2026-11-22，与 bz Reader 同款）：群里发码最常用的两种，少手滑。
   `7d` / `30d` → 从签发时刻算死；`expired` → 昨天，用于演示与测试。 */
let presetDays = 0;
let presetExpired = false;
if (preset) {
  const m = /^(\d+)d$/.exec(preset);
  if (m) presetDays = Number(m[1]);
  else if (preset === 'expired') presetExpired = true;
  else {
    console.error(`--preset 只认 7d / 30d 这类天数，或 expired；收到 ${preset}`);
    process.exit(1);
  }
}

const days = Number(arg('days') || 0) || presetDays;
const until = arg('until');

/* 不给 --plan 时按参数推断：有截止日期才算短期码；预设按试用码签
   （`--days 365` 这种老用法仍记 year，行为不变）。
   2026-11-22 口径：试用码里不写版本——运行期要求「必须是最新版」。 */
let plan = arg('plan');
if (!plan) {
  const dated = days > 0 || !!until || presetExpired;
  plan = dated ? (presetDays > 0 || presetExpired ? 'trial' : 'year') : 'lifetime';
}
if (presetExpired && plan !== 'trial') {
  console.error('--preset expired 是试用码预设，不能配 --plan lifetime。');
  process.exit(1);
}
if (plan === 'trial' && !days && !until && !presetExpired) {
  console.error('试用码必须有截止日期：加 --days 7 或 --until YYYY-MM-DD（或 --preset 7d）。');
  process.exit(1);
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}
/* 试用码走独立号段 REV-TR-，不占付费码的连续序号 */
const prefix = plan === 'trial' ? 'REV-TR' : 'REV';
const id = arg('id') || `${prefix}-${stamp()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

let exp = 0;
if (presetExpired) {
  /* 昨天 23:59:59：签出来就是「已过期」，用来演示过期提示与做测试 */
  const d = new Date(Date.now() - 86_400_000);
  d.setHours(23, 59, 59, 0);
  exp = d.getTime();
} else if (until) exp = new Date(`${until}T23:59:59`).getTime();
else if (days > 0) exp = Date.now() + days * 86_400_000;
if (Number.isNaN(exp)) {
  console.error('--until 的日期看不懂，要 YYYY-MM-DD');
  process.exit(1);
}

const payload = {
  v: 2,
  id,
  ...(name ? { name } : {}),
  plan,
  ...(exp ? { exp } : {}),
};
const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf8');

function derToP1363(der) {
  if (der[0] !== 0x30) throw new Error('签名不是 DER SEQUENCE');
  let at = 2;
  const readInt = () => {
    if (der[at] !== 0x02) throw new Error('DER 里不是 INTEGER');
    const len = der[at + 1];
    const val = der.subarray(at + 2, at + 2 + len);
    at += 2 + len;
    const out = Buffer.alloc(32);
    let start = 0;
    while (start < val.length && val[start] === 0) start += 1;
    if (val.length - start > 32) throw new Error('INTEGER 比 32 字节还长');
    val.copy(out, 32 - (val.length - start), start);
    return out;
  };
  const r = readInt();
  const s = readInt();
  return Buffer.concat([r, s]);
}

const signer = createSign('sha256');
signer.update(payloadBytes);
const privateKeyPem = readFileSync(keyPath);
const der = signer.sign({ key: privateKeyPem, dsaEncoding: 'der' });
const sig = derToP1363(der);

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const code = `BZP2.${b64url(payloadBytes)}.${b64url(sig)}`;

console.log(code);
console.error(
  `--- ${name || '未署名'} · ${plan} · ${id} · ${exp ? new Date(exp).toLocaleDateString() : '永久'}${
    plan === 'trial' ? ' · 需保持最新版' : ''
  }`,
);
