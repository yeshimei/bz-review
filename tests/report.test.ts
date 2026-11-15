import { describe, expect, it } from 'vitest';
import { cardsToMarkdown, forecastToText, statsToCsv } from '../src/review/report';

const stats = {
  totalReviews: 12,
  streak: 3,
  todayReviews: 4,
  ratingDist: { again: 1, hard: 2, good: 3, easy: 4 },
  overdueRate: 0.25,
  avgR: 0.82,
  reviewedNotes: 6,
  firstReviewAt: '2026-11-01T00:00:00.000Z',
  daily7: [
    { date: '2026-11-14', count: 2 },
    { date: '2026-11-15', count: 4 },
  ],
} as any;

describe('统计导出', () => {
  it('两列长表，指标名与数字都在', () => {
    const csv = statsToCsv(stats);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('指标,数值');
    expect(csv).toContain('累计复习天数,12');
    expect(csv).toContain('逾期率,25%');
    expect(csv).toContain('近 7 天·2026-11-15,4');
  });

  it('没有 R 时给破折号，不写 NaN', () => {
    expect(statsToCsv({ ...stats, avgR: null } as any)).toContain('平均记忆保留度 R,—');
  });
});

describe('划线卡导出 Markdown', () => {
  const items = [
    { id: 'c1', filePath: 'reader:b:1', name: '围城', kind: 'card', card: { key: 'reader:b:1', bookTitle: '围城', text: '城外的人想进去', comment: '经典', qa: { q: '围城的名句', a: '城外的人想进去', at: 0 }, backlink: 'obsidian://x' } },
    { id: 'c2', filePath: 'reader:b:2', name: '围城', kind: 'card', card: { key: 'reader:b:2', bookTitle: '围城', text: '另一句' } },
    { id: 'n1', filePath: '笔记/a.md', name: '笔记', stage: 1 },
  ] as any[];

  it('按书分组，只导划线卡，笔记不掺进来', () => {
    const md = cardsToMarkdown(items);
    expect(md).toContain('## 围城');
    expect(md).toContain('共 2 张');
    expect(md).not.toContain('笔记/a.md');
  });

  it('想法、问答、回原文链接都在', () => {
    const md = cardsToMarkdown(items);
    expect(md).toContain('- 想法：经典');
    expect(md).toContain('  - 问：围城的名句');
    expect(md).toContain('[回到原文]');
  });
});

describe('负荷预测文字版', () => {
  const points = [
    { day: '2026-11-15', count: 3 },
    { day: '2026-11-16', count: 0 },
    { day: '2026-11-17', count: 8 },
  ];

  it('说总量、峰值日，并跳过空白天', () => {
    const text = forecastToText(points);
    expect(text).toContain('共 11 条');
    expect(text).toContain('2026-11-17（8 条）');
    expect(text).not.toContain('2026-11-16');
  });

  it('全空就说没有安排（不输出一张空表）', () => {
    expect(forecastToText([{ day: '2026-11-15', count: 0 }])).toBe('未来这些天没有安排复习。');
  });
});
