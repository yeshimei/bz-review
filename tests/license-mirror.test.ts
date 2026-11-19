import { describe, expect, it } from 'vitest';
import {
  LICENSE_MIRROR_KEY,
  readLicenseMirror,
  writeLicenseMirror,
  type CodeStorage,
} from '../src/data/license-mirror';

function mockStorage(): CodeStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
    removeItem: (k) => {
      data.delete(k);
    },
  };
}

describe('激活码镜像', () => {
  it('有码写镜像，码清空就删镜像（不给旧码留复活机会）', () => {
    const s = mockStorage();
    writeLicenseMirror(s, 'BZP2.abc.def');
    expect(s.data.get(LICENSE_MIRROR_KEY)).toBe('BZP2.abc.def');
    writeLicenseMirror(s, '');
    expect(s.data.has(LICENSE_MIRROR_KEY)).toBe(false);
  });

  it('读镜像去掉首尾空白；没写过返回空', () => {
    const s = mockStorage();
    expect(readLicenseMirror(s)).toBe('');
    writeLicenseMirror(s, '  BZP2.abc.def  ');
    expect(readLicenseMirror(s)).toBe('BZP2.abc.def');
  });

  it('没有 localStorage（隐私模式 / 测试）时静默降级', () => {
    expect(readLicenseMirror(null)).toBe('');
    expect(() => writeLicenseMirror(null, 'BZP2.x')).not.toThrow();
  });

  it('localStorage 抛错也不影响主流程', () => {
    const broken: CodeStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    expect(readLicenseMirror(broken)).toBe('');
    expect(() => writeLicenseMirror(broken, 'BZP2.x')).not.toThrow();
  });
});
