/**
 * 共享 bz Reader 的 AI 配置（core/ai-share.ts）。
 *
 * 三条口径钉住：能映射、半成品不借、自己配好的不借。
 */
import { describe, expect, it } from 'vitest';
import { borrowAiFromReader, ownAiConfigured, readablePatchUsable, readerDataPath } from '../src/core/ai-share';

describe('borrowAiFromReader：Reader 的设置 → 本插件 AI 字段', () => {
  it('自定义通道：地址 / 密钥 / 模型三件套翻过来', () => {
    const patch = borrowAiFromReader({
      ai: {
        provider: 'custom',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-x',
        model: 'my-model',
        customProtocol: 'anthropic',
      },
    });
    expect(patch).not.toBeNull();
    expect(patch!.aiProvider).toBe('custom');
    expect(patch!.aiCustomEndpoint).toBe('https://api.example.com/v1');
    expect(patch!.aiCustomApiKey).toBe('sk-x');
    expect(patch!.aiModelOverrides?.custom).toBe('my-model');
    expect(patch!.aiCustomProtocol).toBe('anthropic');
  });

  it('注册表服务商：密钥按 id 搬，模型覆盖保留', () => {
    const patch = borrowAiFromReader({
      ai: { provider: 'deepseek', apiKeys: { deepseek: 'sk-r' }, modelOverrides: { deepseek: 'deepseek-chat' } },
    });
    expect(patch!.aiProvider).toBe('deepseek');
    expect(patch!.aiApiKeys?.deepseek).toBe('sk-r');
    expect(patch!.aiModelOverrides?.deepseek).toBe('deepseek-chat');
  });

  it('真机踩坑：Reader 的 data.json 把设置包在 settings 里', () => {
    const patch = borrowAiFromReader({
      version: 1,
      settings: { ai: { provider: 'custom', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-real', model: 'deepseek-flash' } },
    });
    expect(patch!.aiCustomApiKey).toBe('sk-real');
    expect(patch!.aiModelOverrides?.custom).toBe('deepseek-flash');
  });

  it('空服务商 + 有地址：当自定义通道', () => {
    const patch = borrowAiFromReader({ ai: { baseUrl: 'https://x.test/v1', apiKey: 'k' } });
    expect(patch!.aiProvider).toBe('custom');
  });

  it('没填任何东西 / 结构不对：没有可借的', () => {
    expect(borrowAiFromReader({})).toBeNull();
    expect(borrowAiFromReader({ ai: {} })).toBeNull();
    expect(borrowAiFromReader(null)).toBeNull();
    expect(borrowAiFromReader('nope')).toBeNull();
  });

  it('选了服务商但没密钥：不借半成品', () => {
    expect(borrowAiFromReader({ ai: { provider: 'openai' } })).toBeNull();
  });

  it('本地服务免鉴权：Ollama 没密钥也借', () => {
    const patch = borrowAiFromReader({ ai: { provider: 'ollama', modelOverrides: { ollama: 'qwen3' } } });
    expect(patch).not.toBeNull();
    expect(readablePatchUsable(patch!)).toBe(true);
  });
});

describe('readerDataPath：真机上 manifest.dir 有两种形态', () => {
  it('manifest.dir 已是全路径：不能重复拼 configDir/plugins', () => {
    expect(readerDataPath('.obsidian', '.obsidian/plugins/bz-reader')).toBe(
      '.obsidian/plugins/bz-reader/data.json'
    );
  });

  it('manifest.dir 只是裸目录名：照旧补前缀', () => {
    expect(readerDataPath('.obsidian', 'bz-reader')).toBe('.obsidian/plugins/bz-reader/data.json');
  });
});

describe('ownAiConfigured：自己的配置够不够发请求', () => {
  const base = { aiApiKeys: {}, aiModelOverrides: {} };

  it('没选服务商 = 没配', () => {
    expect(ownAiConfigured({ ...base, aiProvider: '' })).toBe(false);
  });

  it('云端服务有密钥 = 配好', () => {
    expect(ownAiConfigured({ ...base, aiProvider: 'openai', aiApiKeys: { openai: 'sk-1' } })).toBe(true);
  });

  it('老的单槽密钥也算配好', () => {
    expect(ownAiConfigured({ ...base, aiProvider: 'deepseek', deepseekApiKey: 'sk-legacy' })).toBe(true);
  });

  it('自定义通道缺密钥 = 没配', () => {
    expect(ownAiConfigured({ ...base, aiProvider: 'custom', aiCustomEndpoint: 'https://x.test' })).toBe(false);
  });
});
