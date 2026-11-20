/**
 * Anki 文本导入（2026-11-20，探索组）：TSV 基础卡 + {{c1::挖空}} 转成
 * 本仓的 {{n}} + blanks。纯函数，钉住格式转换口径。
 */
import { describe, expect, it } from 'vitest';
import { parseAnkiCards } from '../src/review/anki-cards';

describe('parseAnkiCards：Anki 导出 → 本仓卡片', () => {
  it('Tab 分隔的问答行认成抽认卡', () => {
    const out = parseAnkiCards('中国的首都是哪里？\t北京', 'decks/city.txt');
    expect(out).toHaveLength(1);
    expect(out[0].syntax).toBe('qa');
    expect(out[0].card.mode).toBe('flashcard');
    expect(out[0].card.qa?.q).toBe('中国的首都是哪里？');
    expect(out[0].card.qa?.a).toBe('北京');
    expect(out[0].card.displayTitle).toBe('中国的首都是哪里？');
  });

  it('{{c1::答案}} 转成 {{1}} + blanks，认成挖空卡', () => {
    const out = parseAnkiCards('{{c1::北京}}是中国的首都', 'decks/city.tsv');
    expect(out).toHaveLength(1);
    expect(out[0].syntax).toBe('cloze');
    expect(out[0].card.mode).toBe('cloze');
    expect(out[0].card.cloze?.text).toBe('{{1}}是中国的首都');
    expect(out[0].card.cloze?.blanks).toEqual(['北京']);
  });

  it('多个空按出现顺序重编号（忽略 Anki 原编号与提示）', () => {
    const out = parseAnkiCards('{{c2::B}} 和 {{c1::A::提示词}}', 'x.txt');
    expect(out[0].card.cloze?.text).toBe('{{1}} 和 {{2}}');
    expect(out[0].card.cloze?.blanks).toEqual(['B', 'A']);
  });

  it('跳过空行、注释头、背面为空的行', () => {
    const raw = ['#separator:Tab', '', '只有正面\t', '\t只有背面', '问\t答'].join('\n');
    const out = parseAnkiCards(raw, 'x.txt');
    expect(out).toHaveLength(1);
    expect(out[0].card.qa?.q).toBe('问');
  });

  it('key 带来源与行号，同一行不重复', () => {
    const out = parseAnkiCards('问\t答', 'decks/a.txt');
    expect(out[0].card.key).toContain('anki:decks/a.txt#');
  });

  it('书名取文件名，挖空卡的 displayTitle 去掉 {{1}} 标记', () => {
    const out = parseAnkiCards('{{c1::爱因斯坦}}提出了相对论', '物理.md.txt');
    expect(out[0].card.bookTitle).toBe('物理.md');
    expect(out[0].card.displayTitle).toBe('提出了相对论');
  });
});
