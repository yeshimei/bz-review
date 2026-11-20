import { describe, expect, it } from 'vitest';
import { CARD_MODES, isCardMode } from '../src/review/card-mode';
import { CARD_MODE_LABELS, CARD_MODE_META, cardModeLabel } from '../src/review/card-mode-meta';
import { normalizeCardInput } from '../src/review/card-input';

describe('媒体卡与图片遮挡的模式登记', () => {
  it('两种新模式都在合法列表与界面候选里', () => {
    expect(CARD_MODES).toContain('media');
    expect(CARD_MODES).toContain('occlusion');
    expect(isCardMode('media')).toBe(true);
    expect(isCardMode('occlusion')).toBe(true);
    expect(CARD_MODE_LABELS.some((m) => m.value === 'media')).toBe(true);
    expect(CARD_MODE_LABELS.some((m) => m.value === 'occlusion')).toBe(true);
  });

  it('名字查得到（全量元数据含两种模式）', () => {
    expect(cardModeLabel('media')).toBe('媒体卡');
    expect(cardModeLabel('occlusion')).toBe('图片遮挡');
    expect(CARD_MODE_META.find((m) => m.value === 'media')?.hidden).toBeFalsy();
    expect(CARD_MODE_META.find((m) => m.value === 'occlusion')?.hidden).toBeFalsy();
  });
});

describe('媒体数据归一', () => {
  it('mode 与 media/occlusion 字段从外部输入原样保留', () => {
    const mediaCard = normalizeCardInput({
      key: 'k1',
      text: '原文',
      mode: 'media',
      media: { images: ['img/a.png'], audio: 'audio/b.mp3' },
    } as never, 1000);
    expect(mediaCard?.mode).toBe('media');
    expect(mediaCard?.media?.images).toEqual(['img/a.png']);
    expect(mediaCard?.media?.audio).toBe('audio/b.mp3');

    const occlCard = normalizeCardInput({
      key: 'k2',
      text: '原文',
      mode: 'occlusion',
      occlusion: { image: 'img/map.png', regions: [{ x: 10, y: 20, w: 30, h: 15, label: '长江' }] },
    } as never, 1000);
    expect(occlCard?.mode).toBe('occlusion');
    expect(occlCard?.occlusion?.regions[0].label).toBe('长江');
  });

  it('空原文仍不收（媒体也救不了一张白纸卡）', () => {
    expect(normalizeCardInput({ key: 'k', text: '', mode: 'media' } as never)).toBeNull();
  });
});
