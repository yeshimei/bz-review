import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSign } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  activateLicense,
  currentLicenseCode,
  isPaid,
  licenseRevoked,
  licenseSummary,
  refreshLicense,
} from '../src/data/entitlement';
import {
  _resetRevokedForTests,
  _setRevokedHttpForTests,
  clearRevoked,
  markRevoked,
  revokedCode,
} from '../src/data/revoked';

/* ============================================================
 * 停用名单 × 授权判定（tests/entitlement-revoked.test.ts）
 *
 * 与 Reader 的同名测试同构，三件事必须同时成立：
 *   1. 命中就降级——但**不删码**（解封要能自动恢复，误封也不用让人翻邮件）；
 *   2. 第一次激活必须联网核对，拉不到就明确拒绝，不悄悄放行；
 *   3. 本地已经判死的码，断网也贴不回来。
 *
 * Review 多一条自己的口径：**「没买」和「被封」要分得开**。两者都是基础版，
 * 但前者该引导购买，后者要告诉用户码被叫停了。
 * ============================================================ */

const here = dirname(fileURLToPath(import.meta.url));
const keyPath = join(here, '..', 'scripts', 'keys', 'private.pem');
const hasKey = existsSync(keyPath);
const keyPem = hasKey ? readFileSync(keyPath, 'utf8') : '';

const ID = 'REV-2026-0001';

const b64url = (buf: Buffer | Uint8Array): string =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

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

function issue(payload: object): string {
  const bytes = Buffer.from(JSON.stringify(payload), 'utf8');
  const signer = createSign('sha256');
  signer.update(bytes);
  const sig = derToP1363(signer.sign({ key: keyPem, dsaEncoding: 'der' }));
  return `BZP2.${b64url(bytes)}.${b64url(sig)}`;
}

function signed(ids: string[], updatedAt = 1_800_000_000_000): string {
  const text = [
    'bzr-revoked',
    '1',
    String(updatedAt),
    ids.map((x) => x.trim().toUpperCase()).sort().join(','),
    '',
  ].join('\n');
  const signer = createSign('sha256');
  signer.update(Buffer.from(text, 'utf8'));
  const sig = derToP1363(signer.sign({ key: keyPem, dsaEncoding: 'der' }));
  return JSON.stringify({ v: 1, updatedAt, ids, hashes: [], sig: b64url(sig) });
}

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  clear(): void {
    this.m.clear();
  }
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null;
  }
  get length(): number {
    return this.m.size;
  }
}

const g = globalThis as unknown as Record<string, unknown>;
let storage: MemoryStorage;

beforeAll(() => {
  storage = new MemoryStorage();
  g.window = globalThis;
  g.localStorage = storage;
});

afterAll(() => {
  delete g.localStorage;
});

beforeEach(async () => {
  storage.clear();
  _resetRevokedForTests();
  clearRevoked();
  await refreshLicense('');
});

describe.runIf(hasKey)('激活时核对', () => {
  it('命中的码：拒绝激活，不写授权状态', async () => {
    _setRevokedHttpForTests(async () => signed([ID]));
    const res = await activateLicense(issue({ v: 2, id: ID, plan: 'lifetime' }));
    expect(res.ok).toBe(false);
    expect(res.revoked).toBe(true);
    expect(res.message).toContain('停用');
    expect(currentLicenseCode()).toBe('');
    expect(isPaid()).toBe(false);
  });

  it('名单拉不到：拒绝并明确要求联网，不能悄悄放行', async () => {
    _setRevokedHttpForTests(async () => null);
    const res = await activateLicense(issue({ v: 2, id: 'REV-2026-0099', plan: 'lifetime' }));
    expect(res.ok).toBe(false);
    expect(res.revoked).toBeFalsy();
    expect(res.message).toContain('联网');
    expect(currentLicenseCode()).toBe('');
  });

  it('名单里没有这枚码：正常激活', async () => {
    _setRevokedHttpForTests(async () => signed(['REV-2026-0099']));
    const res = await activateLicense(issue({ v: 2, id: ID, plan: 'lifetime' }));
    expect(res.ok).toBe(true);
    expect(isPaid()).toBe(true);
    expect(currentLicenseCode()).not.toBe('');
    expect(revokedCode()).toBe('');
  });

  it('本地已判死的码：断网也贴不回来', async () => {
    const code = issue({ v: 2, id: ID, plan: 'lifetime' });
    markRevoked(code, 1_800_000_000_000);
    _setRevokedHttpForTests(async () => null);
    const res = await activateLicense(code);
    expect(res.ok).toBe(false);
    expect(res.revoked).toBe(true);
    expect(res.message).toContain('停用');
  });

  it('验签不过的码：不因为名单可用就被放过', async () => {
    _setRevokedHttpForTests(async () => signed([]));
    const res = await activateLicense('BZP2.bm90LWEtY29kZQ.c2ln');
    expect(res.ok).toBe(false);
    expect(isPaid()).toBe(false);
  });
});

describe.runIf(hasKey)('判定与恢复', () => {
  it('有码 + 命中：降为基础版，码保留，状态行报出停用', async () => {
    const code = issue({ v: 2, id: ID, name: '包仔', plan: 'lifetime' });
    await refreshLicense(code);
    expect(isPaid()).toBe(true);

    markRevoked(code, 1_800_000_000_000);
    expect(isPaid()).toBe(false);
    expect(licenseRevoked()).toBe(true);
    /* 码不删：解封后要能自动恢复，误封也不用让用户翻邮件 */
    expect(currentLicenseCode()).toBe(code);
    expect(licenseSummary()).toContain('停用');
  });

  it('解封：清掉本地标记后立刻回到高级版', async () => {
    const code = issue({ v: 2, id: ID, plan: 'lifetime' });
    await refreshLicense(code);
    markRevoked(code, 1_800_000_000_000);
    expect(isPaid()).toBe(false);

    clearRevoked();
    expect(isPaid()).toBe(true);
    expect(licenseRevoked()).toBe(false);
  });

  it('别的码命中不影响这一枚', async () => {
    const code = issue({ v: 2, id: ID, plan: 'lifetime' });
    await refreshLicense(code);
    markRevoked(issue({ v: 2, id: 'REV-2026-0099' }), 1_800_000_000_000);
    expect(isPaid()).toBe(true);
    expect(licenseRevoked()).toBe(false);
  });

  it('「没买」和「被封」分得开：状态行文案不同', async () => {
    await refreshLicense('');
    expect(licenseRevoked()).toBe(false);
    const noCode = licenseSummary();

    const code = issue({ v: 2, id: ID, plan: 'lifetime' });
    await refreshLicense(code);
    markRevoked(code, 1_800_000_000_000);
    const revoked = licenseSummary();

    expect(noCode).not.toBe(revoked);
    expect(noCode).not.toContain('停用');
    expect(revoked).toContain('停用');
  });

  it('老码没有码号：按摘要命中后同样降级，不误伤别的码', async () => {
    const code = issue({ v: 1, name: '老用户' });
    await refreshLicense(code);
    expect(isPaid()).toBe(true);
    markRevoked(code, 1_800_000_000_000);
    expect(isPaid()).toBe(false);
    expect(licenseRevoked()).toBe(true);
  });
});
