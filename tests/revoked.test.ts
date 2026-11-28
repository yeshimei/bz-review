import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REVOKED_STATE_KEY,
  _resetRevokedForTests,
  _setRevokedHttpForTests,
  checkRevoked,
  clearRevoked,
  codeHash,
  markRevoked,
  parseRevoked,
  refreshRevoked,
  revokedCode,
  revokedSeenAt,
  revokedSignText,
  verifyRevoked,
} from '../src/data/revoked';

/* ============================================================
 * 停用名单（tests/revoked.test.ts）
 *
 * 与 bz Reader 的 tests/revoked.test.ts 同构，多盯一件事：
 * **名单要同时认两种码号**——`REV-*`（Review 自己发的）和 `BZR-*`
 * （赞助人码，Reader 也能激活）。少认一种就等于那一半封不掉。
 *
 * 这一份盯四件事：
 *   1. 名单是公开文件，**只认码号 / 摘要**，不认码原文；
 *   2. 必须验签——假名单、改过的名单、旧名单一律当「没拉到」；
 *   3. 拉不到 = 放行（unknown），不能被网络故障误伤；
 *   4. 命中之后本地要记住，断网重启也贴不回来；解封要能自动恢复。
 * 真实通道走真机，网络函数全部注入。
 * ============================================================ */

const here = dirname(fileURLToPath(import.meta.url));
const keyPath = join(here, '..', 'scripts', 'keys', 'private.pem');
const hasKey = existsSync(keyPath);
const keyPem = hasKey ? readFileSync(keyPath, 'utf8') : '';

const embeds = readFileSync(join(here, '..', 'src', 'data', 'license.ts'), 'utf8');
const PUB = /PUBKEY_SPKI_B64 =\s*'([^']+)'/;

/** 测试里用的两种码号，各取一枚 */
const OWN_ID = 'REV-2026-0001';
const SPONSOR_ID = 'BZR-AF-2026-0021';

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

/** 按生产端同样的格式签一份名单 */
function signed(
  ids: string[],
  hashes: string[] = [],
  updatedAt = 1_800_000_000_000,
  key = keyPem,
): string {
  const text = [
    'bzr-revoked',
    '1',
    String(updatedAt),
    ids.map((x) => x.trim().toUpperCase()).sort().join(','),
    hashes.map((x) => x.trim().toLowerCase()).sort().join(','),
  ].join('\n');
  const signer = createSign('sha256');
  signer.update(Buffer.from(text, 'utf8'));
  const sig = derToP1363(signer.sign({ key, dsaEncoding: 'der' }));
  return JSON.stringify({ v: 1, updatedAt, ids, hashes, sig: b64url(sig) });
}

/** 签一枚真码（复用 Review 的发行方私钥） */
function issue(payload: object): string {
  const bytes = Buffer.from(JSON.stringify(payload), 'utf8');
  const signer = createSign('sha256');
  signer.update(bytes);
  const sig = derToP1363(signer.sign({ key: keyPem, dsaEncoding: 'der' }));
  return `BZP2.${b64url(bytes)}.${b64url(sig)}`;
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

function setHttp(fn: (url: string) => string | null | Promise<string | null>): void {
  _setRevokedHttpForTests(async (url) => await fn(url));
}

beforeEach(() => {
  storage.clear();
  _resetRevokedForTests();
});

describe('名单解析', () => {
  it('合法名单原样收下', () => {
    const doc = parseRevoked(signed([OWN_ID]));
    expect(doc?.ids).toEqual([OWN_ID]);
    expect(doc?.updatedAt).toBe(1_800_000_000_000);
    expect(doc?.sig).toBeTruthy();
  });

  it('空数组合法（还没人被封）', () => {
    const doc = parseRevoked(signed([]));
    expect(doc?.ids).toEqual([]);
    expect(doc?.hashes).toEqual([]);
  });

  it('结构不对整份作废', () => {
    expect(parseRevoked('不是 JSON')).toBeNull();
    expect(parseRevoked('[]')).toBeNull();
    expect(parseRevoked(JSON.stringify({ v: 2, updatedAt: 1, ids: [], hashes: [], sig: 'x' }))).toBeNull();
    expect(parseRevoked(JSON.stringify({ v: 1, updatedAt: 0, ids: [], hashes: [], sig: 'x' }))).toBeNull();
    expect(parseRevoked(JSON.stringify({ v: 1, updatedAt: 1, ids: [], hashes: [] }))).toBeNull();
  });

  it('单条坏只丢那一条，码号统一大写、摘要统一小写', () => {
    const raw = JSON.stringify({
      v: 1,
      updatedAt: 1_800_000_000_000,
      ids: ['rev-2026-0001', 'not-a-code', 'REV-2026-0001'],
      hashes: ['ABCDEF0123456789', 'xyz', 'abcdef0123456789'],
      sig: 'x',
    });
    const doc = parseRevoked(raw);
    expect(doc?.ids).toEqual(['REV-2026-0001']);
    expect(doc?.hashes).toEqual(['abcdef0123456789']);
  });
});

describe('两种码号都认', () => {
  /* Review 能激活两类码，名单就得同时写两类号：
     REV-* 是它自己发的，BZR-* 是赞助人 / 专属定制码（Reader 也能激活）。
     只认 REV-* 的话，赞助人码在 Review 里就封不掉——而那是唯一一种
     「一枚码两插件通用」的码，也恰恰是最需要两边都封的。 */
  it('REV- 与 BZR- 都收下', () => {
    const raw = JSON.stringify({
      v: 1,
      updatedAt: 1_800_000_000_000,
      ids: [OWN_ID, SPONSOR_ID],
      hashes: [],
      sig: 'x',
    });
    expect(parseRevoked(raw)?.ids).toEqual([OWN_ID, SPONSOR_ID]);
  });

  it('别的前缀不收（BZP- / 纯数字 / 太短）', () => {
    const raw = JSON.stringify({
      v: 1,
      updatedAt: 1_800_000_000_000,
      ids: ['BZP-2026-0001', '2026-0001', 'REV-1', 'REV-2026-0001'],
      hashes: [],
      sig: 'x',
    });
    expect(parseRevoked(raw)?.ids).toEqual(['REV-2026-0001']);
  });
});

describe('签名串', () => {
  it('固定格式，数组顺序无关', () => {
    const a = revokedSignText({ v: 1, updatedAt: 123, ids: ['B', 'A'], hashes: ['y', 'x'] });
    const b = revokedSignText({ v: 1, updatedAt: 123, ids: ['A', 'B'], hashes: ['x', 'y'] });
    expect(a).toBe(b);
    expect(a).toBe('bzr-revoked\n1\n123\nA,B\nx,y');
  });
});

describe.runIf(hasKey && PUB.test(embeds))('验签', () => {
  it('真签名的名单通过', async () => {
    const doc = parseRevoked(signed([OWN_ID]));
    expect(doc).toBeTruthy();
    expect(await verifyRevoked(doc!)).toBe(true);
  });

  it('改过码号的名单不通过', async () => {
    const doc = parseRevoked(signed([OWN_ID]));
    expect(doc).toBeTruthy();
    doc!.ids = ['REV-2026-0099'];
    expect(await verifyRevoked(doc!)).toBe(false);
  });

  it('别的私钥签的名单不通过', async () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const other = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    const doc = parseRevoked(signed([OWN_ID], [], 1_800_000_000_000, other));
    expect(await verifyRevoked(doc!)).toBe(false);
  });
});

describe.runIf(hasKey && PUB.test(embeds))('仓库里的名单', () => {
  /* 这道断言盯的是「作者改完名单忘了重签」和「签发脚本与插件端的签名串
     不一致」——两者都会让所有人拉到的名单验签失败，而表现只是「封码没生效」，
     很难从现场看出来。 */
  it('docs/revoked.json 当前签名有效', async () => {
    const raw = readFileSync(join(here, '..', 'docs', 'revoked.json'), 'utf8');
    const doc = parseRevoked(raw);
    expect(doc).toBeTruthy();
    expect(await verifyRevoked(doc!)).toBe(true);
  });
});

describe.runIf(hasKey)('判定', () => {
  /* 在 it 里现签，别在 describe 回调顶层签：runIf 不满足时回调仍会被收集一遍，
     而 worktree 里 scripts/keys 是 gitignore 的，顶层调用会直接炸在收集期。 */
  let CODE = '';
  beforeAll(() => {
    CODE = issue({ v: 2, id: OWN_ID, name: '包仔', plan: 'lifetime' });
  });

  it('命中码号：hit，本地记住这枚码', async () => {
    setHttp(() => signed([OWN_ID]));
    expect(await checkRevoked(CODE)).toBe('hit');
    expect(revokedCode()).toBe(CODE);
  });

  it('大小写不同也算命中', async () => {
    setHttp(() => signed(['rev-2026-0001']));
    expect(await checkRevoked(CODE)).toBe('hit');
  });

  it('名单里没有：clear，且不动本地', async () => {
    setHttp(() => signed(['REV-2026-0099']));
    expect(await checkRevoked(CODE)).toBe('clear');
    expect(revokedCode()).toBe('');
  });

  it('两个源都挂：unknown（放行）', async () => {
    setHttp(() => null);
    expect(await checkRevoked(CODE)).toBe('unknown');
    expect(revokedCode()).toBe('');
  });

  it('假签名：unknown，不能把付费用户打回基础版', async () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const other = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    setHttp(() => signed([OWN_ID], [], 1_800_000_000_000, other));
    expect(await checkRevoked(CODE)).toBe('unknown');
  });

  it('旧名单：unknown（防重放，别让已封的码复活）', async () => {
    markRevoked(CODE, 1_900_000_000_000);
    setHttp(() => signed(['REV-2026-0099'], [], 1_800_000_000_000));
    expect(await checkRevoked(CODE)).toBe('unknown');
    expect(revokedCode()).toBe(CODE);
  });

  it('解封：名单里没了就清本地标记', async () => {
    markRevoked(CODE, 1_800_000_000_000);
    setHttp(() => signed([], [], 1_900_000_000_000));
    expect(await checkRevoked(CODE)).toBe('clear');
    expect(revokedCode()).toBe('');
  });

  it('同一版本再拉一次仍然判定（不能当成旧名单丢掉）', async () => {
    setHttp(() => signed([OWN_ID], [], 1_800_000_000_000));
    expect(await checkRevoked(CODE)).toBe('hit');
    expect(await checkRevoked(CODE)).toBe('hit');
  });

  it('老码没有码号：按 sha256 摘要封', async () => {
    const old = issue({ v: 1, name: '老用户' });
    const h = await codeHash(old);
    setHttp(() => signed([], [h]));
    expect(await checkRevoked(old)).toBe('hit');
    expect(revokedCode()).toBe(old);
  });

  it('老码：摘要对不上就不算命中', async () => {
    const old = issue({ v: 1, name: '老用户' });
    setHttp(() => signed([], ['0123456789abcdef']));
    expect(await checkRevoked(old)).toBe('clear');
  });
});

describe.runIf(hasKey)('后台刷新与持久化', () => {
  let CODE = '';
  beforeAll(() => {
    CODE = issue({ v: 2, id: OWN_ID, plan: 'lifetime' });
  });

  it('24 小时内不重复；force 每次真拉', async () => {
    let n = 0;
    setHttp(() => {
      n += 1;
      return signed(['REV-2026-0099']);
    });
    // 每份名单会被两个源各取一次
    expect(await refreshRevoked(CODE, { force: true })).toBe('clear');
    expect(n).toBe(2);
    // 24 小时内再自动查：不请求，直接 skipped（不是失败）
    expect(await refreshRevoked(CODE)).toBe('skipped');
    expect(n).toBe(2);
    // 手动核对（force）绕过 24 小时
    expect(await refreshRevoked(CODE, { force: true })).toBe('clear');
    expect(n).toBe(4);
  });

  it('拉不到不算核对成功：下一次启动还会试', async () => {
    setHttp(() => null);
    expect(await refreshRevoked(CODE)).toBe('unknown');
    setHttp(() => signed(['REV-2026-0099']));
    // 上一次没写 checkedAt，所以这次不会被 24 小时节流挡掉
    expect(await refreshRevoked(CODE)).toBe('clear');
  });

  it('本地状态写进 localStorage，重建缓存后还在', async () => {
    markRevoked(CODE, 1_800_000_000_000);
    expect(storage.getItem(REVOKED_STATE_KEY)).toContain('BZP2.');
    _resetRevokedForTests();
    expect(revokedCode()).toBe(CODE);
    expect(revokedSeenAt()).toBe(1_800_000_000_000);
    clearRevoked();
    _resetRevokedForTests();
    expect(revokedCode()).toBe('');
    // 版本号不清：解封后也不能拿旧名单回放
    expect(revokedSeenAt()).toBe(1_800_000_000_000);
  });

  /* 2026-11-28 审计：`now - checkedAt` 为负数时恒小于 24 小时，
     一次「把系统时间调到未来」就能让撤销名单永远不再核对。 */
  it('本地核对时刻在未来：不能当成「刚查过」，照常拉一次', async () => {
    storage.setItem(
      REVOKED_STATE_KEY,
      JSON.stringify({ code: '', at: 0, checkedAt: Date.now() + 400 * 86_400_000, deadAt: 0 }),
    );
    _resetRevokedForTests();

    let n = 0;
    setHttp(() => {
      n += 1;
      return signed([], [], 1_800_000_000_000);
    });

    expect(await refreshRevoked(CODE)).toBe('clear');
    expect(n).toBe(2);
  });
});
