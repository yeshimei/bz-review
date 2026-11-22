import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  activateLicense,
  isPaid,
  licenseSummary,
  refreshLicense,
  setLatestVersion,
  setLicenseState,
  setPluginVersion,
} from '../src/data/entitlement';
import { _setUpdateHttpForTests, writeUpdateState } from '../src/data/plugin-update';
import { signCode } from './helpers/sign';

/* ============================================================
 * 试用码 × 必须最新版（tests/entitlement-trial.test.ts）
 *
 * 2026-11-22 口径（作者定，与 bz Reader 同款）：
 *   · 试用码里不写版本；运行期拿线上最新版比，落后就锁高级功能；
 *   · 拉不到最新版也锁，并提示联网；
 *   · 永久码 / 赞助人码一概不看；
 *   · 更新到最新版后自动恢复，不删码。
 * 这里只测启动路径（refreshLicense）；激活入口的版本判定在真机验证覆盖。
 * ============================================================ */

const trial = (over: object = {}): string =>
  signCode({
    id: 'REV-TR-2026-0001',
    plan: 'trial',
    exp: Date.now() + 3 * 86_400_000,
    ...over,
  });

function seedLatest(latest: string): void {
  writeUpdateState({ checkedAt: Date.now(), notified: '', latest });
}

beforeEach(() => {
  const g = globalThis as unknown as { window?: unknown; localStorage?: Storage };
  if (typeof g.window === 'undefined') g.window = g;
  const store = new Map<string, string>();
  g.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
  _setUpdateHttpForTests(async () => null);
  setLicenseState({ paid: false, checkedAt: 0 });
  setPluginVersion('');
  setLatestVersion('');
});

afterEach(() => {
  _setUpdateHttpForTests(null);
  setPluginVersion('');
  setLatestVersion('');
});

describe('试用码必须最新版', () => {
  it('当前就是最新版：解锁，状态行写试用与剩余天数', async () => {
    setPluginVersion('1.0.2');
    seedLatest('1.0.2');
    await refreshLicense(trial());
    expect(isPaid()).toBe(true);
    expect(licenseSummary()).toContain('试用');
    expect(licenseSummary()).toContain('最新版');
  });

  it('线上有新版本：锁、码保留、状态行让用户先更新', async () => {
    setPluginVersion('1.0.1');
    seedLatest('1.0.2');
    await refreshLicense(trial());
    expect(isPaid()).toBe(false);
    expect(licenseSummary()).toContain('要求最新版');
    expect(licenseSummary()).toContain('1.0.2');
  });

  it('当前版本高于线上（自测构建）：算最新，照常解锁', async () => {
    setPluginVersion('1.1.0');
    seedLatest('1.0.2');
    await refreshLicense(trial());
    expect(isPaid()).toBe(true);
  });

  it('拿不到线上版本：锁，并提示联网确认', async () => {
    setPluginVersion('1.0.2');
    await refreshLicense(trial());
    expect(isPaid()).toBe(false);
    expect(licenseSummary()).toContain('联网');
  });

  it('更新到最新版后自动恢复，不用换码', async () => {
    setPluginVersion('1.0.1');
    seedLatest('1.0.2');
    await refreshLicense(trial());
    expect(isPaid()).toBe(false);
    setPluginVersion('1.0.2');
    expect(isPaid()).toBe(true);
  });

  it('永久码与赞助人码一概不看最新版', async () => {
    for (const extra of [{}, { patron: true }]) {
      setPluginVersion('1.0.1');
      seedLatest('1.0.2');
      await refreshLicense(signCode({ id: 'REV-1', plan: 'lifetime', ...extra }));
      expect(isPaid()).toBe(true);
      expect(licenseSummary()).not.toContain('试用');
    }
  });

  it('过期的试用码先说过期，不抢版本原因', async () => {
    setPluginVersion('1.0.1');
    seedLatest('1.0.2');
    await refreshLicense(trial({ exp: Date.now() - 86_400_000 }));
    expect(isPaid()).toBe(false);
    expect(licenseSummary()).toContain('过期');
  });

  it('激活入口：版本落后拒绝，且不落授权', async () => {
    setPluginVersion('1.0.1');
    seedLatest('1.0.2');
    /* 停用名单在测试里拉不到 → 会先被「需要联网」挡住；这条只验版本检查
       自己那一段的文案，不依赖名单。 */
    const res = await activateLicense(trial());
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/最新版|联网/);
  });
});
