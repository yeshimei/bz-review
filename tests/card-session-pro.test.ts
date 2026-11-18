/**
 * 听卡片 / 跳回原文的纯逻辑（review/card-session.ts）
 *
 * 这两块的 UI 都走 innerHTML 整段替换，真机点击在 node 里不好测；所以把
 * 「按钮文案 / 朗读文本 / 按钮要不要出现、以什么形态出现」抽成纯函数，
 * 这里只盯这些口径：能力门控不能露出真入口，超限要能给出人话提示。
 */
import { describe, expect, it, vi } from 'vitest';

/* card-session 会经 card-edit / core:http 间接 import obsidian；node 单测里给个最小壳，
   仅让模块加载通过。被测的是下面不碰 obsidian / DOM 的纯函数。 */
vi.mock('obsidian', () => ({
  Modal: class {},
  Setting: class {},
  requestUrl: async () => ({ status: 200, arrayBuffer: () => new ArrayBuffer(0) }),
  setIcon: () => {},
  Platform: {},
  ItemView: class {},
  Plugin: class {},
}));

import {
  SPEAK_CHAR_LIMIT,
  backButtonHtml,
  speakButtonHtml,
  speakLabelOf,
  speakTextOf,
  type SpeakState,
} from '../src/review/card-session';

describe('朗读按钮文案 · 播放态切换', () => {
  it('三态分别是「听这张 / 准备中… / 停止」', () => {
    expect(speakLabelOf('idle')).toBe('听这张');
    expect(speakLabelOf('loading')).toBe('准备中…');
    expect(speakLabelOf('playing')).toBe('停止');
  });

  it('切换态只换文案，不改变按钮身份与 class', () => {
    for (const state of ['idle', 'loading', 'playing'] as SpeakState[]) {
      const html = speakButtonHtml(true, state);
      expect(html).toContain('data-act="speak"');
      expect(html).not.toContain('data-act="speak-locked"');
      expect(html).toContain('bzrv-cs-speak');
      expect(html).toContain(speakLabelOf(state));
    }
  });
});

describe('朗读文本提取', () => {
  it('优先 AI 问答：问句与答案拼在一起', () => {
    expect(speakTextOf({ text: '划线原文', qa: { q: '这句话在讲什么？', a: '讲记忆' } }).text).toBe(
      '这句话在讲什么？ 讲记忆',
    );
  });

  it('没有问答时用划线原文，去首尾空白', () => {
    expect(speakTextOf({ text: '  划线原文  ' }).text).toBe('划线原文');
  });

  it('空卡不给文本，免得合成一个空请求', () => {
    expect(speakTextOf(null).text).toBe('');
    expect(speakTextOf(undefined).text).toBe('');
    expect(speakTextOf({ text: '  ', qa: { q: ' ', a: '' } }).text).toBe('');
  });

  it('超过 200 字截断并标记，调用方据此给一句人话', () => {
    const long = '字'.repeat(SPEAK_CHAR_LIMIT + 37);
    const v = speakTextOf({ text: long });
    expect(v.truncated).toBe(true);
    expect(v.text.length).toBe(SPEAK_CHAR_LIMIT);
    expect(v.text).toBe('字'.repeat(SPEAK_CHAR_LIMIT));
  });

  it('刚好 200 字不算截断', () => {
    const v = speakTextOf({ text: '字'.repeat(SPEAK_CHAR_LIMIT) });
    expect(v.truncated).toBe(false);
    expect(v.text.length).toBe(SPEAK_CHAR_LIMIT);
  });

  it('limit 可注入', () => {
    expect(speakTextOf({ text: 'abcdef' }, 3)).toEqual({ text: 'abc', truncated: true });
  });
});

describe('喇叭按钮 · 能力门控', () => {
  it('免费档只有拦截按钮，不给真播放入口', () => {
    const html = speakButtonHtml(false);
    expect(html).toContain('data-act="speak-locked"');
    expect(html).not.toContain('data-act="speak"');
    expect(html).toContain('bzrv-cs-speak');
  });

  it('激活后给真播放按钮，默认文案「听这张」', () => {
    const html = speakButtonHtml(true);
    expect(html).toContain('data-act="speak"');
    expect(html).toContain('听这张');
  });

  it('未解锁时不因状态变化露出播放入口', () => {
    for (const state of ['idle', 'loading', 'playing'] as SpeakState[]) {
      const html = speakButtonHtml(false, state);
      expect(html).toContain('data-act="speak-locked"');
      expect(html).not.toContain('data-act="speak"');
    }
  });
});

describe('回到原文按钮 · 形态与门控', () => {
  it('没有链接就不渲染（连免费档拦截按钮也不给）', () => {
    expect(backButtonHtml(false, true)).toBe('');
    expect(backButtonHtml(false, false)).toBe('');
  });

  it('有链接且已解锁：button 而非 a，保留 bzrv-cs-back class', () => {
    const html = backButtonHtml(true, true);
    expect(html).toContain('<button');
    expect(html).toContain('class="bzrv-cs-back"');
    expect(html).toContain('data-act="back"');
    expect(html).not.toContain('href=');
  });

  it('免费档只给拦截按钮', () => {
    const html = backButtonHtml(true, false);
    expect(html).toContain('data-act="back-locked"');
    expect(html).not.toContain('data-act="back"');
    expect(html).toContain('bzrv-cs-back');
  });
});
