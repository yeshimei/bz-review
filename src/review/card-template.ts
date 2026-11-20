/**
 * 自定义卡片模板（2026-11-20）：受限字段模板，不开放手写 HTML/CSS。
 *
 * 用户自己挑「正面显示哪些字段、背面显示哪些字段」，按预定义顺序渲染。
 * 之所以不开放自由模板：手写 HTML 会引入注入面、移动端排版不可控、还会把
 * 插件的样式作用域冲垮。字段模板够覆盖「先问再看原文」「正面带图」这类真实需求。
 */
import type { ReviewCard } from './data';

export type TemplateField = 'question' | 'text' | 'comment' | 'chapter' | 'book' | 'image' | 'audio';

export interface CardTemplate {
  front: TemplateField[];
  back: TemplateField[];
}

/** 全部可选字段与名字（编辑界面与渲染共用一份） */
export const TEMPLATE_FIELDS: ReadonlyArray<{ key: TemplateField; label: string }> = [
  { key: 'question', label: '问句（AI 生成）' },
  { key: 'text', label: '原文' },
  { key: 'comment', label: '我的想法' },
  { key: 'chapter', label: '章节' },
  { key: 'book', label: '书名' },
  { key: 'image', label: '图片' },
  { key: 'audio', label: '音频' },
];

/** 一条字段的值（纯文本）；图片/音频用占位描述，实际渲染由会话层换成真实元素 */
export function fieldValue(card: ReviewCard, key: TemplateField): string {
  switch (key) {
    case 'question': return String(card.qa?.q ?? '').trim();
    case 'text': return String(card.text ?? '').trim();
    case 'comment': return String(card.comment ?? '').trim();
    case 'chapter': return String(card.chapterTitle ?? '').trim();
    case 'book': return String(card.bookTitle ?? '').trim();
    case 'image': return (card.media?.images ?? []).length ? `图片 × ${card.media!.images!.length}` : '';
    case 'audio': return card.media?.audio ? '音频' : '';
    default: return '';
  }
}

/** 模板是否可用（两面至少各有一个能显示出来的字段） */
export function templateUsable(card: ReviewCard, tpl: CardTemplate): boolean {
  const front = tpl.front.some((k) => fieldValue(card, k));
  const back = tpl.back.some((k) => fieldValue(card, k));
  return front && back;
}

/** 把模板字段按预定义顺序归一（去掉非法值/重复） */
export function normalizeTemplate(raw: Partial<CardTemplate> | null | undefined): CardTemplate | null {
  if (!raw) return null;
  const keys = new Set(TEMPLATE_FIELDS.map((f) => f.key));
  const clean = (arr: unknown): TemplateField[] =>
    Array.isArray(arr)
      ? [...new Set(arr.filter((k): k is TemplateField => typeof k === 'string' && keys.has(k as TemplateField)))]
      : [];
  const front = clean(raw.front);
  const back = clean(raw.back);
  if (!front.length && !back.length) return null;
  return { front, back };
}
