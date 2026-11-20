import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/settings';
import { DEFAULT_REVIEW_DIR } from '../src/core/storage-dir';

describe('复习数据目录：库根默认', () => {
  it('默认目录是库根的 bz-review/storage', () => {
    expect(DEFAULT_SETTINGS.storagePath).toBe('bz-review/storage');
    expect(DEFAULT_REVIEW_DIR).toBe('bz-review/storage');
  });
});
