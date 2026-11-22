#!/usr/bin/env node
/* ============================================================
 * revoke-license.mjs —— 停用 / 恢复一枚 bz Review 激活码
 *
 *   node scripts/revoke-license.mjs --init
 *   node scripts/revoke-license.mjs --id REV-2026-0001
 *   node scripts/revoke-license.mjs --unrevoke REV-2026-0001
 *   node scripts/revoke-license.mjs --code "BZP2...."     # 老码（没有码号）
 *   node scripts/revoke-license.mjs --list
 *
 * 改的是 docs/revoked.json：公开文件，**只写码号 / 摘要，不写码原文**。
 * 改完用 Review 自己的私钥重签，再自己 push（GitHub + 码云两条通道都要到，
 * 少一条就会有一半用户拉不到名单）。
 *
 * ── 赞助人码要封两次（2026-11-22 定） ────────────────────────────
 * `BZR-AF-2026-xxxx` 这种赞助人 / 专属定制码一枚能在 Reader 和 Review
 * 两个插件都激活。两款插件的名单各读各的，所以**封它必须两边各跑一次**：
 *
 *   cd D:\Obsidian\bz-reader  && node scripts/revoke-license.mjs --id BZR-AF-2026-0017
 *   cd D:\Obsidian\bz-review  && node scripts/revoke-license.mjs --id BZR-AF-2026-0017
 *
 * 只封一边不是「封了一半」，是「看起来封了、另一个插件照常用」——比不封更糟。
 * 这个脚本封 `BZR-` 开头的号时会明确提醒。
 *
 * 几条硬规矩：
 *   · 码号必须在对的台账里出现过——手滑打错一个字符，名单里就会多一条
 *     永远命不中的死记录，而且看起来像封对了。`REV-` 查本仓台账，
 *     `BZR-` 查 bz-reader 的台账（赞助人码记在那边）。
 *   · 同一码号在台账里出现多次 = 签过两枚码，封一个号会一起封掉，
 *     直接拒绝并让你先查清。
 *   · `updatedAt` 只增不减：插件拿它防重放，回退版本会让已封的码复活。
 * ============================================================ */
import { createHash, createSign } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const listPath = join(root, 'docs', 'revoked.json');
const keyPath = join(here, 'keys', 'private.pem');
const ledgerPath = join(here, 'keys', 'issued', 'ledger.json');

/** 赞助人码记在 bz-reader 仓库；两个仓库通常并排在同一个目录下 */
const PEER_LEDGER_CANDIDATES = [
  process.env.BZ_PEER_LEDGER,
  join(root, '..', 'bz-reader', 'scripts', 'keys', 'issued', 'ledger.json'),
].filter(Boolean);

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const flag = (name) => args.includes(`--${name}`);

/** 两种码号：Review 自己发的 REV-*，以及跨插件通用的赞助人码 BZR-* */
const ID_RE = /^(BZR|REV)-[A-Z0-9][A-Z0-9-]{2,39}$/;

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function warn(msg) {
  console.error(`! ${msg}`);
}

/** DER 签名（SEQUENCE{r,s}）→ IEEE-P1363 裸 r||s；与 issue-license.mjs 同一转换 */
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

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** 签名串必须与 src/data/revoked.ts 的 revokedSignText 一字不差 */
function signText(doc) {
  const ids = [...doc.ids].map((x) => x.trim().toUpperCase()).sort();
  const hashes = [...doc.hashes].map((x) => x.trim().toLowerCase()).sort();
  return ['bzr-revoked', String(doc.v), String(doc.updatedAt), ids.join(','), hashes.join(',')].join('\n');
}

function sign(doc) {
  if (!existsSync(keyPath)) fail('找不到 scripts/keys/private.pem —— 没有私钥签不了名单');
  const signer = createSign('sha256');
  signer.update(Buffer.from(signText(doc), 'utf8'));
  return b64url(derToP1363(signer.sign({ key: readFileSync(keyPath), dsaEncoding: 'der' })));
}

function readList() {
  if (!existsSync(listPath)) return { v: 1, updatedAt: 0, ids: [], hashes: [] };
  let raw;
  try {
    raw = JSON.parse(readFileSync(listPath, 'utf8'));
  } catch {
    fail('docs/revoked.json 不是合法 JSON —— 先备份再修，别直接覆盖');
  }
  return {
    v: 1,
    updatedAt: Number(raw?.updatedAt) || 0,
    ids: Array.isArray(raw?.ids) ? raw.ids.filter((x) => typeof x === 'string') : [],
    hashes: Array.isArray(raw?.hashes) ? raw.hashes.filter((x) => typeof x === 'string') : [],
  };
}

/** 台账里每个码号出现几次；读不到返回 null（脚本仍可跑，只是少了这道校验） */
function ledgerCounts(path) {
  if (!path || !existsSync(path)) return null;
  try {
    const doc = JSON.parse(readFileSync(path, 'utf8'));
    const out = new Map();
    for (const batch of doc.batches || []) {
      for (const c of batch.codes || []) {
        if (typeof c.id !== 'string') continue;
        const id = c.id.trim().toUpperCase();
        out.set(id, (out.get(id) || 0) + 1);
      }
    }
    return out;
  } catch {
    return null;
  }
}

/** 本仓台账（REV-*）与 Reader 台账（BZR-*）各读一份：码号属于哪个产品，就去哪边查 */
const ownCounts = ledgerCounts(ledgerPath);
const peerPath = PEER_LEDGER_CANDIDATES.find((p) => existsSync(p)) || '';
const peerCounts = ledgerCounts(peerPath);

function writeList(list) {
  list.updatedAt = Math.max(Date.now(), list.updatedAt + 1);
  const doc = {
    v: 1,
    updatedAt: list.updatedAt,
    ids: [...list.ids].map((x) => x.trim().toUpperCase()).sort(),
    hashes: [...list.hashes].map((x) => x.trim().toLowerCase()).sort(),
    sig: sign(list),
  };
  writeFileSync(listPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  return doc;
}

function summary(list) {
  console.log(`  停用码号 ${list.ids.length} 枚，摘要 ${list.hashes.length} 条`);
  console.log(`  版本 ${list.updatedAt}`);
  console.log('  下一步：');
  console.log('    git add docs/revoked.json && git commit -m "chore(license): 停用名单" && git push');
  console.log('    node scripts/push-gitee.mjs         # 码云镜像，两条通道都要到');
}

/**
 * 赞助人码的额外提醒。封 `BZR-` 号 = 封一枚跨两个插件通用的码，
 * 只封本仓这一半，Reader 那边照常用——这条提醒就是防这个。
 */
function peerReminder(id) {
  if (!id.startsWith('BZR-')) return;
  console.log('');
  console.log(`! ${id} 是赞助人码，Reader 也能激活这枚码。`);
  console.log('  封它必须两边各封一次，否则 Reader 那边照常是高级版：');
  console.log(`    cd ..\\bz-reader && node scripts/revoke-license.mjs --id ${id}`);
  console.log('  改完两边各自 commit + push，两边名单都要到 GitHub 和码云。');
}

/* ── 入口 ─────────────────────────────────────────────────── */

const list = readList();

if (flag('init')) {
  const doc = writeList(list);
  console.log(`✓ 已生成 docs/revoked.json（空名单，版本 ${doc.updatedAt}）`);
  summary(list);
  process.exit(0);
}

if (flag('list') || args.length === 0) {
  console.log('docs/revoked.json');
  console.log(`  版本 ${list.updatedAt || '（还没生成）'}`);
  console.log(`  码号：${list.ids.length ? list.ids.join(', ') : '（无）'}`);
  console.log(`  摘要：${list.hashes.length ? list.hashes.join(', ') : '（无）'}`);
  if (args.length === 0) {
    console.log('\n用法：--init | --id <码号> | --unrevoke <码号> | --code <激活码> | --list');
  }
  process.exit(0);
}

const id = (arg('id') || '').trim().toUpperCase();
const un = (arg('unrevoke') || '').trim().toUpperCase();
const code = (arg('code') || '').trim();

if (id && un) fail('--id 与 --unrevoke 不能同时用');
if (!id && !un && !code) fail('要么 --id / --unrevoke 一个码号，要么 --code 一枚老码');

let changed = false;

if (id) {
  if (!ID_RE.test(id)) fail(`码号格式不对：${id}（应为 REV-2026-0001 或 BZR-AF-2026-0001）`);

  /* 码号属于哪个产品，就去哪边的台账查：REV-* 在本仓，BZR-* 在 Reader 仓。
     查错边会把真码报成「台账里没有」，那条提示会把人带偏。 */
  const sponsor = id.startsWith('BZR-');
  const counts = sponsor ? peerCounts : ownCounts;
  const where = sponsor ? (peerPath || 'bz-reader 的台账（没找到）') : ledgerPath;
  if (!counts) {
    warn(`读不到台账（${where}），跳过「码号是否存在」校验`);
  } else {
    const n = counts.get(id) || 0;
    if (n === 0) {
      fail(
        sponsor
          ? `bz-reader 台账里没有 ${id} —— 赞助人码记在那边，确认是不是打错了`
          : `台账里没有 ${id} —— 确认是不是打错了`,
      );
    }
    if (n > 1) fail(`${id} 在台账里出现 ${n} 次（同一码号签过多枚码），封一个会一起封掉，先查清`);
  }
  if (list.ids.includes(id)) fail(`${id} 已经在名单里了`);
  list.ids.push(id);
  changed = true;
}

if (un) {
  const i = list.ids.indexOf(un);
  if (i < 0) fail(`${un} 不在名单里`);
  list.ids.splice(i, 1);
  console.log(`✓ 已解封 ${un}（下次插件启动会拉到新名单，自动恢复）`);
  changed = true;
}

if (code) {
  if (!/^BZ[PR][12]\./.test(code)) fail('--code 要完整的激活码（BZP1 / BZP2 / BZR1 / BZR2 开头）');
  /* 与插件端 codeHash 同口径：sha256(trim 后的码) 的十六进制前 16 位 */
  const hash = createHash('sha256').update(code).digest('hex').slice(0, 16);
  if (list.hashes.includes(hash)) fail(`这枚码的摘要 ${hash} 已经在名单里了`);
  list.hashes.push(hash);
  console.log(`✓ 已停用一枚老码（摘要 ${hash}）`);
  changed = true;
}

if (id) {
  console.log(`✓ 已停用 ${id}`);
  /* 回显一眼，让人在按回车之前确认封的是这一枚：封错号脚本拦不住，
     最便宜的防线是把「你封了谁」摆在眼前 */
  if (ownCounts?.has(id) || peerCounts?.has(id)) console.log(`  （${id} 在台账里，是发出去的真码）`);
  peerReminder(id);
}

if (!changed) fail('什么都没改');

writeList(list);
console.log('✓ docs/revoked.json 已重签');
summary(list);
