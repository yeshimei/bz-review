import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/settings';
import {
  DEFAULT_REVIEW_DIR,
  LEGACY_REVIEW_DIR,
  startupStorageDir,
} from '../src/core/storage-dir';

describe('复习数据目录：库根默认与老数据回落', () => {
  it('默认目录是库根的 bz-review/storage', () => {
    expect(DEFAULT_SETTINGS.storagePath).toBe('bz-review/storage');
    expect(DEFAULT_REVIEW_DIR).toBe('bz-review/storage');
  });

  it('老目录有数据而新目录空时，自动指回老目录', () => {
    expect(
      startupStorageDir({ configured: DEFAULT_REVIEW_DIR, newHasData: false, legacyHasData: true }),
    ).toBe(LEGACY_REVIEW_DIR);
  });

  it('新目录已经有数据就保持默认，不被老目录抢走', () => {
    expect(
      startupStorageDir({ configured: DEFAULT_REVIEW_DIR, newHasData: true, legacyHasData: true }),
    ).toBe(DEFAULT_REVIEW_DIR);
  });

  it('用户自定义的目录不受回落影响', () => {
    expect(
      startupStorageDir({ configured: 'My Reviews', newHasData: false, legacyHasData: true }),
    ).toBe('My Reviews');
  });
});
