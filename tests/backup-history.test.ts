import { describe, expect, it } from 'vitest';
import {
  countRestoreRaw,
  describeRestorePoint,
  formatRestoreTime,
  restoreStampOf,
  sortRestorePoints,
  sourceOf,
  type RestorePoint,
} from '../src/review/backup-history';
import { pickOverLimit } from '../src/review/snapshot';

describe('恢复点识别', () => {
  it('快照与手动备份各自认得出来，CSV 不认', () => {
    expect(sourceOf('review.20261115-080503.json')).toBe('snapshot');
    expect(sourceOf('review-backup-20261115-080503.json')).toBe('backup');
    expect(sourceOf('review.20261115-080503-2.json')).toBe('snapshot');
    expect(sourceOf('review-backup-20261115-080503.csv')).toBeNull();
    expect(sourceOf('随手放的.json')).toBeNull();
  });

  it('排序键从文件名取，不猜别的东西', () => {
    expect(restoreStampOf('review.20261115-080503.json')).toBe('20261115-080503');
    expect(restoreStampOf('review-backup-20261115-080503.json')).toBe('20261115-080503');
    expect(restoreStampOf('review.json')).toBeNull();
  });

  it('时间戳显示成人话', () => {
    expect(formatRestoreTime('20261115-080503')).toBe('2026-11-15 08:05:03 UTC');
    expect(formatRestoreTime('乱七八糟')).toBe('乱七八糟');
  });
});

describe('恢复点清单', () => {
  const pt = (name: string, stamp: string, count: number | null, source: 'snapshot' | 'backup' = 'snapshot'): RestorePoint => ({
    name,
    path: `${source}/${name}`,
    source,
    stamp,
    count,
  });

  it('按时间倒序，同一秒快照在前', () => {
    const got = sortRestorePoints([
      pt('old', '20261110-090000', 2, 'backup'),
      pt('snap', '20261115-080503', 7),
      pt('bak', '20261115-080503', 7, 'backup'),
    ]);
    expect(got.map((x) => x.name)).toEqual(['snap', 'bak', 'old']);
  });

  it('人话描述带来源和条数，读不出条数时说未知', () => {
    expect(describeRestorePoint(pt('review.20261115-080503.json', '20261115-080503', 7))).toBe(
      '2026-11-15 08:05:03 UTC · 自动快照 · 7 条'
    );
    expect(describeRestorePoint(pt('review-backup-20261115-080503.json', '20261115-080503', null, 'backup'))).toBe(
      '2026-11-15 08:05:03 UTC · 手动备份 · 条数未知'
    );
  });

  it('数条目：裸数组、导出壳都认，坏档给 null', () => {
    expect(countRestoreRaw('[{"id":"a"},{"id":"b"}]')).toBe(2);
    expect(countRestoreRaw(JSON.stringify({ plugin: 'bz-review', schema: 2, items: [{ id: 'a' }] }))).toBe(1);
    expect(countRestoreRaw('这不是 JSON')).toBeNull();
  });
});

describe('保留份数裁剪', () => {
  it('超出份数的旧份被挑出来删，认不出时间戳的不动', () => {
    const names = [
      'review.20261110-090000.json',
      'review.20261111-090000.json',
      'review.20261112-090000.json',
      '随手放的.json',
    ];
    expect(pickOverLimit(names, 2)).toEqual(['review.20261110-090000.json']);
    expect(pickOverLimit(names, 10)).toEqual([]);
    expect(pickOverLimit(names, 0)).toEqual([]);
  });
});
