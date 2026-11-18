/**
 * 轻量 TTS 客户端（听卡片用）
 *
 * bz-review 无法反向调用 bz Reader 的 TTS——reviewApi 只有 addCards/hasNote/
 * statusOf/quota 五个方法，方向是 Reader 调 Review。所以这里自建 OpenAI 兼容
 * 客户端，协议与 Reader 的本地 CosyVoice 完全一致（input/voice/model/response_format）。
 *
 * 请求必须走 requestUrl 而不是 fetch：本地服务不给 app://obsidian.md 放行跨域头。
 * requestUrl 没有 AbortSignal，"取消"只能做到不等结果，不能真中止在途请求。
 *
 * 纯函数与网络请求分开：单测只碰纯层，动态 import('obsidian') 避免 node 环境解析失败。
 */

export interface TtsConfig {
  /** 本地服务地址，如 http://127.0.0.1:5000 */
  url: string;
  model?: string;
  voice?: string;
  format?: 'mp3' | 'wav';
  apiKey?: string;
}

/** 卡片只有一两句话，不需要整章合成的 120 秒超时 */
export const TTS_LOCAL_TIMEOUT_MS = 30_000;

export type TtsErrorKind = 'config' | 'unauthorized' | 'rate' | 'busy' | 'unknown';

const trimBase = (u: unknown): string => String(u ?? '').trim().replace(/\/+$/, '');

export function speechEndpoint(baseUrl: string): string {
  const base = trimBase(baseUrl);
  if (!base) return '';
  return base.endsWith('/v1') ? `${base}/audio/speech` : `${base}/v1/audio/speech`;
}

export function voicesEndpoint(baseUrl: string, model?: string): string {
  const base = trimBase(baseUrl);
  if (!base) return '';
  const url = base.endsWith('/v1') ? `${base}/audio/voices` : `${base}/v1/audio/voices`;
  const m = String(model ?? '').trim();
  return m ? `${url}?model=${encodeURIComponent(m)}` : url;
}

/** 请求体字段照 OpenAI：input 不是 text；音色/模型为空就不发，让服务端用默认 */
export function speechBody(text: string, cfg: TtsConfig): Record<string, unknown> {
  const body: Record<string, unknown> = {
    input: String(text ?? ''),
    response_format: cfg.format === 'wav' ? 'wav' : 'mp3',
  };
  const model = String(cfg.model ?? '').trim();
  const voice = String(cfg.voice ?? '').trim();
  if (model) body.model = model;
  if (voice) body.voice = voice;
  return body;
}

export function ttsMimeOf(format?: string): string {
  return format === 'wav' ? 'audio/wav' : 'audio/mpeg';
}

/** 兼容服务端的几种音色返回形状；去重、去空白，坏数据给空数组 */
export function parseVoiceList(raw: unknown): string[] {
  const arr = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as any).voices)
      ? (raw as any).voices
      : [];
  const out: string[] = [];
  for (const v of arr) {
    const s =
      typeof v === 'string'
        ? v
        : v && typeof v === 'object'
          ? String((v as any).id ?? (v as any).name ?? '')
          : '';
    const name = s.trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

const hashOf = (s: string): string => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
};

/** 缓存键带引擎前缀与配置指纹：换音色/地址/文本都不能复用旧音频 */
export function cacheKeyOf(text: string, cfg: TtsConfig): string {
  const fmt = cfg.format === 'wav' ? 'wav' : 'mp3';
  return [
    'local',
    fmt,
    hashOf(String(cfg.url ?? '')),
    String(cfg.model ?? ''),
    String(cfg.voice ?? ''),
    hashOf(String(text ?? '')),
  ].join(':');
}

export function ttsErrorKind(status: number): TtsErrorKind {
  if ([400, 404, 422].includes(status)) return 'config';
  if ([401, 403].includes(status)) return 'unauthorized';
  if (status === 429) return 'rate';
  if (status >= 500) return 'busy';
  return 'unknown';
}

export interface Synthesized {
  buf: ArrayBuffer;
  mime: string;
}

/** 真网络请求：只在这里动态引入 obsidian，保证纯层能在 node 单测里跑 */
export async function synthesizeSpeech(text: string, cfg: TtsConfig): Promise<Synthesized> {
  const url = speechEndpoint(cfg.url);
  if (!url) throw new Error('还没配置朗读服务地址，先在设置里填本地 TTS 服务。');
  const { requestUrl } = await import('obsidian');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = String(cfg.apiKey ?? '').trim();
  if (key) headers.Authorization = `Bearer ${key}`;
  const resp = await requestUrl({
    url,
    method: 'POST',
    headers,
    body: JSON.stringify(speechBody(text, cfg)),
    throw: false,
  });
  const status = Number((resp as any)?.status ?? 0);
  if (status < 200 || status >= 300) {
    throw new Error(`朗读服务返回 ${status}（${ttsErrorKind(status)}），请检查设置里的服务地址与音色。`);
  }
  const buf = (resp as any)?.arrayBuffer as ArrayBuffer | undefined;
  if (!buf || buf.byteLength === 0) throw new Error('朗读服务没有返回音频，换个音色或重试。');
  return { buf, mime: ttsMimeOf(cfg.format) };
}
