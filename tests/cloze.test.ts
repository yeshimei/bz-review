import { describe, expect, it } from 'vitest';
import {
  ruleCloze,
  parseCloze,
  checkBlanks,
  normalizeAnswer,
  renderClozeHtmlParts,
  CLOZE_SLOT_RE,
} from '../src/review/cloze';

const SOURCE = '红海早过了，春天还没来，《平凡的世界》里的孙少平还在矿上。';

describe('填空卡：规则挖空（不用 AI 的兜底）', () => {
  it('优先挖书名号里的内容', () => {
    const c = ruleCloze(SOURCE);
    expect(c.blanks).toContain('平凡的世界');
    expect(c.text).not.toContain('平凡的世界');
    expect(c.text).toContain('{{1}}');
  });

  it('挖掉的地方用 {{n}} 占位，顺序从 1 开始连续', () => {
    const c = ruleCloze('2024 年增长了 37%，同期成本下降了 12%。');
    expect(c.blanks.length).toBeGreaterThanOrEqual(2);
    expect(c.blanks[0]).toBe('2024');
    expect(c.text).toContain('{{1}}');
    expect(c.text).toContain('{{2}}');
    // 占位符编号必须连续
    const nums = [...c.text.matchAll(CLOZE_SLOT_RE)].map((m) => Number(m[1]));
    expect(nums).toEqual(nums.map((_, i) => i + 1));
  });

  it('没有可挖的候选时退化成挖最长的分句', () => {
    const c = ruleCloze('他走了。她留下来。');
    expect(c.blanks.length).toBe(1);
    expect(c.text.includes('{{1}}')).toBe(true);
  });

  it('太短的划线不挖空（挖了等于没内容）', () => {
    expect(ruleCloze('好').blanks).toEqual([]);
  });

  it('空输入不炸', () => {
    expect(ruleCloze('').blanks).toEqual([]);
  });

  it('最多只挖 maxBlanks 个，且不重叠', () => {
    const c = ruleCloze('《甲》《乙》《丙》《丁》', 2);
    expect(c.blanks).toHaveLength(2);
    expect(c.text).not.toMatch(/\{\{3\}\}/);
  });
});

describe('填空卡：解析 AI 回复', () => {
  it('正常 JSON', () => {
    const c = parseCloze('{"text":"红海{{1}}过了","blanks":["早"]}', SOURCE);
    expect(c?.blanks).toEqual(['早']);
    expect(c?.text).toBe('红海{{1}}过了');
  });

  it('包在代码块里也能取', () => {
    const c = parseCloze('```json\n{"text":"红海{{1}}过了","blanks":["早"]}\n```', SOURCE);
    expect(c?.blanks).toEqual(['早']);
  });

  it('占位符与答案数量对不上 → 丢掉', () => {
    expect(parseCloze('{"text":"红海{{1}}过了{{2}}","blanks":["早"]}', SOURCE)).toBeNull();
  });

  it('占位符编号不连续 → 丢掉', () => {
    expect(parseCloze('{"text":"红海{{2}}过了","blanks":["早"]}', SOURCE)).toBeNull();
  });

  it('挖空文本跟原文完全没关系 → 丢掉（防模型瞎编）', () => {
    const c = parseCloze('{"text":"{{1}}","blanks":["随便写点啥"]}', SOURCE);
    expect(c).toBeNull();
  });

  it('把原文整句挖空 → 丢掉（那样等于没提示）', () => {
    const c = parseCloze(`{"text":"{{1}}","blanks":["${SOURCE}"]}`, SOURCE);
    expect(c).toBeNull();
  });

  it('不是 JSON 就 null', () => {
    expect(parseCloze('我觉得可以这样挖空', SOURCE)).toBeNull();
  });
});

describe('填空卡：判分', () => {
  const card = ruleCloze('红海早过了，春天还没来。');

  it('完全一样算对', () => {
    const r = checkBlanks(card, [...card.blanks]);
    expect(r.ok).toBe(true);
  });

  it('多打空格、全半角不同也算对', () => {
    const r = checkBlanks(ruleCloze('增长了 37%'), [' ３７％ ']);
    expect(r.ok).toBe(true);
  });

  it('答错就是错，但逐空给结果', () => {
    const r = checkBlanks(ruleCloze('《甲》《乙》'), ['甲', '丙']);
    expect(r.ok).toBe(false);
    expect(r.results).toEqual([true, false]);
  });

  it('没填全不算对', () => {
    const r = checkBlanks(card, []);
    expect(r.ok).toBe(false);
  });
});

describe('填空卡：渲染拆分', () => {
  it('把文本拆成「文字 / 空位」交替的片段', () => {
    const parts = renderClozeHtmlParts('红海{{1}}过了{{2}}');
    expect(parts).toEqual([
      { kind: 'text', value: '红海' },
      { kind: 'slot', index: 1 },
      { kind: 'text', value: '过了' },
      { kind: 'slot', index: 2 },
    ]);
  });

  it('结尾是空位时不会多出空文本片段', () => {
    const parts = renderClozeHtmlParts('红海{{1}}');
    expect(parts[parts.length - 1]).toEqual({ kind: 'slot', index: 1 });
  });
});

describe('normalizeAnswer', () => {
  it('全角转半角、去空白、去标点、英文小写', () => {
    expect(normalizeAnswer('  Ｈｅｌｌｏ，世界！ ')).toBe('hello世界');
  });
});
