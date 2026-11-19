/**
 * 「已移出」页 markup（2026-11-19）。
 *
 * 这一页取代了原来那个只在队列底部才出现的回收站视图：条目形制对齐 bz-reader 的
 * 笔记页（标题 / 引文 / 出处 / 恢复），空态给宿主由 uiEmpty 填。markup 单源在
 * render.ts，这里钉住三件容易回退的事：恢复键必须落到按钮上、标题必须转义、
 * 页面自己不再写一遍大标题。
 */
import { describe, expect, it } from 'vitest';
import { trashPageHtml } from '../src/review/render';
import type { TrashEntry } from '../src/review/trash';

const card = (over: Partial<TrashEntry> = {}): TrashEntry => ({
  key: 'reader:b1:hm1',
  id: 'review_1',
  at: Date.parse('2026-11-19T15:07:57.000Z'),
  kind: 'card',
  title: '围城 · 序',
  item: {
    id: 'review_1',
    filePath: 'reader:b1:hm1',
    name: '围城 · 序',
    kind: 'card',
    card: { key: 'reader:b1:hm1', bookTitle: '围城', chapterTitle: '序', text: '在这本书里，我想写现代中国某一部分社会。' },
  },
  ...over,
});

const note = (over: Partial<TrashEntry> = {}): TrashEntry => ({
  key: '书/围城 · 读书笔记.md',
  id: 'review_2',
  at: Date.parse('2026-11-19T15:07:57.000Z'),
  kind: 'note',
  title: '围城 · 读书笔记',
  item: { id: 'review_2', filePath: '书/围城 · 读书笔记.md', name: '围城 · 读书笔记' },
  ...over,
});

describe('已移出页', () => {
  it('空列表只给空态宿主，不渲染一张空卡片列表', () => {
    const html = trashPageHtml([]);
    expect(html).toContain('data-empty-host');
    expect(html).not.toContain('bzrv-trash-card');
    expect(html).not.toContain('全部恢复');
  });

  it('划线卡带引文与「书名 · 章节」，恢复键挂在按钮上', () => {
    const html = trashPageHtml([card()], { now: Date.parse('2026-11-19T16:00:00.000Z') });
    expect(html).toContain('data-restore="reader:b1:hm1"');
    expect(html).toContain('围城 · 序');
    expect(html).toContain('在这本书里，我想写现代中国某一部分社会。');
    expect(html).toContain('还剩 30 天');
  });

  it('笔记写所在文件夹，不假装有引文', () => {
    const html = trashPageHtml([note()]);
    expect(html).toContain('data-restore="书/围城 · 读书笔记.md"');
    expect(html).toContain('<span class="bzrv-trash-src">书</span>');
    expect(html).not.toContain('bzrv-trash-card-quote');
  });

  it('标题与引文都转义，页面自己不出现在正文里的大标题', () => {
    const html = trashPageHtml([card({ title: '<img src=x onerror=alert(1)>' })]);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
    expect(html).not.toMatch(/<h[1-4]|bzrv-panel-title/);
  });
});
