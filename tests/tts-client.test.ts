/**
 * 听卡片的 TTS 客户端纯层。
 *
 * bz-review 无法反向调用 bz Reader 的 TTS（reviewApi 只有 5 个方法），
 * 所以这里自建 OpenAI 兼容客户端：地址归一、请求体、音色列表、缓存键、错误分类。
 * 真网络请求走 requestUrl，不在单测里碰。
 */
import { describe, expect, it } from 'vitest';
import {
  cacheKeyOf,
  parseVoiceList,
  speechBody,
  speechEndpoint,
  ttsErrorKind,
  ttsMimeOf,
  voicesEndpoint,
  type TtsConfig,
} from '../src/core/tts-client';

const CFG: TtsConfig = {
  url: 'http://127.0.0.1:5000/',
  model: 'CosyVoice-300M-SFT',
  voice: '中文女',
  format: 'mp3',
};

describe('TTS · 地址归一', () => {
  it('服务地址拼到 /v1/audio/speech，去掉末尾斜杠', () => {
    expect(speechEndpoint(CFG.url)).toBe('http://127.0.0.1:5000/v1/audio/speech');
  });

  it('已经带 /v1 的地址不重复拼', () => {
    expect(speechEndpoint('http://x/v1/')).toBe('http://x/v1/audio/speech');
  });

  it('音色列表带模型参数，没模型就不带', () => {
    expect(voicesEndpoint(CFG.url, CFG.model)).toContain('model=');
    expect(voicesEndpoint(CFG.url)).not.toContain('model=');
  });

  it('没配地址时不造出相对 URL', () => {
    expect(speechEndpoint('')).toBe('');
  });
});

describe('TTS · 请求体', () => {
  it('字段按 OpenAI 口径：input 不是 text', () => {
    const body = speechBody('你好', CFG);
    expect(body.input).toBe('你好');
    expect(body.response_format).toBe('mp3');
    expect(body.voice).toBe('中文女');
    expect(body.model).toBe('CosyVoice-300M-SFT');
  });

  it('音色和模型为空就不发这两个字段', () => {
    const body = speechBody('你好', { url: 'http://x' });
    expect(body).not.toHaveProperty('voice');
    expect(body).not.toHaveProperty('model');
    expect(body.response_format).toBe('mp3');
  });

  it('mime 只认 mp3/wav，其它回落到 mp3', () => {
    expect(ttsMimeOf('wav')).toBe('audio/wav');
    expect(ttsMimeOf('flac' as any)).toBe('audio/mpeg');
  });
});

describe('TTS · 音色列表解析', () => {
  it('兼容 {voices:[…]}、裸数组与 [{id}] 三种形状', () => {
    expect(parseVoiceList({ voices: ['中文女', '中文男'] })).toEqual(['中文女', '中文男']);
    expect(parseVoiceList(['中文女'])).toEqual(['中文女']);
    expect(parseVoiceList({ voices: [{ id: '中文女' }] })).toEqual(['中文女']);
  });

  it('[{name}] 也能认', () => {
    expect(parseVoiceList([{ name: '粤语女' }])).toEqual(['粤语女']);
  });

  it('坏数据给空数组，不让设置页开天窗', () => {
    expect(parseVoiceList(null)).toEqual([]);
    expect(parseVoiceList({ nope: 1 })).toEqual([]);
  });
});

describe('TTS · 缓存键与错误分类', () => {
  it('同文本同配置同键，文本变了就换键', () => {
    expect(cacheKeyOf('你好', CFG)).toBe(cacheKeyOf('你好', CFG));
    expect(cacheKeyOf('你好', CFG)).not.toBe(cacheKeyOf('你坏', CFG));
  });

  it('音色或地址变了也不能复用旧音频', () => {
    expect(cacheKeyOf('你好', CFG)).not.toBe(cacheKeyOf('你好', { ...CFG, voice: '中文男' }));
    expect(cacheKeyOf('你好', CFG)).not.toBe(cacheKeyOf('你好', { ...CFG, url: 'http://y' }));
  });

  it('HTTP 状态归类给人话提示用', () => {
    expect(ttsErrorKind(404)).toBe('config');
    expect(ttsErrorKind(401)).toBe('unauthorized');
    expect(ttsErrorKind(429)).toBe('rate');
    expect(ttsErrorKind(500)).toBe('busy');
    expect(ttsErrorKind(200)).toBe('unknown');
  });
});
