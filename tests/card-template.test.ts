import { describe, expect, it } from 'vitest';
import { fieldValue, normalizeTemplate, TEMPLATE_FIELDS, templateUsable, type CardTemplate } from '../src/review/card-template';
import type { ReviewCard } from '../src/review/data';

const card: ReviewCard = {
  key: 'k',
  bookTitle: '围城',
  chapterTitle: '第三章',
  text: '方鸿渐的脸红了起来',
  comment: '这段 written 得很妙',
  qa: { q: '谁脸红了？', a: '方鸿渐', at: 1 },
  media: { images: ['img/a.png'] },
};

describe('字段模板', () => {
  it('字段值从卡上取，空字段给空串', () => {
    expect(fieldValue(card, 'question')).toBe('谁脸红了？');
    expect(fieldValue(card, 'text')).toBe('方鸿渐的脸红了起来');
    expect(fieldValue(card, 'comment')).toContain('written');
    expect(fieldValue(card, 'chapter')).toBe('第三章');
    expect(fieldValue(card, 'book')).toBe('围城');
    expect(fieldValue(card, 'image')).toBe('图片 × 1');
    expect(fieldValue(card, 'audio')).toBe('');
  });

  it('归一：去重、丢非法值、两面都空给 null', () => {
    expect(normalizeTemplate({ front: ['question', 'question', 'bogus'] as never, back: ['text'] })).toEqual({
      front: ['question'],
      back: ['text'],
    });
    expect(normalizeTemplate({ front: ['bogus'] as never, back: [] })).toBeNull();
    expect(normalizeTemplate(null)).toBeNull();
  });

  it('可用性：两面都得有卡上确实存在的字段', () => {
    expect(templateUsable(card, { front: ['question'], back: ['text'] } as CardTemplate)).toBe(true);
    expect(templateUsable(card, { front: ['audio'], back: ['text'] } as CardTemplate)).toBe(false);
  });

  it('字段清单不含重复 key', () => {
    const keys = TEMPLATE_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
