/**
 * 复习流程改版（双栏工作台）的纯层契约
 *
 * 真机上两个问题：全屏时题卡跟着窗口无限拉宽；一轮里混排的卡片类型切换时
 * 界面没有任何提示与形态变化。这里把「类型元数据 / 分布 / 队列状态 / 切换提示」
 * 抽成纯函数，先把口径钉住，再接进 CardSession 的渲染。
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { modeMetaOf, typeBucketsOf, queueRowsOf, switchNoticeOf } from '../src/review/review-flow';
import type { CardMode } from '../src/review/card-mode';
import type { ReviewItem } from '../src/review/data';

function item(key: string, mode: CardMode): ReviewItem {
  return {
    id: key,
    filePath: `reader:book:${key}`,
    name: key,
    kind: 'card',
    card: { key, mode, bookTitle: '书名', chapterTitle: '第一章', text: '原文' },
  } as unknown as ReviewItem;
}

const QUEUE = [
  item('h1', 'flashcard'),
  item('h2', 'cloze'),
  item('h3', 'flashcard'),
  item('h4', 'quiz'),
  item('h5', 'context'),
  item('h6', 'plain'),
];

describe('复习流程 · 卡片类型元数据', () => {
  it('五种方式都有界面名、图标与色档', () => {
    const modes: CardMode[] = ['flashcard', 'quiz', 'cloze', 'context', 'plain'];
    for (const m of modes) {
      const meta = modeMetaOf(m);
      expect(meta.label.length, `${m} 缺界面名`).toBeGreaterThan(0);
      expect(meta.icon.length, `${m} 缺图标`).toBeGreaterThan(0);
      expect(meta.tone.length, `${m} 缺色档`).toBeGreaterThan(0);
    }
  });

  it('界面名沿用制卡界面，不另造一套说法', () => {
    expect(modeMetaOf('flashcard').label).toBe('AI 抽认卡');
    expect(modeMetaOf('quiz').label).toBe('AI 做题');
    expect(modeMetaOf('cloze').label).toBe('AI 填空');
    expect(modeMetaOf('context').label).toBe('上下文');
    expect(modeMetaOf('plain').label).toBe('展开全文');
  });

  it('不认识的方式也能安全显示，不让界面开天窗', () => {
    expect(modeMetaOf(undefined).label).toBe('AI 抽认卡');
  });
});

describe('复习流程 · 本轮类型分布', () => {
  it('按固定顺序统计， zeros 不占位', () => {
    const buckets = typeBucketsOf(QUEUE);
    expect(buckets.map((b) => [b.mode, b.count])).toEqual([
      ['flashcard', 2],
      ['quiz', 1],
      ['cloze', 1],
      ['context', 1],
      ['plain', 1],
    ]);
    expect(buckets.every((b) => b.count > 0)).toBe(true);
  });

  it('空队列不报错', () => {
    expect(typeBucketsOf([])).toEqual([]);
  });

  it('计数与队列长度对得上', () => {
    expect(typeBucketsOf(QUEUE).reduce((n, b) => n + b.count, 0)).toBe(QUEUE.length);
  });
});

describe('复习流程 · 右侧队列状态', () => {
  it('当前卡之前是已过、自己是当前、之后是待复习', () => {
    const rows = queueRowsOf(QUEUE, 'reader:book:h3');
    expect(rows.map((r) => r.state)).toEqual(['done', 'done', 'current', 'todo', 'todo', 'todo']);
  });

  it('序号从 1 开始，带上类型与名字', () => {
    const rows = queueRowsOf(QUEUE, 'reader:book:h2');
    expect(rows[0]).toMatchObject({ no: 1, label: 'AI 抽认卡', state: 'done' });
    expect(rows[1]).toMatchObject({ no: 2, label: 'AI 填空', state: 'current' });
  });

  it('找不到当前卡时没有一行会被误标成当前', () => {
    expect(queueRowsOf(QUEUE, 'nope').some((r) => r.state === 'current')).toBe(false);
  });
});

describe('复习流程 · 类型切换提示', () => {
  it('换类型时明确告诉用户切到了哪种', () => {
    expect(switchNoticeOf('flashcard', 'cloze')).toBe('已按卡片类型切换到「AI 填空」');
  });

  it('同一种类型连着做，不弹没意义的提示', () => {
    expect(switchNoticeOf('flashcard', 'flashcard')).toBe('');
  });
});

describe('复习流程 · 布局契约', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../src/review/styles.css'), 'utf8');

  it('题卡有宽度上限，不能随全屏窗口无限拉宽', () => {
    const block = /\.bzrv-cs-card\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(block, '卡片缺宽度上限').toMatch(/max-width\s*:\s*\d+px/);
  });

  it('窄窗口把右侧工作栏折起来', () => {
    expect(css).toMatch(/@media\s*\(max-width:\s*1100px\)/);
  });

  it('切卡动画与类型色档都住在作用域内', () => {
    expect(css).toMatch(/bzrv-cs-card\.is-entering/);
    expect(css).toMatch(/\[data-bzrv\]/);
  });
});
