import { describe, expect, it } from 'vitest';
import { parseMarkdownCards } from '../src/review/md-cards';

const parse = (md: string, path = '笔记/示例.md') => parseMarkdownCards(md, path, '示例');

describe('从 Markdown 认卡片', () => {
  it('`问题 :: 答案` 认成抽认卡', () => {
    const cards = parse('- 什么是闭包 :: 能访问外层作用域的函数');
    expect(cards).toHaveLength(1);
    expect(cards[0].syntax).toBe('qa');
    expect(cards[0].card.qa?.q).toBe('什么是闭包');
    expect(cards[0].card.qa?.a).toBe('能访问外层作用域的函数');
  });

  it('全角冒号写法也认（中文输入法打出来就是两个冒号）', () => {
    expect(parse('问题：：答案')).toHaveLength(1);
  });

  it('`{{挖空}}` 认成填空卡，答案进空位', () => {
    const cards = parse('函数式编程的核心是 {{不可变}} 数据');
    expect(cards[0].syntax).toBe('cloze');
    expect(cards[0].card.cloze?.blanks).toEqual(['不可变']);
    expect(cards[0].card.cloze?.text).toContain('{{1}}');
  });

  it('代码块、frontmatter、行内代码里的语法不算卡片', () => {
    const md = ['---', 'title: x', '---', '', '```', 'a :: b', '```', '', '正文 A :: B'].join('\n');
    const cards = parse(md);
    expect(cards).toHaveLength(1);
    expect(cards[0].card.qa?.q).toBe('正文 A');
  });

  it('钥匙按文件路径 + 序号，同一篇再导入也不会重复排卡', () => {
    const cards = parse('A :: 1\nB :: 2');
    expect(cards.map((c) => c.card.key)).toEqual(['md:笔记/示例.md#0', 'md:笔记/示例.md#1']);
  });

  it('只有问没有答、或空挖空不认（宁可少一张，也不导一张没法背的卡）', () => {
    expect(parse('问题 ::')).toHaveLength(0);
    expect(parse('{{}}')).toHaveLength(0);
    expect(parse('')).toHaveLength(0);
  });

  it('书名用笔记标题，章节给问题前 40 字，带原文链接', () => {
    const [c] = parse('问题 :: 答案');
    expect(c.card.bookTitle).toBe('示例');
    expect(c.card.backlink).toContain('obsidian://');
  });
});
