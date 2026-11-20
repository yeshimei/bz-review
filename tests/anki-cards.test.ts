/**
 * Anki「笔记纯文本」导出 → 本仓卡片（2026-11-20）。
 *
 * 钉住「完整导入」这条底线：文件头声明列、引号内换行、网页格式、媒体引用、
 * 多挖空拆卡、正反模板、图片遮挡跳过、稳定 key 去重。纯函数，不碰 DOM/Obsidian。
 */
import { describe, expect, it } from 'vitest';
import { parseAnkiCards, parseAnkiFile } from '../src/review/anki-cards';

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

  it('多挖空按编号拆成多张卡，每张只留自己那个空（与 Anki 卡数一致）', () => {
    const out = parseAnkiCards('{{c1::北京}}是{{c2::中国}}的首都', 'x.txt');
    expect(out).toHaveLength(2);
    expect(out[0].card.cloze?.text).toBe('{{1}}是中国的首都');
    expect(out[0].card.cloze?.blanks).toEqual(['北京']);
    expect(out[1].card.cloze?.text).toBe('北京是{{1}}的首都');
    expect(out[1].card.cloze?.blanks).toEqual(['中国']);
  });

  it('挖空提示词 ::提示 不进答案；Back Extra 第二列并进正文', () => {
    const raw = ['#notetype:Cloze', '{{c1::爱因斯坦::物理学家}}提出了相对论\t补充：1921 年诺奖'].join('\n');
    const out = parseAnkiCards(raw, 'x.txt');
    expect(out).toHaveLength(1);
    expect(out[0].card.cloze?.blanks).toEqual(['爱因斯坦']);
    expect(out[0].card.text).toContain('补充：1921 年诺奖');
    expect(out[0].card.text).not.toContain('物理学家');
    expect(out[0].card.text).toContain('爱因斯坦');
  });

  it('跳过空行、注释头、正面/背面为空的行', () => {
    const raw = ['#separator:Tab', '', '只有正面\t', '\t只有背面', '问\t答'].join('\n');
    const { cards, stats } = parseAnkiFile(raw, 'x.txt');
    expect(cards).toHaveLength(1);
    expect(cards[0].card.qa?.q).toBe('问');
    expect(stats.skipped.emptyFront).toBe(1);
    expect(stats.skipped.emptyBack).toBe(1);
  });

  it('文件头声明的牌组/笔记类型/标签列被剔除，不当成正面', () => {
    const raw = [
      '#separator:Tab',
      '#notetype column:2',
      '#deck column:1',
      '#tags column:3',
      '我的牌组\t基础\t标签1 标签2\t问题正文\t答案正文',
    ].join('\n');
    const { cards, stats } = parseAnkiFile(raw, 'x.txt');
    expect(cards).toHaveLength(1);
    expect(cards[0].card.qa?.q).toBe('问题正文');
    expect(cards[0].card.qa?.a).toBe('答案正文');
    expect(cards[0].card.bookTitle).toBe('我的牌组');
    expect(cards[0].card.comment).toBe('标签：标签1 标签2');
    expect(stats.tagged).toBe(1);
  });

  it('引号包住的字段可含换行与分隔符，双引号自身写成两个双引号', () => {
    const raw = ['#separator:Tab', '问题\t"第一行\n第二行，带逗号\t还带Tab"\t标签A'].join('\n');
    const out = parseAnkiCards(raw, 'x.txt');
    expect(out).toHaveLength(1);
    expect(out[0].card.qa?.a).toContain('第一行');
    expect(out[0].card.qa?.a).toContain('第二行，带逗号\t还带Tab');
  });

  it('逗号/分号/竖线分隔符按文件头识别，第一列仍是正面', () => {
    expect(parseAnkiCards('#separator:comma\n问,答', 'x.txt')[0].card.qa).toMatchObject({ q: '问', a: '答' });
    expect(parseAnkiCards('#separator:semicolon\n问;答', 'x.txt')[0].card.qa).toMatchObject({ q: '问', a: '答' });
    expect(parseAnkiCards('#separator:pipe\n问|答', 'x.txt')[0].card.qa).toMatchObject({ q: '问', a: '答' });
  });

  it('网页格式转纯文字：<br>/</div> 换行、实体解码、标签剥掉', () => {
    const raw = ['#html:true', '<div>问题&nbsp;1<br>第二行</div>\t答案 <b>加粗</b> &amp; 结束'].join('\n');
    const out = parseAnkiCards(raw, 'x.txt');
    expect(out).toHaveLength(1);
    expect(out[0].card.qa?.q).toBe('问题 1\n第二行');
    expect(out[0].card.qa?.a).toBe('答案 加粗 & 结束');
  });

  it('图片与音频引用留可读占位并报数（文本导出不带文件）', () => {
    const raw = ['#html:true', '<img src="pics/a.png">这是什么\t听 [sound:audio/b.mp3]'].join('\n');
    const { cards, stats } = parseAnkiFile(raw, 'x.txt');
    expect(stats.media).toBe(2);
    expect(stats.mediaNames).toBe(2);
    expect(cards[0].card.qa?.q).toContain('[图片：a.png]');
    expect(cards[0].card.qa?.a).toContain('[音频：b.mp3]');
    expect(cards[0].mediaRefs).toEqual(['a.png', 'b.mp3']);
  });

  it('非 HTML 行的 [sound:…] 也收进媒体文件名', () => {
    const { stats, cards } = parseAnkiFile('听单词\t[sound:word.mp3]', 'x.txt');
    expect(stats.mediaNames).toBe(1);
    expect(cards[0].mediaRefs).toEqual(['word.mp3']);
  });

  it('正反模板出正反两张卡，key 不同（内容不重复）', () => {
    const raw = ['#notetype:Basic (and reversed card)', '苹果\tapple'].join('\n');
    const { cards, stats } = parseAnkiFile(raw, 'x.txt');
    expect(cards).toHaveLength(2);
    expect(stats.reversed).toBe(1);
    expect(cards[0].card.qa).toMatchObject({ q: '苹果', a: 'apple' });
    expect(cards[1].card.qa).toMatchObject({ q: 'apple', a: '苹果' });
    expect(cards[0].card.key).not.toBe(cards[1].card.key);
  });

  it('图片遮挡卡按图片+文字导入，不再跳过；区域留空待补', () => {
    const raw = [
      '#notetype:Image Occlusion',
      '<img src="pics/diagram.png">\t{{c1::长江}}是{{c2::中国}}最长的河',
    ].join('\n');
    const { cards, stats } = parseAnkiFile(raw, 'x.txt');
    expect(cards).toHaveLength(1);
    expect(stats.occlusion).toBe(1);
    expect(cards[0].card.mode).toBe('occlusion');
    expect(cards[0].card.occlusion?.regions).toEqual([]);
    expect(cards[0].card.occlusion?.image).toBe('diagram.png');
    /* 挖空标记还原成答案文字，图片名也留在正文里（配对成功后由导入层替换） */
    expect(cards[0].card.text).toContain('长江');
    expect(cards[0].card.text).toContain('中国');
    expect(cards[0].mediaRefs).toEqual(['diagram.png']);
  });

  it('key 是内容/GUID 稳定哈希，不随来源路径与行号变化（重新导出不重复）', () => {
    const a = parseAnkiCards('问\t答', 'decks/a.txt');
    const b = parseAnkiCards('问\t答', 'decks/renamed.txt');
    expect(a[0].card.key).toBe(b[0].card.key);
    const g1 = parseAnkiCards('#guid column:1\nguid-x\t问\t答', 'a.txt');
    const g2 = parseAnkiCards('#guid column:1\nguid-x\t问\t答', 'b.txt');
    expect(g1[0].card.key).toBe('anki:guid:guid-x');
    expect(g1[0].card.key).toBe(g2[0].card.key);
  });

  it('书名取牌组名，其次取文件名；挖空卡 displayTitle 去掉 {{1}} 标记', () => {
    const cloze = parseAnkiCards('{{c1::爱因斯坦}}提出了相对论', '物理.md.txt');
    expect(cloze[0].card.bookTitle).toBe('物理.md');
    expect(cloze[0].card.displayTitle).toBe('提出了相对论');
    const deck = parseAnkiFile('#deck column:1\n物理\t问\t答', 'x.txt');
    expect(deck.cards[0].card.bookTitle).toBe('物理');
  });

  it('stats 分原因记数：records/notes/cards/qa/cloze 一致', () => {
    const raw = ['#separator:Tab', '问1\t答1', '{{c1::甲}}和{{c2::乙}}\t', '', '只有一列'].join('\n');
    const { stats } = parseAnkiFile(raw, 'x.txt');
    expect(stats.records).toBe(3);
    expect(stats.notes).toBe(2);
    expect(stats.cards).toBe(3);
    expect(stats.qa).toBe(1);
    expect(stats.cloze).toBe(2);
    expect(stats.multiCloze).toBe(1);
  });
});
