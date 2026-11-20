import { describe, expect, it } from 'vitest';
import {
  addSpan,
  clozeToRanges,
  MAX_SPAN,
  MIN_VISIBLE,
  rangesToCloze,
  removeSpan,
  visibleLength,
} from '../src/review/cloze-edit';

describe('clozeToRanges：{{n}} 标记 ↔ 纯文本 + 区间', () => {
  it('一个空位：还原成纯文本并把区间指回原处', () => {
    const r = clozeToRanges('婚姻像{{1}}。「围城」', ['一座城']);
    expect(r.plain).toBe('婚姻像一座城。「围城」');
    expect(r.spans).toEqual([{ start: 3, end: 6 }]);
  });

  it('多个空位按编号顺序还原', () => {
    const r = clozeToRanges('{{1}}像{{2}}。', ['婚姻', '一座城']);
    expect(r.plain).toBe('婚姻像一座城。');
    expect(r.spans).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 6 },
    ]);
  });

  it('编号不连续 / 与答案数量不符时不猜：原样保留文字、区间全空', () => {
    const r = clozeToRanges('前{{2}}后', ['甲']);
    expect(r.plain).toBe('前后');
    expect(r.spans).toEqual([]);
  });

  it('没有标记就当没有空位', () => {
    const r = clozeToRanges('一段普通原文', []);
    expect(r.plain).toBe('一段普通原文');
    expect(r.spans).toEqual([]);
  });
});

describe('rangesToCloze：区间 → {{n}} 标记', () => {
  it('与 clozeToRanges 互逆', () => {
    const model = clozeToRanges('婚姻像{{1}}，{{2}}。', ['一座城', '外面的人想进去']);
    const back = rangesToCloze(model.plain, model.spans);
    expect(back.text).toBe('婚姻像{{1}}，{{2}}。');
    expect(back.blanks).toEqual(['一座城', '外面的人想进去']);
  });

  it('区间乱序也按位置重排，编号从 1 起连续', () => {
    const out = rangesToCloze('甲乙丙', [
      { start: 2, end: 3 },
      { start: 0, end: 1 },
    ]);
    expect(out.text).toBe('{{1}}乙{{2}}');
    expect(out.blanks).toEqual(['甲', '丙']);
  });

  it('越界 / 空区间被丢掉', () => {
    const out = rangesToCloze('甲乙丙', [
      { start: -3, end: 1 },
      { start: 1, end: 1 },
      { start: 2, end: 99 },
    ]);
    expect(out.text).toBe('{{1}}乙{{2}}');
    expect(out.blanks).toEqual(['甲', '丙']);
  });
});

describe('addSpan：拖选加空 / 选中已有空位＝还原', () => {
  const plain = '复习不是把原文再读一遍，而是在快要忘记的时候把它重新想起来。';

  it('普通拖选：加一个空位', () => {
    const res = addSpan(plain, [], 2, 6);
    expect(res.action).toBe('added');
    expect(res.spans).toEqual([{ start: 2, end: 6 }]);
  });

  it('首尾空白自动裁掉', () => {
    const res = addSpan('  甲乙丙丁戊己庚辛', [], 0, 7);
    expect(res.action).toBe('added');
    expect(res.spans).toEqual([{ start: 2, end: 7 }]);
  });

  it('全是空白 → 拒绝', () => {
    const res = addSpan('甲  乙', [], 1, 3);
    expect(res.action).toBe('rejected');
    expect(res.reason).toBe('empty');
  });

  it('与已有空位相交 → 按还原处理，不再新建', () => {
    const first = addSpan(plain, [], 4, 8);
    const second = addSpan(plain, first.spans, 6, 10);
    expect(second.action).toBe('removed');
    expect(second.count).toBe(1);
    expect(second.spans).toEqual([]);
  });

  it('跨段拖选 → 按段切成多个空位', () => {
    const res = addSpan('第一行文字\n第二行文字', [], 0, 8);
    expect(res.action).toBe('added');
    expect(res.spans).toEqual([
      { start: 0, end: 5 },
      { start: 6, end: 8 },
    ]);
  });

  it('单个空位太长 → 拒绝', () => {
    const long = '啊'.repeat(MAX_SPAN + 1);
    const res = addSpan(long, [], 0, long.length);
    expect(res.action).toBe('rejected');
    expect(res.reason).toBe('tooLong');
  });

  it('挖完剩下的可见文字太少 → 拒绝', () => {
    const text = '甲乙丙丁';
    const res = addSpan(text, [], 0, text.length - (MIN_VISIBLE - 1));
    expect(res.action).toBe('rejected');
    expect(res.reason).toBe('visible');
  });
});

describe('removeSpan / visibleLength', () => {
  it('点中空位就还原', () => {
    const spans = [{ start: 0, end: 2 }];
    expect(removeSpan(spans, 0, 2)).toEqual([]);
  });

  it('没点中什么都不动', () => {
    const spans = [{ start: 0, end: 2 }];
    expect(removeSpan(spans, 3, 5)).toEqual(spans);
  });

  it('可见字数 = 总字数 - 所有空位字数', () => {
    expect(visibleLength('甲乙丙丁', [{ start: 0, end: 2 }])).toBe(2);
  });
});
