import { describe, expect, it } from 'vitest';
import {
  REVIEW_SCHEMA_VERSION,
  fingerprintsOf,
  mergeReviewItems,
  parseReviewFile,
  reviewMeta,
  serializeReviewItems,
  stampChangedItems,
} from '../src/review/store-format';

const A = { id: 'a', filePath: '笔记/a.md', name: 'a', updatedAt: '2026-11-10T00:00:00.000Z', stage: 1 };
const B = { id: 'b', filePath: '笔记/b.md', name: 'b', updatedAt: '2026-11-10T00:00:00.000Z', stage: 2 };

describe('review.json 形态', () => {
  it('主体永远是数组：旧版插件读到也不会当成空计划', () => {
    const p = parseReviewFile([A, B]);
    expect(p.items).toHaveLength(2);
    expect(p.legacyArray).toBe(true);
    expect(p.broken).toBe(false);
  });

  it('万一读到带 items 的对象（别人写过的新形态）也读得动，不丢数据', () => {
    const p = parseReviewFile({ version: REVIEW_SCHEMA_VERSION, updatedAt: '2026-11-15T00:00:00.000Z', items: [A] });
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

  it('写盘用数组：条目原样保留，运行时字段剥掉', () => {
    const out = serializeReviewItems([{ ...A, file: {}, isOverdue: true }]);
    expect(Array.isArray(out)).toBe(true);
    expect(out[0]).toEqual(A);
  });

  it('版本号与写入时间进旁挂元数据，不塞进 review.json', () => {
    const meta = reviewMeta(new Date('2026-11-15T08:00:00.000Z'));
    expect(meta.schema).toBe(REVIEW_SCHEMA_VERSION);
    expect(meta.updatedAt).toBe('2026-11-15T08:00:00.000Z');
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

  it('墓碑只记了文件路径、远端条目用的是 id，也照样挡得住（删了不该自己回来）', () => {
    const tombstones = new Map([['笔记/a.md', new Date('2026-11-14T00:00:00.000Z').getTime()]]);
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

/* 真机事故：单机复习 4 次，弹了 4 次「在别的设备上也被改过」并留了 4 份 .bak。
   原因是合并只知道「两边内容不一样」，不知道「另一边到底动没动」——本机刚改的那条
   必然和盘上旧值不同，于是每次写盘都判成冲突。给了基准（上次读到的内容）之后，
   只有「远端也动过」才算冲突。 */
describe('三路合并（带基准）', () => {
  const opts = (base?: Map<string, string>) => ({
    now: new Date('2026-11-15T10:00:00.000Z'),
    base,
  });

  it('本机单独改过：不算冲突，本机的改动留着', () => {
    const disk = [{ ...A, stage: 1 }];
    const base = fingerprintsOf(disk);
    const local = [{ ...A, updatedAt: '2026-11-15T09:00:00.000Z', stage: 5 }];
    const r = mergeReviewItems(local, disk, opts(base));
    expect(r.conflicts).toEqual([]);
    expect(r.items[0].stage).toBe(5);
  });

  it('远端单独改过（本机没动）：不算冲突，采用远端', () => {
    const base = fingerprintsOf([{ ...A, stage: 1 }]);
    const disk = [{ ...A, updatedAt: '2026-11-15T09:00:00.000Z', stage: 6 }];
    const local = [{ ...A, stage: 1 }];
    const r = mergeReviewItems(local, disk, opts(base));
    expect(r.conflicts).toEqual([]);
    expect(r.items[0].stage).toBe(6);
  });

  it('两边都改过：才算冲突', () => {
    const base = fingerprintsOf([{ ...A, stage: 1 }]);
    const disk = [{ ...A, updatedAt: '2026-11-15T09:00:00.000Z', stage: 6 }];
    const local = [{ ...A, updatedAt: '2026-11-15T09:30:00.000Z', stage: 5 }];
    const r = mergeReviewItems(local, disk, opts(base));
    expect(r.conflicts).toEqual(['a']);
  });

  it('没有基准时照旧保守处理（老调用点行为不变）', () => {
    const local = [{ ...A, updatedAt: '2026-11-12T00:00:00.000Z', stage: 7 }];
    const remote = [{ ...A, updatedAt: '2026-11-14T00:00:00.000Z', stage: 3 }];
    const r = mergeReviewItems(local, remote, opts());
    expect(r.conflicts).toHaveLength(1);
  });

  it('基准里没有的新条目（本机刚加的）不算冲突', () => {
    const base = fingerprintsOf([A]);
    const local = [A, { ...B, updatedAt: '2026-11-15T09:00:00.000Z' }];
    const r = mergeReviewItems(local, [A], opts(base));
    expect(r.conflicts).toEqual([]);
    expect(r.items).toHaveLength(2);
  });
});

describe('卡片管理器字段的持久化', () => {
  it('suspended / buriedUntil 不在运行时字段表里，serializeReviewItems 原样写盘', () => {
    const it = { ...A, suspended: true, buriedUntil: '2099-01-01T00:00:00.000Z', isOverdue: true };
    const out = serializeReviewItems([it])[0];
    expect(out.suspended).toBe(true);
    expect(out.buriedUntil).toBe('2099-01-01T00:00:00.000Z');
    expect(out.isOverdue).toBeUndefined();
  });
});
