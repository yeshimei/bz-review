import { describe, expect, it } from 'vitest';
import {
  REVIEW_FILE_VERSION,
  mergeReviewItems,
  parseReviewFile,
  stampChangedItems,
  wrapReviewFile,
} from '../src/review/store-format';

const A = { id: 'a', filePath: '笔记/a.md', name: 'a', updatedAt: '2026-11-10T00:00:00.000Z', stage: 1 };
const B = { id: 'b', filePath: '笔记/b.md', name: 'b', updatedAt: '2026-11-10T00:00:00.000Z', stage: 2 };

describe('review.json 形态', () => {
  it('旧版纯数组能读出来，并标记为需要升级', () => {
    const p = parseReviewFile([A, B]);
    expect(p.items).toHaveLength(2);
    expect(p.legacyArray).toBe(true);
    expect(p.broken).toBe(false);
  });

  it('新形态带版本号与写入时间', () => {
    const p = parseReviewFile({ version: REVIEW_FILE_VERSION, updatedAt: '2026-11-15T00:00:00.000Z', items: [A] });
    expect(p.items).toHaveLength(1);
    expect(p.legacyArray).toBe(false);
    expect(p.broken).toBe(false);
  });

  it('不是数组也不是带 items 的对象，一律当坏档，不猜', () => {
    for (const raw of [null, undefined, 'text', 42, { items: 'nope' }]) {
      const p = parseReviewFile(raw);
      expect(p.items).toEqual([]);
      expect(p.broken).toBe(true);
    }
  });

  it('写出去的形态带版本号与写入时间，条目原样保留', () => {
    const file = wrapReviewFile([A], new Date('2026-11-15T08:00:00.000Z'));
    expect(file.version).toBe(REVIEW_FILE_VERSION);
    expect(file.updatedAt).toBe('2026-11-15T08:00:00.000Z');
    expect(file.items).toEqual([A]);
  });
});

describe('写入时只给真正改过的条目盖时间戳', () => {
  it('没动的条目时间戳不变，动过的才刷新', () => {
    const now = new Date('2026-11-15T09:00:00.000Z');
    const disk = [A, B];
    const next = [{ ...A, stage: 5 }, { ...B }];
    const stamped = stampChangedItems(next, disk, now);
    expect(stamped[0].updatedAt).toBe(now.toISOString());
    expect(stamped[1].updatedAt).toBe(B.updatedAt);
  });

  it('新条目没有旧版本可比，直接盖时间戳', () => {
    const now = new Date('2026-11-15T09:00:00.000Z');
    const stamped = stampChangedItems([{ id: 'c', filePath: 'c.md' }], [], now);
    expect(stamped[0].updatedAt).toBe(now.toISOString());
  });

  it('运行期字段变化不算内容变化（不因为列表刷新就全员盖戳）', () => {
    const now = new Date('2026-11-15T09:00:00.000Z');
    const disk = [{ ...A }];
    const next = [{ ...A, file: {}, isOverdue: true, currentStage: 9, totalStages: 10 }];
    const stamped = stampChangedItems(next, disk, now);
    expect(stamped[0].updatedAt).toBe(A.updatedAt);
  });
});

describe('两台设备合并', () => {
  const opts = (tombstones?: Map<string, number>) => ({ now: new Date('2026-11-15T10:00:00.000Z'), tombstones });

  it('只有一边有的条目都留下', () => {
    const r = mergeReviewItems([A], [B], opts());
    expect(r.items.map((i) => i.id).sort()).toEqual(['a', 'b']);
    expect(r.conflicts).toEqual([]);
  });

  it('同一个条目两边都改过，时间新的胜', () => {
    const local = [{ ...A, updatedAt: '2026-11-12T00:00:00.000Z', stage: 7 }];
    const remote = [{ ...A, updatedAt: '2026-11-14T00:00:00.000Z', stage: 3 }];
    const r = mergeReviewItems(local, remote, opts());
    expect(r.items).toHaveLength(1);
    expect(r.items[0].stage).toBe(3);
    expect(r.conflicts).toHaveLength(1);
  });

  it('老数据没有时间戳时，以本机这次要写的为准，但记一笔冲突', () => {
    const local = [{ ...A, updatedAt: undefined, stage: 4 }];
    const remote = [{ ...A, updatedAt: undefined, stage: 8 }];
    const r = mergeReviewItems(local, remote, opts());
    expect(r.items[0].stage).toBe(4);
    expect(r.conflicts).toEqual(['a']);
  });

  it('回收站里的墓碑比条目新，条目不会被合并复活', () => {
    const tombstones = new Map([['a', new Date('2026-11-14T00:00:00.000Z').getTime()]]);
    const remote = [{ ...A, updatedAt: '2026-11-10T00:00:00.000Z' }];
    const r = mergeReviewItems([], remote, opts(tombstones));
    expect(r.items).toEqual([]);
    expect(r.revived).toEqual(['a']);
  });

  it('条目在删除之后又被复习过，说明是新的学习记录，必须留下', () => {
    const tombstones = new Map([['a', new Date('2026-11-10T00:00:00.000Z').getTime()]]);
    const remote = [{ ...A, updatedAt: '2026-11-12T00:00:00.000Z' }];
    const r = mergeReviewItems([], remote, opts(tombstones));
    expect(r.items).toHaveLength(1);
    expect(r.revived).toEqual([]);
  });
});
