import { describe, expect, it, afterEach } from 'vitest';
import { parseLicense, verifyLicense } from '../src/data/license';
import { HAS_KEYS, HAS_READER_KEYS, signCode, signReaderCode } from './helpers/sign';

describe.runIf(HAS_KEYS)('激活码验签', () => {
  it('自己签的码能验通过，并带回署名与方案', async () => {
    const code = signCode({ id: 'REV-2026-0001', name: '包仔', plan: 'lifetime' });
    const r = await verifyLicense(code);
    expect(r.ok).toBe(true);
    expect(r.payload?.name).toBe('包仔');
    expect(r.payload?.plan).toBe('lifetime');
  });

  it('payload 改一个字符就验不过', async () => {
    const code = signCode({ id: 'REV-2026-0002', name: '甲' });
    const [p, body, sig] = code.split('.');
    /* 改 payload 中段的字符：base64 末位可能落在填充位上，改那里解码后字节不变，
       测不出「内容被改」。中段一位一定改到真实字节。 */
    const mid = Math.floor(body.length / 2);
    const tampered = `${p}.${body.slice(0, mid)}${body[mid] === 'A' ? 'B' : 'A'}${body.slice(mid + 1)}.${sig}`;
    const r = await verifyLicense(tampered);
    expect(r.ok).toBe(false);
    /* 改到 JSON 文本会先被格式检查拦下（format），改到别的字节则到验签（invalid）——
       两条都算「不认这枚码」，不锁死具体是哪一个环节。 */
    expect(['format', 'invalid']).toContain(r.reason);
  });

  it('过期的码被拦下，并说清是哪天过期', async () => {
    const code = signCode({ id: 'REV-2026-0003', exp: Date.now() - 86_400_000 });
    const r = await verifyLicense(code);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('expired');
    expect(r.message).toMatch(/过期/);
  });

  it('前缀不对（拿了别的插件的码）按格式错处理', async () => {
    const foreign = signCode({ id: 'X' }, 'BZX2');
    const r = await verifyLicense(foreign);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('format');
  });

  it('空码不报错，只提示还没填', async () => {
    const r = await verifyLicense('   ');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('empty');
  });
});

/* 跨产品通用码：Reader 私钥签的赞助人 / 专属定制码（patron: true）
   在 Review 也能激活；它自己卖的普通高级版码仍只在 Reader 有效。 */
describe.runIf(HAS_READER_KEYS)('Reader 的赞助人与专属定制码', () => {
  it('patron 码验得过，署名和标记都带回来', async () => {
    const code = signReaderCode({
      id: 'BZR-AF-2026-0176',
      name: 'Pomodorinettina',
      patron: true,
      plan: 'lifetime',
    });
    const r = await verifyLicense(code);
    expect(r.ok).toBe(true);
    expect(r.payload?.patron).toBe(true);
    expect(r.payload?.name).toBe('Pomodorinettina');
  });

  it('Reader 的普通高级版码（无 patron）不认，提示各自激活', async () => {
    const code = signReaderCode({ id: 'BZR-AF-2026-0001', plan: 'lifetime' });
    const r = await verifyLicense(code);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('scope');
    expect(r.message).toMatch(/赞助人|专属定制/);
  });

  it('Reader 签的码改成 BZP2 前缀也过不了（公钥跟着前缀走）', async () => {
    const code = signReaderCode(
      { id: 'BZR-AF-2026-0176', name: '甲', patron: true, plan: 'lifetime' },
      'BZP2',
    );
    const r = await verifyLicense(code);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('invalid');
  });
});

describe('parseLicense', () => {
  it('三段式才认，段数不对直接 null', () => {
    expect(parseLicense('BZP2.aaa')).toBeNull();
    expect(parseLicense('BZP2.aaa.bbb.ccc')).toBeNull();
  });

  it('Reader 前缀也解析得出，并记下来自哪个插件', () => {
    const body = Buffer.from(JSON.stringify({ v: 2, patron: true })).toString('base64url');
    const parsed = parseLicense(`BZR2.${body}.sig`);
    expect(parsed?.prefix).toBe('BZR2');
    expect(parsed?.payload.patron).toBe(true);
  });

  it('v 不是 1 / 2 的载荷不认', () => {
    const body = Buffer.from(JSON.stringify({ v: 3, id: 'x' })).toString('base64url');
    expect(parseLicense(`BZP2.${body}.sig`)).toBeNull();
  });
});
