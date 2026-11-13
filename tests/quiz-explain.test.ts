import { describe, expect, it } from 'vitest';
import { sprintQuestionHtml } from '../src/review/render';

/** 最小题面（只喂 sprintQuestionHtml 会读的字段） */
const q = (explain?: string): any => ({
  question: '题干',
  options: ['A', 'B', 'C', 'D'],
  correctIndices: [0],
  explain,
});
const entry: any = { questions: [q()], doneCount: 0 };

describe('冲刺题面：解析与「停住」', () => {
  it('答对且有解析：解析亮出来，并给「下一题」——不自动跳走', () => {
    const html = sprintQuestionHtml(entry, q('因为杭州是南宋都城'), {
      answered: true, sel: [0], lastCorrect: true, remaining: 2,
    });
    expect(html).toContain('因为杭州是南宋都城');
    expect(html).toContain('data-action="next"');
  });

  it('答对且没解析：不显示解析、也不给按钮（0.8s 自动跳）', () => {
    const html = sprintQuestionHtml(entry, q(), {
      answered: true, sel: [0], lastCorrect: true, remaining: 2,
    });
    expect(html).not.toContain('bzrv-sprint-explain');
    expect(html).not.toContain('data-action="next"');
  });

  it('本篇最后一题答对且有解析：给「结束并结算」，不让人卡在最后一题', () => {
    const html = sprintQuestionHtml(entry, q('解析'), {
      answered: true, sel: [0], lastCorrect: true, remaining: 0,
    });
    expect(html).toContain('data-action="note"');
  });

  it('答错：解析 + 下一题（行为不变）', () => {
    const html = sprintQuestionHtml(entry, q('解析'), {
      answered: true, sel: [1], lastCorrect: false, remaining: 1,
    });
    expect(html).toContain('解析');
    expect(html).toContain('data-action="next"');
  });

  it('未作答：不露解析', () => {
    const html = sprintQuestionHtml(entry, q('解析'), {
      answered: false, sel: [], lastCorrect: false, remaining: 1,
    });
    expect(html).not.toContain('bzrv-sprint-explain');
  });
});
