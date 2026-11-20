/**
 * Anki 导入的媒体配对（2026-11-20，纯函数）：
 * 按文件名配对、撞名改名、一处文件多处引用共用一份、缺文件单列。
 */
import { describe, expect, it } from 'vitest';
import { isAudioName, isImageName, mediaBaseName, planAnkiMedia } from '../src/review/anki-media';

describe('anki-media 文件名识别', () => {
  it('图片 / 音频后缀各自的分类', () => {
    expect(isImageName('a.PNG')).toBe(true);
    expect(isImageName('a.webp')).toBe(true);
    expect(isImageName('b.mp3')).toBe(false);
    expect(isAudioName('b.MP3')).toBe(true);
    expect(isAudioName('a.png')).toBe(false);
  });

  it('basename 兼容反斜杠路径', () => {
    expect(mediaBaseName('C:\\Anki\\collection.media\\a.png')).toBe('a.png');
    expect(mediaBaseName('media/b.mp3')).toBe('b.mp3');
  });
});

describe('planAnkiMedia 配对与落盘计划', () => {
  const base = { dir: 'bz-review/storage/anki-media', occupied: [] as string[] };

  it('按文件名（忽略大小写）配对，目标落在指定目录', () => {
    const plan = planAnkiMedia({ ...base, refs: ['A.PNG'], selectedNames: ['a.png'] });
    expect(plan.matched.get('A.PNG')).toBe('bz-review/storage/anki-media/a.png');
    expect(plan.writes).toEqual([{ index: 0, target: 'bz-review/storage/anki-media/a.png', ref: 'a.png' }]);
    expect(plan.missing).toEqual([]);
  });

  it('撞名加 -1 / -2 后缀，且用选中文件的名字，绝不覆盖已有路径', () => {
    const plan = planAnkiMedia({
      ...base,
      /* 两处引用指向同一文件名、用户也选了两个同名文件 → 各落一份、依次避让已存在的 a.png */
      refs: ['a.png', 'A.PNG'],
      selectedNames: ['a.png', 'a.png'],
      occupied: ['bz-review/storage/anki-media/a.png'],
    });
    const targets = plan.writes.map((w) => w.target);
    expect(targets).toContain('bz-review/storage/anki-media/a-1.png');
    expect(targets).toContain('bz-review/storage/anki-media/a-2.png');
    expect(plan.renamed).toBe(2);
  });

  it('同一个文件被多处引用只落一份，两处引用共用同一路径', () => {
    const plan = planAnkiMedia({ ...base, refs: ['a.png', 'A.PNG'], selectedNames: ['a.png'] });
    expect(plan.writes).toHaveLength(1);
    expect(plan.matched.get('a.png')).toBe(plan.matched.get('A.PNG'));
  });

  it('没选到的引用单列在 missing，不进 writes', () => {
    const plan = planAnkiMedia({ ...base, refs: ['a.png', 'missing.jpg'], selectedNames: ['a.png'] });
    expect(plan.missing).toEqual(['missing.jpg']);
    expect(plan.writes).toHaveLength(1);
  });

  it('非法文件名字符被替换成下划线', () => {
    const plan = planAnkiMedia({ ...base, refs: ['a:b.png'], selectedNames: ['a:b.png'] });
    expect(plan.matched.get('a:b.png')).toBe('bz-review/storage/anki-media/a_b.png');
  });
});
