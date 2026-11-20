import { describe, expect, it } from 'vitest';
import {
  clipTitle,
  draftToInput,
  markWizardStates,
  modeNeedsAI,
  WIZARD_MODES,
} from '../src/review/card-wizard-model';
import type { WizardDraft } from '../src/review/card-wizard-model';

function base(mode: WizardDraft['mode'], extra: Partial<WizardDraft> = {}): WizardDraft {
  return {
    key: 'k1',
    bookTitle: '围城',
    chapterTitle: '第一章',
    text: '婚姻像一座城。',
    mode,
    front: '',
    title: '',
    questions: [],
    cloze: null,
    ...extra,
  };
}

describe('WIZARD_MODES：统一制卡只有这四种', () => {
  it('顺序与界面一致：全文回忆 / 抽认卡 / 做题 / 挖空', () => {
    expect([...WIZARD_MODES]).toEqual(['plain', 'flashcard', 'quiz', 'cloze']);
  });

  it('只有全文回忆不用 AI', () => {
    expect(modeNeedsAI('plain')).toBe(false);
    expect(modeNeedsAI('flashcard')).toBe(true);
    expect(modeNeedsAI('quiz')).toBe(true);
    expect(modeNeedsAI('cloze')).toBe(true);
  });
});

describe('draftToInput：确认后的草稿 → Review 入库载荷', () => {
  it('全文回忆只交原文', () => {
    const p = draftToInput(base('plain'));
    expect(p.mode).toBe('plain');
    expect(p.qa).toBeUndefined();
    expect(p.cloze).toBeUndefined();
    expect(p.questions).toBeUndefined();
  });

  it('抽认卡：正面问句进 qa，背面是原文', () => {
    const p = draftToInput(base('flashcard', { front: '婚姻被比作什么？' }));
    expect(p.qa).toEqual({ q: '婚姻被比作什么？', a: '婚姻像一座城。' });
  });

  it('做题卡：题目转成 Review 的 q/options/correct 形状，并带列表标题', () => {
    const p = draftToInput(base('quiz', {
      title: '围城比喻',
      questions: [{
        question: '婚姻像什么？',
        options: ['城', '船', '网', '山'],
        correctIndices: [0],
        explain: '原文如此',
      }],
    }));
    expect(p.questions).toEqual([
      { q: '婚姻像什么？', options: ['城', '船', '网', '山'], correct: [0], explain: '原文如此' },
    ]);
    expect(p.displayTitle).toBe('围城比喻');
  });

  it('挖空卡：交挖空文本与答案，列表标题用去掉空位的文字', () => {
    const p = draftToInput(base('cloze', {
      cloze: { text: '婚姻像{{1}}城。', blanks: ['一座'] },
    }));
    expect(p.cloze).toEqual({ text: '婚姻像{{1}}城。', blanks: ['一座'] });
    expect(p.displayTitle).toBe('婚姻像城。');
  });

  it('出处的可选字段只在有的时候带上', () => {
    const p = draftToInput(base('plain', {
      comment: '想法',
      backlink: 'obsidian://x',
      sourceNote: { path: 'a.md', from: 1, to: 5 },
    }));
    expect(p.comment).toBe('想法');
    expect(p.backlink).toBe('obsidian://x');
    expect(p.sourceNote).toEqual({ path: 'a.md', from: 1, to: 5 });
  });
});

describe('markWizardStates：确认题面时先标出「已在计划 / 超出上限」', () => {
  it('已在计划优先，其余按剩余额度分新增与超额', () => {
    const states = markWizardStates(['a', 'b', 'c'], new Set(['a']), 1);
    expect(states).toEqual(['exists', 'new', 'over']);
  });

  it('额度无限时全部算新增', () => {
    expect(markWizardStates(['a', 'b'], new Set(), Infinity)).toEqual(['new', 'new']);
  });
});

describe('clipTitle：列表短标题', () => {
  it('去掉换行与多余空白', () => {
    expect(clipTitle('  第一行\n第二行  ')).toBe('第一行 第二行');
  });

  it('超长截断并加省略号', () => {
    expect(clipTitle('啊'.repeat(50), 10)).toBe('啊'.repeat(10) + '…');
  });
});
