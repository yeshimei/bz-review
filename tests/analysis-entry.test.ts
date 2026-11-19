import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { queueViewHtml } from '../src/review/render';
import type { ReviewItem } from '../src/review/data';

const src = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const item = {
  id: 'k1',
  filePath: 'reader:围城:k1',
  name: '围城 · 序',
  kind: 'card',
  card: { key: 'k1', bookTitle: '围城', chapterTitle: '序', text: '原文' },
  phase: 'fsrs',
  stability: 10,
  difficulty: 4,
  lastReviewed: '2026-11-18T00:00:00.000Z',
  nextReviewDate: '2026-11-20T00:00:00.000Z',
  reviewHistory: [],
} as unknown as ReviewItem;

describe('记忆分析（逐幕报幕）入口已摘', () => {
  it('底栏不再渲染可点的分析入口', () => {
    const html = queueViewHtml([item]);
    expect(html).not.toContain('data-act="stats"');
    expect(html).not.toContain('逐幕回放全馆记忆');
  });

  it('累计/连续天数照旧展示，只是不再能点', () => {
    const html = queueViewHtml([item]);
    expect(html).toContain('累计 <b>0</b> 天 · 连续 <b>0</b> 天');
  });

  it('数据页与命令面板都不再挂分析入口', () => {
    expect(src('../src/review/ui.ts')).not.toContain('看记忆分析');
    expect(src('../src/review/ui.ts')).not.toContain('openReviewAnalysis');
    expect(src('../src/main.ts')).not.toContain("id: 'review-analysis'");
  });
});
