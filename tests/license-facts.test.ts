import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSign } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  activateLicense,
  licenseFacts,
  refreshLicense,
  setLicenseFailHistory,
  setLicenseFactsHook,
} from '../src/data/entitlement';
import {
  _resetRevokedForTests,
  _setRevokedHttpForTests,
  clearRevoked,
  markRevoked,
  revokedDeadAt,
} from '../src/data/revoked';

/* ============================================================
 * 授权事实（tests/license-facts.test.ts）
 *
 * 这几样是给 bz 的探针读的，写错了看板会直接歪，所以要钉住：
 *   1. 「没核对过」不能写成「核对过没事」（false 与缺省是两回事）；
 *   2. 「现在是基础版」要分得出没买 / 到期 / 被封 / 码坏了；
 *   3. 激活失败只记分类，**绝不记码原文**；
 *   4. 激活成功要把失败历史清掉，别让一次手滑挂一辈子。
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
  setLicenseFailHistory(undefined, 0);
  setLicenseFactsHook(null);
  await refreshLicense('');
});

describe('licenseFacts · 档位成因', () => {
  it('没码 → none，且不带 revoked 键', () => {
    const f = licenseFacts();
    expect(f.tierReason).toBe('none');
    expect('revoked' in f).toBe(false);
  });

  it('有码、名单核对过、没有它 → ok + revoked=false', async () => {
    const code = issue({ v: 2, id: ID, plan: 'lifetime' });
    await refreshLicense(code);
    /* 名单里是别的号，不是这一枚 */
    _setRevokedHttpForTests(async () => signed(['REV-2026-0099']));
    // 走一次真核对：只有核对成功过，false 才代表「查了没事」
    const { checkRevoked } = await import('../src/data/revoked');
    await checkRevoked(code, 1);
    const f = licenseFacts();
    expect(f.tierReason).toBe('ok');
    expect(f.revoked).toBe(false);
  });

  it('从没核对过 → 不带 revoked 键（不能拿 false 冒充「查了没事」）', async () => {
    const code = issue({ v: 2, id: ID, plan: 'lifetime' });
    await refreshLicense(code);
    const f = licenseFacts();
    expect(f.tierReason).toBe('ok');
    expect('revoked' in f).toBe(false);
  });

  it('命中停用 → revoked=true + 判死时刻 + tierReason=revoked', async () => {
    const code = issue({ v: 2, id: ID, plan: 'lifetime' });
    await refreshLicense(code);
    markRevoked(code, 1_800_000_000_000);
    const f = licenseFacts();
    expect(f.revoked).toBe(true);
    expect(f.tierReason).toBe('revoked');
    expect(f.revokedAt).toBe(revokedDeadAt());
    expect(f.revokedAt).toBeGreaterThan(0);
  });

  it('过期码 → expired（不是 revoked，也不是 invalid）', async () => {
    const code = issue({ v: 2, id: ID, plan: 'lifetime', exp: Date.now() - 86_400_000 });
    await refreshLicense(code);
    expect(licenseFacts().tierReason).toBe('expired');
  });

  it('解不开的码 → invalid', async () => {
    await refreshLicense('BZP2.bm90LWEtY29kZQ.c2ln');
    expect(licenseFacts().tierReason).toBe('invalid');
  });

  it('判死时刻只认第一次：同一枚码再判一次不刷新', async () => {
    const code = issue({ v: 2, id: ID, plan: 'lifetime' });
    await refreshLicense(code);
    markRevoked(code, 1_800_000_000_000);
    const first = revokedDeadAt();
    markRevoked(code, 1_900_000_000_000);
    expect(revokedDeadAt()).toBe(first);
  });
});

describe.runIf(hasKey)('licenseFacts · 激活失败', () => {
  it('格式不对 → format，并记下时刻', async () => {
    const res = await activateLicense('这不是一个码');
    expect(res.ok).toBe(false);
    expect(res.fail).toBe('format');
    const f = licenseFacts();
    expect(f.activateFail).toBe('format');
    expect(f.activateFailAt).toBeGreaterThan(0);
  });

  it('拉不到名单 → offline（不是「码无效」）', async () => {
    _setRevokedHttpForTests(async () => null);
    const res = await activateLicense(issue({ v: 2, id: 'REV-2026-0099', plan: 'lifetime' }));
    expect(res.ok).toBe(false);
    expect(res.fail).toBe('offline');
    expect(licenseFacts().activateFail).toBe('offline');
  });

  it('命中停用 → revoked', async () => {
    _setRevokedHttpForTests(async () => signed([ID]));
    const res = await activateLicense(issue({ v: 2, id: ID, plan: 'lifetime' }));
    expect(res.ok).toBe(false);
    expect(res.fail).toBe('revoked');
    expect(licenseFacts().activateFail).toBe('revoked');
  });

  it('激活成功一次 → 清掉失败历史', async () => {
    await activateLicense('垃圾');
    expect(licenseFacts().activateFail).toBe('format');

    _setRevokedHttpForTests(async () => signed([]));
    const ok = await activateLicense(issue({ v: 2, id: 'REV-2026-0099', plan: 'lifetime' }));
    expect(ok.ok).toBe(true);
    const f = licenseFacts();
    expect('activateFail' in f).toBe(false);
    expect('activateFailAt' in f).toBe(false);
  });

  it('失败历史能重启后灌回来（不然重启一次就看不出来了）', async () => {
    setLicenseFailHistory('offline', 1_800_000_000_000);
    const f = licenseFacts();
    expect(f.activateFail).toBe('offline');
    expect(f.activateFailAt).toBe(1_800_000_000_000);
  });

  it('失败历史里不带码原文（只可能是那五个枚举值）', async () => {
    await activateLicense('BZP2.eyJ2IjoyfQ.c2ln');
    const json = JSON.stringify(licenseFacts());
    expect(json).not.toContain('BZP2.');
    expect(json).not.toContain('eyJ2IjoyfQ');
  });

  it('状态一变就通知落盘（main.ts 靠这条把事实写进 data.json）', async () => {
    let calls = 0;
    setLicenseFactsHook(() => {
      calls += 1;
    });
    await activateLicense('垃圾');
    expect(calls).toBeGreaterThan(0);
  });
});
