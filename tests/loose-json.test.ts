import { describe, expect, it } from 'vitest';
import { parseLooseJson } from '../src/review/loose-json';

describe('宽容 JSON 解析', () => {
  it('合法 JSON 原样解析', () => {
    expect(parseLooseJson('{"a":1,"b":[1,2]}')).toEqual({ a: 1, b: [1, 2] });
  });

  it('数组/对象末尾的多余逗号能修好', () => {
    expect(parseLooseJson('["A","B","C",]')).toEqual(['A', 'B', 'C']);
    expect(parseLooseJson('{"a":1,}')).toEqual({ a: 1 });
  });

  it('字符串里的 ,] 不能被误删（旧正则会把 "a,]" 篡改掉）', () => {
    expect(parseLooseJson('["a,]","b",]')).toEqual(['a,]', 'b']);
    expect(parseLooseJson('["含 } 括号","x",]')).toEqual(['含 } 括号', 'x']);
  });

  it('转义引号后的字符不干扰字符串判定', () => {
    expect(parseLooseJson('["he said \\"hi,]\\"","b",]')).toEqual(['he said "hi,]"', 'b']);
  });

  it('别的语法错误照样失败，不猜不补', () => {
    expect(parseLooseJson('["a" "b"]')).toBeNull();
    expect(parseLooseJson('not json')).toBeNull();
  });
});
