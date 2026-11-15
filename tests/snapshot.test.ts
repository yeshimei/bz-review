import { describe, expect, it } from 'vitest';
import {
  SNAPSHOT_KEEP_DAYS,
  isSnapshotName,
  latestSnapshot,
  pickPrunable,
  snapshotName,
  snapshotStamp,
} from '../src/review/snapshot';

describe('快照文件名', () => {
  it('名字带日期与时间，排序即时间顺序', () => {
    const name = snapshotName(new Date('2026-11-15T08:05:03.000Z'));
    expect(name).toBe('review.20261115-080503.json');
    expect(snapshotStamp(name)).toBe('20261115-080503');
  });

  it('只认自己的命名，别的东西一律不动', () => {
    expect(isSnapshotName('review.20261115-080503.json')).toBe(true);
    expect(isSnapshotName('review.json')).toBe(false);
    expect(isSnapshotName('review.json.bak')).toBe(false);
  });
});

describe('保留与清理', () => {
  it(`只清 ${SNAPSHOT_KEEP_DAYS} 天前的，昨天今天的都留着`, () => {
    const names = [
      'review.20261101-090000.json',
      'review.20261110-090000.json',
      'review.20261114-090000.json',
      'review.20261115-090000.json',
    ];
    expect(pickPrunable(names, new Date('2026-11-15T10:00:00.000Z'))).toEqual(['review.20261101-090000.json']);
  });

  it('认不出的文件名不删（宁可不清理，也不删错东西）', () => {
    expect(pickPrunable(['随手放的.json', 'review.json'], new Date('2026-11-15T10:00:00.000Z'))).toEqual([]);
  });

  it('就地取时间：按时间戳选最新那份，不靠文件名在列表里的位置', () => {
    const names = ['review.20261110-090000.json', 'review.20261115-090000.json', 'review.20261114-090000.json'];
    expect(latestSnapshot(names)).toBe('review.20261115-090000.json');
  });

  it('没有快照时给 null，调用方好说人话', () => {
    expect(latestSnapshot([])).toBeNull();
    expect(latestSnapshot(['review.json'])).toBeNull();
  });
});
