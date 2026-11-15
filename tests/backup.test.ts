import { describe, expect, it } from 'vitest';
import { backupFileName, buildBackup, parseBackup, toCsv } from '../src/review/backup';
import { REVIEW_SCHEMA_VERSION } from '../src/review/store-format';

const item = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  filePath: `笔记/${id}.md`,
  name: id,
  stage: 3,
  phase: 'ladder' as const,
  stability: 1,
  difficulty: 0.3,
  reviewHistory: [],
  reviewStart: '2026-11-01T00:00:00.000Z',
  nextReviewDate: '2026-11-20T00:00:00.000Z',
  totalReviews: 4,
  ...extra,
});

describe('备份文件', () => {
  it('自带身份、版本、条数与导出时间，别人一看就知道是什么', () => {
    const b = buildBackup([item('a')] as any, new Date('2026-11-15T10:00:00.000Z'));
    expect(b.plugin).toBe('bz-review');
    expect(b.schema).toBe(REVIEW_SCHEMA_VERSION);
    expect(b.count).toBe(1);
    expect(b.exportedAt).toBe('2026-11-15T10:00:00.000Z');
  });

  it('导出时剥掉运行时字段（备份是数据，不是界面状态）', () => {
    const b = buildBackup([{ ...item('a'), file: {}, isCompleted: true, isOverdue: true }] as any);
    expect(b.items[0]).not.toHaveProperty('file');
    expect(b.items[0]).not.toHaveProperty('isOverdue');
  });

  it('恢复认得自己的备份、裸数组、旧壳；认不出就明确报错，不返回空计划', () => {
    expect(parseBackup(buildBackup([item('a')] as any)).ok).toBe(true);
    expect(parseBackup([item('b')]).ok).toBe(true);
    expect(parseBackup({ items: [item('c')] }).ok).toBe(true);
    const bad = parseBackup({ items: 'nope' });
    expect(bad.ok).toBe(false);
    expect(parseBackup(null).ok).toBe(false);
  });

  it('别的插件的备份不接（提示说清楚，不静默导一半）', () => {
    const r = parseBackup({ plugin: 'bz', items: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('不是复习计划');
  });
});

describe('CSV 导出', () => {
  it('表头固定，一行一条', () => {
    const csv = toCsv([item('a'), item('b')] as any);
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0].startsWith('id,kind,filePath,name')).toBe(true);
  });

  it('带逗号/引号的内容要转义，否则 Excel 一打开就串列', () => {
    const csv = toCsv([item('a', { name: '标题,带逗号"和引号' })] as any);
    expect(csv).toContain('"标题,带逗号""和引号"');
  });

  it('划线卡导出成 card，笔记导出成 note', () => {
    const card = { ...item('c'), kind: 'card', filePath: 'reader:book:1', card: { key: 'reader:book:1', bookTitle: '书', text: '划线' } };
    const csv = toCsv([card, item('n')] as any);
    expect(csv).toContain('reader:book:1');
    expect(csv.split('\n')[1].split(',')[1]).toBe('card');
    expect(csv.split('\n')[2].split(',')[1]).toBe('note');
  });
});

describe('导出文件名', () => {
  it('带时间戳，扩展名按格式走', () => {
    const d = new Date(2026, 10, 15, 9, 5, 3);
    expect(backupFileName(d, 'json')).toBe('review-backup-20261115-090503.json');
    expect(backupFileName(d, 'csv')).toBe('review-backup-20261115-090503.csv');
  });
});
