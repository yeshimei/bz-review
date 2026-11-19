#!/usr/bin/env node
/* ============================================================
 * gen-keys.mjs —— 生成 Review（复习）的发行密钥对
 *
 *   node scripts/gen-keys.mjs
 *
 * 产出 scripts/keys/：
 *   private.pem       PKCS8 私钥（issue-license.mjs 用，绝不进 git）
 *   public-spki.b64   SPKI DER 的 base64（粘进 src/data/license.ts 的 PUBKEY_SPKI_B64）
 * ============================================================ */
import { generateKeyPairSync, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const keysDir = join(here, 'keys');

if (existsSync(join(keysDir, 'private.pem'))) {
  const pub = readFileSync(join(keysDir, 'public-spki.b64'), 'utf8').trim();
  const fp = createHash('sha256').update(Buffer.from(pub, 'base64')).digest('hex').slice(0, 16);
  console.error('scripts/keys/private.pem 已存在，不覆盖（覆盖会让所有已发激活码作废）。');
  console.error(`当前公钥指纹 ${fp}…`);
  process.exit(1);
}
/* 私钥丢了但公钥还在：不能静默生成新对——新私钥配旧公钥，签出来的码验不过。
   明确报错，让人先决定是恢复私钥还是连同公钥一起重置（后者会让旧码作废）。 */
if (existsSync(join(keysDir, 'public-spki.b64'))) {
  console.error('检测到 public-spki.b64 存在但 private.pem 缺失：');
  console.error('请先恢复原私钥；若确实要重置，删除 public-spki.b64 再重跑（已发激活码会全部作废）。');
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

mkdirSync(keysDir, { recursive: true });
/* mode 0o600：类 Unix 上私钥默认 0644 会被同机其他用户读走，这里收紧到仅属主可读写。
   flag 'wx'：独占创建，万一并发重跑也不会覆盖已存在的私钥。 */
writeFileSync(join(keysDir, 'private.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
const spkiB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
writeFileSync(join(keysDir, 'public-spki.b64'), spkiB64 + '\n');
writeFileSync(join(keysDir, 'README.txt'), [
  '这个目录是发行密钥，private.pem 泄露 = 任何人都能自己签激活码。',
  'private.pem 不进 git（.gitignore 已配），备份到密码管理器或离线介质。',
  'public-spki.b64 的内容粘进 src/data/license.ts 的 PUBKEY_SPKI_B64。',
].join('\n'));

const fp = createHash('sha256').update(Buffer.from(spkiB64, 'base64')).digest('hex').slice(0, 16);
console.log('✓ 密钥对已生成：scripts/keys/');
console.log(`  公钥指纹 ${fp}…`);
console.log('  下一步：把 public-spki.b64 的内容粘进 src/data/license.ts');
