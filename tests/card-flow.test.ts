import { describe, expect, it, vi } from 'vitest';

/* card-flow 经 flow-dialog 间接 import obsidian；node 单测里给最小壳让模块能加载。
   被测的是「要不要弹确认框」这一层纯判定，不碰宿主 API。 */
vi.mock('obsidian', () => ({
  Modal: class {},
  Setting: class {},
  requestUrl: async () => ({ status: 200, arrayBuffer: () => new ArrayBuffer(0) }),
  setIcon: () => {},
  Platform: {},
  ItemView: class {},
  Plugin: class {},
  Notice: class {},
}));

import { confirmBeforeRound, needsCardConfirm } from '../src/review/card-flow';
import type { ReviewItem } from '../src/review/data';

describe('开卡前确认只留给做题卡', () => {
  it('抽认卡不需要确认：默认正面一句话，点看答案才出原文', () => {
    expect(needsCardConfirm('flashcard')).toBe(false);
  });

  it('做题卡仍要确认：可以先把不想要的题删掉', () => {
    expect(needsCardConfirm('quiz')).toBe(true);
  });

  it('其余制卡方式也不弹确认', () => {
    for (const m of ['plain', 'cloze', 'context']) {
      expect(needsCardConfirm(m as never)).toBe(false);
    }
  });

  it('抽认卡直接放行，不会去要模型重新生成问句', async () => {
    const regen = vi.fn();
    const res = await confirmBeforeRound({
      item: {} as ReviewItem,
      mode: 'flashcard',
      regenerateAsk: regen as never,
    });
    expect(res).toEqual({ go: true });
    expect(regen).not.toHaveBeenCalled();
  });
});
