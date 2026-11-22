import { describe, expect, it } from 'vitest';
import {
  _setUpdateHttpForTests,
  ensureLatestVersion,
  fetchLatestVersion,
  giteeManifestUrl,
  hasUpdate,
  parseUpdateState,
  readUpdateState,
  shouldCheck,
  shouldNotify,
  versionFromManifest,
  writeUpdateState,
} from '../src/data/plugin-update';

describe('版本判定', () => {
  it('线上比当前新才算有更新', () => {
    expect(hasUpdate('1.0.2', '1.1.0')).toBe(true);
    expect(hasUpdate('1.0.2', '1.0.2')).toBe(false);
  });

  it('本机版本更高（自测构建）不提示', () => {
    expect(hasUpdate('1.1.0', '1.0.2')).toBe(false);
  });

  it('版本号缺失一律不提示', () => {
    expect(hasUpdate('', '1.1.0')).toBe(false);
    expect(hasUpdate('1.0.2', '')).toBe(false);
  });
});

describe('线上清单解析', () => {
  it('取 bz-review 清单里的 version', () => {
    expect(versionFromManifest(JSON.stringify({ id: 'bz-review', version: '1.1.0' }))).toBe('1.1.0');
  });

  it('别的插件 / 坏 JSON / 没版本都当没拿到', () => {
    expect(versionFromManifest(JSON.stringify({ id: 'bz-reader', version: '1.6.0' }))).toBeNull();
    expect(versionFromManifest('not json')).toBeNull();
    expect(versionFromManifest(JSON.stringify({ id: 'bz-review' }))).toBeNull();
    expect(versionFromManifest(null)).toBeNull();
  });
});

describe('码云 release JSON', () => {
  const doc = {
    assets: [
      { name: 'main.js', browser_download_url: 'https://gitee.com/x/main.js' },
      { name: 'manifest.json', browser_download_url: 'https://gitee.com/x/manifest.json' },
    ],
  };

  it('挑出 manifest.json 的下载地址', () => {
    expect(giteeManifestUrl(JSON.stringify(doc))).toBe('https://gitee.com/x/manifest.json');
  });

  it('没有 assets / 坏 JSON 返回 null', () => {
    expect(giteeManifestUrl(JSON.stringify({ tag_name: '1.1.0' }))).toBeNull();
    expect(giteeManifestUrl('oops')).toBeNull();
    expect(giteeManifestUrl(null)).toBeNull();
  });
});

describe('拉线上版本（注入 HTTP，不联网）', () => {
  it('GitHub 直链成功就只请求一次', async () => {
    const calls: string[] = [];
    _setUpdateHttpForTests(async (url) => {
      calls.push(url);
      return JSON.stringify({ id: 'bz-review', version: '1.1.0' });
    });
    await expect(fetchLatestVersion()).resolves.toBe('1.1.0');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('github.com/yeshimei/bz-review/releases/latest');
    _setUpdateHttpForTests(null);
  });

  it('GitHub 拿不到时切码云：先查 release 再拉清单', async () => {
    const calls: string[] = [];
    _setUpdateHttpForTests(async (url) => {
      calls.push(url);
      if (url.includes('github.com')) return null;
      if (url.includes('/releases/latest')) {
        return JSON.stringify({
          assets: [{ name: 'manifest.json', browser_download_url: 'https://gitee.com/x/manifest.json' }],
        });
      }
      return JSON.stringify({ id: 'bz-review', version: '1.1.2' });
    });
    await expect(fetchLatestVersion()).resolves.toBe('1.1.2');
    expect(calls).toHaveLength(3);
    _setUpdateHttpForTests(null);
  });

  it('两个源都失败返回 null（失败要静默）', async () => {
    _setUpdateHttpForTests(async () => null);
    await expect(fetchLatestVersion()).resolves.toBeNull();
    _setUpdateHttpForTests(null);
  });

  it('请求抛错也吞掉，不把启动带崩', async () => {
    _setUpdateHttpForTests(async () => {
      throw new Error('offline');
    });
    await expect(fetchLatestVersion()).resolves.toBeNull();
    _setUpdateHttpForTests(null);
  });
});

describe('24 小时节流', () => {
  const now = 1_800_000_000_000;
  const HOUR = 3_600_000;

  it('从没查过要查；到 24 小时才再查', () => {
    expect(shouldCheck({ checkedAt: 0, notified: '', latest: '' }, now)).toBe(true);
    expect(shouldCheck({ checkedAt: now - 23 * HOUR, notified: '', latest: '' }, now)).toBe(false);
    expect(shouldCheck({ checkedAt: now - 24 * HOUR, notified: '', latest: '' }, now)).toBe(true);
  });
});

describe('每个新版本只弹一次', () => {
  it('没弹过就弹；弹过同一版不弹；换新版再弹', () => {
    expect(shouldNotify({ checkedAt: 0, notified: '', latest: '' }, '1.1.0')).toBe(true);
    expect(shouldNotify({ checkedAt: 0, notified: '1.1.0', latest: '' }, '1.1.0')).toBe(false);
    expect(shouldNotify({ checkedAt: 0, notified: '1.1.0', latest: '' }, '1.1.1')).toBe(true);
  });

  it('空版本不弹', () => {
    expect(shouldNotify({ checkedAt: 0, notified: '', latest: '' }, '')).toBe(false);
  });
});

describe('本地状态解析', () => {
  it('正常 JSON 读得回来，多余字段忽略', () => {
    const s = parseUpdateState('{"checkedAt":123,"notified":"1.1.0","latest":"1.1.0","extra":1}');
    expect(s.checkedAt).toBe(123);
    expect(s.notified).toBe('1.1.0');
    expect(s.latest).toBe('1.1.0');
  });

  it('空值 / 坏 JSON / 类型不对都回退到空状态', () => {
    expect(parseUpdateState(null)).toEqual({ checkedAt: 0, notified: '', latest: '' });
    expect(parseUpdateState('{oops')).toEqual({ checkedAt: 0, notified: '', latest: '' });
    expect(parseUpdateState('{"checkedAt":"昨天","notified":5}')).toEqual({
      checkedAt: 0,
      notified: '',
      latest: '',
    });
  });
});

describe('ensureLatestVersion（试用判定与更新提醒共用）', () => {
  const HOUR = 3_600_000;
  const store = new Map<string, string>();

  function mountStorage(): void {
    store.clear();
    (globalThis as unknown as { window?: unknown; localStorage?: Storage }).window ??= globalThis;
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } as unknown as Storage;
  }

  it('24 小时内的缓存直接返回，不再请求', async () => {
    mountStorage();
    let calls = 0;
    writeUpdateState({ checkedAt: Date.now(), notified: '', latest: '1.1.0' });
    _setUpdateHttpForTests(async () => {
      calls += 1;
      return null;
    });
    expect(await ensureLatestVersion()).toBe('1.1.0');
    expect(calls).toBe(0);
    _setUpdateHttpForTests(null);
  });

  it('缓存过期会重新拉；拉到就更新本地版本', async () => {
    mountStorage();
    writeUpdateState({ checkedAt: Date.now() - 25 * HOUR, notified: '', latest: '1.1.0' });
    _setUpdateHttpForTests(async (url) =>
      url.includes('github.com') ? JSON.stringify({ id: 'bz-review', version: '1.2.0' }) : null,
    );
    expect(await ensureLatestVersion()).toBe('1.2.0');
    expect(readUpdateState().latest).toBe('1.2.0');
    _setUpdateHttpForTests(null);
  });

  it('拉不到时回退上次拿到的版本（离线不锁死已激活的试用）', async () => {
    mountStorage();
    writeUpdateState({ checkedAt: Date.now() - 25 * HOUR, notified: '', latest: '1.1.0' });
    _setUpdateHttpForTests(async () => null);
    expect(await ensureLatestVersion()).toBe('1.1.0');
    _setUpdateHttpForTests(null);
  });

  it('从没拿到过又拉不到：返回 null，调用方按「需要联网」处理', async () => {
    mountStorage();
    _setUpdateHttpForTests(async () => null);
    expect(await ensureLatestVersion()).toBeNull();
    _setUpdateHttpForTests(null);
  });
});
