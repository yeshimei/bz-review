import { beforeEach, describe, expect, it, vi } from 'vitest';

/* 2026-11-22：协议适配从 bz 主仓搬过来之后，Claude 那档才真的能发请求。
   这组测试钉住两套协议的四点差异（端点 / 鉴权 / 报文 / 流帧语义），
   以及「流式失败退回 requestUrl」在 anthropic 上同样成立。 */

const { requestUrlMock } = vi.hoisted(() => ({ requestUrlMock: vi.fn() }));

vi.mock('obsidian', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, requestUrl: requestUrlMock };
});

import { createAI, resetAIProviderCache, setAISettingsProvider } from '../src/core/ai';

function useProvider(id: string, patch: Record<string, unknown> = {}): void {
  setAISettingsProvider(() => ({
    aiProvider: id,
    aiApiKeys: { anthropic: 'sk-ant-test', kimi: 'sk-kimi-test' },
    aiModelOverrides: { anthropic: 'claude-haiku-5-5', kimi: 'kimi-k3' },
    aiMaxTokensOverrides: {},
    aiThinkingOverrides: {},
    ...patch,
  }));
  resetAIProviderCache();
}

/** 把一段 SSE 文本包成 fetch 的响应 */
function sseResponse(frames: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const f of frames) controller.enqueue(enc.encode(f));
      controller.close();
    },
  });
  return { ok: true, status: 200, body, json: async () => ({}) } as unknown as Response;
}

describe('AI 协议适配（anthropic / openai 两家同源）', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    requestUrlMock.mockReset();
    /* ai.ts 走 `window.fetch` / `window.setTimeout`（Obsidian 弹窗窗口兼容），
       node 里没有 window——直接指回全局，stubGlobal('fetch') 才同时生效。 */
    vi.stubGlobal('window', globalThis);
  });

  it('anthropic：走 /messages、x-api-key，system 抽到顶层', async () => {
    useProvider('anthropic');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: null,
      json: async () => ({ content: [{ type: 'text', text: '好' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const text = await createAI().prompt('只回一个字：好');
    expect(text).toBe('好');
    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers['x-api-key']).toBe('sk-ant-test');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
    expect(init.headers.Authorization).toBeUndefined();
    const body = JSON.parse(init.body) as { messages: Array<{ role: string }>; system?: string; max_tokens?: number };
    expect(body.system).toBeUndefined(); // 单条 user 时没有 system
    expect(body.messages.map((m) => m.role)).toEqual(['user']);
    expect(body.max_tokens).toBeGreaterThan(0);
  });

  it('anthropic 流式：读 content_block_delta，message_stop 收尾', async () => {
    useProvider('anthropic');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        sseResponse([
          'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"你"}}\n\n',
          'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"好"}}\n\n',
          'event: message_stop\ndata: {"type":"message_stop"}\n\n',
        ]),
      ),
    );
    const pieces: string[] = [];
    const svc = createAI();
    const text = await svc.prompt('x', undefined, { onDelta: (d: string) => pieces.push(d) });
    expect(text).toBe('你好');
    expect(pieces).toEqual(['你', '好']);
  });

  it('openai 兼容：仍是 /chat/completions + Bearer（旧通道零变化）', async () => {
    useProvider('kimi');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: null,
      json: async () => ({ choices: [{ message: { content: '好' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await createAI().prompt('x');
    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe('https://api.moonshot.cn/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer sk-kimi-test');
  });

  it('anthropic：fetch 失败退回 requestUrl，代发也走 /messages', async () => {
    useProvider('anthropic');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    requestUrlMock.mockResolvedValue({
      status: 200,
      text: JSON.stringify({ content: [{ type: 'text', text: '代发' }] }),
    });
    const text = await createAI().prompt('x');
    expect(text).toBe('代发');
    const opts = requestUrlMock.mock.calls[0][0] as { url: string; headers: Record<string, string> };
    expect(opts.url).toBe('https://api.anthropic.com/v1/messages');
    expect(opts.headers['x-api-key']).toBe('sk-ant-test');
  });
});
