import { describe, expect, it } from 'vitest';
import {
  TRASH_LIMIT,
  TRASH_TTL_DAYS,
  addToTrash,
  pruneTrash,
  takeFromTrash,
  tombstonesOf,
} from '../src/review/trash';

const item = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  filePath: `笔记/${id}.md`,
  name: id,
  stage: 1,
  ...extra,
});

const at = (iso: string) => new Date(iso);

describe('回收站', () => {
  it('删掉的条目录下来，带删除时间与类型', () => {
    const list = addToTrash([], [item('a')], at('2026-11-15T10:00:00.000Z'));
    expect(list).toHaveLength(1);
    expect(list[0].key).toBe('笔记/a.md');
    expect(list[0].at).toBe(at('2026-11-15T10:00:00.000Z').getTime());
    expect(list[0].kind).toBe('note');
  });

  it('划线卡按 kind=card 记，恢复时不用再猜', () => {
    const card = { id: 'c1', filePath: 'reader:book:1', name: '书 · 章', kind: 'card', card: { key: 'reader:book:1', text: 't' } };
    const list = addToTrash([], [card], at('2026-11-15T10:00:00.000Z'));
    expect(list[0].kind).toBe('card');
    expect(list[0].title).toContain('书');
  });

  it('同一条目删两次只留一条，时间刷新为最后一次', () => {
    const once = addToTrash([], [item('a')], at('2026-11-15T10:00:00.000Z'));
    const twice = addToTrash(once, [item('a')], at('2026-11-15T11:00:00.000Z'));
    expect(twice).toHaveLength(1);
    expect(twice[0].at).toBe(at('2026-11-15T11:00:00.000Z').getTime());
  });

  it('超过上限时丢最旧的，不无限长', () => {
    const many = Array.from({ length: TRASH_LIMIT }, (_, i) => item(`n${i}`));
    const list = addToTrash([], many, at('2026-11-15T10:00:00.000Z'));
    expect(list).toHaveLength(TRASH_LIMIT);
    const more = addToTrash(list, [item('newest')], at('2026-11-15T11:00:00.000Z'));
    expect(more).toHaveLength(TRASH_LIMIT);
    expect(more[more.length - 1].key).toBe('笔记/newest.md');
    expect(more.some((e) => e.key === '笔记/n0.md')).toBe(false);
  });

  it(`${TRASH_TTL_DAYS} 天前的自动清掉，留下的都还新`, () => {
    const old = addToTrash([], [item('old')], at('2026-10-01T00:00:00.000Z'));
    const fresh = addToTrash(old, [item('fresh')], at('2026-11-14T00:00:00.000Z'));
    const kept = pruneTrash(fresh, at('2026-11-15T10:00:00.000Z'));
    expect(kept.map((e) => e.key)).toEqual(['笔记/fresh.md']);
  });

  it('墓碑表查得到删除时间，用来挡住合并复活', () => {
    const list = addToTrash([], [item('a')], at('2026-11-15T10:00:00.000Z'));
    const tombs = tombstonesOf(list);
    expect(tombs.get('笔记/a.md')).toBe(at('2026-11-15T10:00:00.000Z').getTime());
  });

  it('墓碑同时按 id 记一份：合并按 id 对齐，只记路径就对不上', () => {
    const list = addToTrash([], [item('a')], at('2026-11-15T10:00:00.000Z'));
    expect(tombstonesOf(list).get('a')).toBe(at('2026-11-15T10:00:00.000Z').getTime());
  });

  it('恢复时把条目从回收站拿走，返回原样的排期', () => {
    const list = addToTrash([], [item('a', { stage: 6, totalReviews: 9 })], at('2026-11-15T10:00:00.000Z'));
    const r = takeFromTrash(list, ['笔记/a.md']);
    expect(r.restored).toHaveLength(1);
    expect(r.restored[0].item.stage).toBe(6);
    expect(r.list).toEqual([]);
  });

  it('恢复不存在的条目不会炸，也不会凭空造', () => {
    const r = takeFromTrash([], ['没有这个']);
    expect(r.restored).toEqual([]);
    expect(r.list).toEqual([]);
  });
});
