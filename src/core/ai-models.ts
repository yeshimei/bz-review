/**
 * AI 提供商模型列表拉取（ticket 173「获取模型名」按钮）：
 * 统一 OpenAI 兼容 GET {endpoint}/models（Authorization: Bearer），Ollama 特判 GET {base}/api/tags（无鉴权）。
 * HTTP 通道与 core/ai.ts 请求同口径：fetch 优先，失败回退 requestUrl（无 CORS 限制）。
 * 纯数据层：不触 DOM、不弹 toast（报错文案抛给调用方，由设置页按钮统一提示）。
 * issue 422/ADR-0182：新增向量化模型拉取（fetchEmbeddingModels）——AI 面板「Embedding 模型」行的
 * 「获取模型」按钮消费，端点取第二大脑的 Ollama 服务地址（移动端优先远程地址）。
 */
import { requestUrl } from 'obsidian';
import { getProviderDescriptor, providerKeyLabelOf, providerLabelOf } from './ai';
import type { AIProviderDescriptor } from './ai';
import { resolveProviderId } from './ai-provider-id';
import { isMobileEnv } from './mobile';
import { tryGetSettings } from './settings-provider';
import { t } from '../i18n/strings';

/** OpenAI 兼容 /models 拉取超时（s）：设置页交互场景，8s 未应答即放弃走回退/报错 */
export const MODELS_TIMEOUT_MS = 8000;
/** Ollama /api/tags 拉取超时：本地服务默认 30s（对齐 secondbrain/ollama.ts 的 httpFetch 默认） */
export const OLLAMA_TIMEOUT_MS = 30000;
/** Ollama 服务根地址（注册表 endpoint 为 /v1 兼容面，模型列表端点挂在根） */
const OLLAMA_BASE_URL = 'http://localhost:11434';

/** JSON/第三方响应的结构守卫：先确认是对象，再逐字段 typeof 收窄（全程不引入 any） */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** 数组守卫：把 unknown 收窄为 unknown[]（直接 Array.isArray 会收成 any[]，故包一层） */
function isUnknownArray(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

/** 安全转字符串：密钥字段本就是字符串，非字符串回落空串（避免 String(object) 的 [object Object]） */
function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** 模型列表拉取的响应通道最小面（fetch 与 requestUrl 回退共用同一形状） */
type ModelsAttempt = {
  resp: { ok: boolean; status: number; json: () => Promise<unknown> };
  via: 'fetch' | 'requestUrl';
};

/** 模型选项（选择器展示面：名称 + 来源说明） */
export interface ModelOption {
  id: string;
  detail?: string;
}

/** 拉取通道注入（测试桩；缺省用插件运行时真实实现） */
export interface ModelsFetchDeps {
  /** 最小响应面：ok/status/json（测试桩无需完整 Response；缺省用全局 fetch 形态） */
  fetchFn?: (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
  requestUrlFn?: (opts: { url: string; method: string; headers: Record<string, string>; throw?: boolean }) => Promise<{
    status: number;
    text: string;
  }>;
}

/** 当前 settings 里的服务商描述（注册表查找失败回退缺省服务商，与 ai.ts 解析同口径） */
export function providerDescriptorOf(id: string): AIProviderDescriptor {
  return getProviderDescriptor(id);
}

/** 当前服务商的可拉取端点：自定义读设置里的地址，其余用注册表 endpoint */
function endpointFor(id: string): string {
  const desc = providerDescriptorOf(id);
  if (desc.id === 'custom') {
    return String((tryGetSettings()).aiCustomEndpoint || '').trim().replace(/\/+$/, '');
  }
  return desc.endpoint.replace(/\/+$/, '');
}

/** 当前服务商的 API key（Ollama 本地无鉴权返回空串） */
function keyFor(id: string): string {
  const s = tryGetSettings();
  const desc = providerDescriptorOf(id);
  if (desc.id === 'ollama' || desc.id === 'lmstudio') return '';
  const legacy = desc.apiKeyKey ? s[desc.apiKeyKey] : undefined;
  return asString(legacy) || asString(s.aiApiKeys?.[desc.id]);
}

/** Ollama /api/tags 响应 → 模型 id 列表（Ollama 原生格式，非 OpenAI 兼容面） */
function ollamaModelIds(data: unknown): string[] {
  if (!isRecord(data)) throw new Error(t('ai.error.noModels'));
  const list = data.models;
  if (isUnknownArray(list)) {
    const ids = list.map((m) => (isRecord(m) && typeof m.name === 'string' ? m.name : '')).filter(Boolean);
    if (ids.length) return ids;
  }
  throw new Error(t('ai.error.noModels'));
}

/** OpenAI 兼容 /models 响应 → 模型 id 列表（兼容 data[].id 主格式与 data.models[].name 少数格式） */
function openaiModelIds(data: unknown): string[] {
  if (!isRecord(data)) throw new Error(t('ai.error.noModels'));
  if (isUnknownArray(data.data)) {
    const ids = data.data
      .map((m) => (isRecord(m) && typeof m.id === 'string' ? m.id : ''))
      .filter(Boolean);
    if (ids.length) return ids;
  }
  if (isUnknownArray(data.models)) {
    const ids = data.models
      .map((m) => (isRecord(m) && typeof m.name === 'string' ? m.name : ''))
      .filter(Boolean);
    if (ids.length) return ids;
  }
  throw new Error(t('ai.error.noModels'));
}

/** 响应 → 模型 id 列表；空列表统一抛「未返回可用模型」（由调用方 toast） */
export function parseModelList(desc: AIProviderDescriptor, data: unknown): string[] {
  return desc.id === 'ollama' ? ollamaModelIds(data) : openaiModelIds(data);
}

/** 模型列表端点 JSON 拉取（fetch 优先 → requestUrl 回退 → 超时/状态码报错）。
 *  label 只进报错文案（各调用方的服务商/服务名），行为与原内联实现逐字一致。 */
async function fetchModelsJson(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  label: string,
  deps: ModelsFetchDeps
): Promise<unknown> {
  const fetchFn: (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> =
    deps.fetchFn || ((u: string, init?: RequestInit) => window.fetch(u, init));
  const requestUrlFn = deps.requestUrlFn || requestUrl;

  // fetch 优先（无 CORS 限制环境直接成功）；fetch 失败（CORS/网络）回退 requestUrl
  const fetchAttempt = async (signal: AbortSignal): Promise<ModelsAttempt> => {
    const resp = await fetchFn(url, { method: 'GET', headers, signal });
    return { resp, via: 'fetch' as const };
  };
  const requestUrlAttempt = async (): Promise<ModelsAttempt> => {
    const r = await requestUrlFn({ url, method: 'GET', headers, throw: false });
    return { resp: { ok: r.status >= 200 && r.status < 300, status: r.status, json: async (): Promise<unknown> => JSON.parse(r.text) as unknown }, via: 'requestUrl' as const };
  };

  let attempt: ModelsAttempt;
  {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    let fetchError: unknown;
    try {
      attempt = await fetchAttempt(controller.signal);
    } catch (e) {
      fetchError = e;
      /* CORS/网络失败、以及 fetch 超时都走 requestUrl 兜底（对齐 streamChatCompletions
         的 fetch→requestUrl fallback 口径）。旧代码 aborted 时直接抛错，与注释承诺不符。 */
      try {
        attempt = await requestUrlAttempt();
      } catch {
        if (controller.signal.aborted) {
          throw new Error(t('ai.error.noResponse', { label, n: timeoutMs / 1000 }));
        }
        throw fetchError ?? e;
      }
    } finally {
      window.clearTimeout(timer);
    }
  }

  const { resp } = attempt;
  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403) {
      throw new Error(t('ai.error.forbidden', { label, status: resp.status }));
    }
    if (resp.status === 404) {
      throw new Error(t('ai.error.listUnsupported', { label }));
    }
    let msg = `API ${resp.status}`;
    try {
      const err: unknown = await resp.json();
      if (isRecord(err) && isRecord(err.error) && typeof err.error.message === 'string') {
        msg = err.error.message;
      }
    } catch { /* 保留状态码 */ }
    throw new Error(msg);
  }

  return resp.json();
}

/** 拉取当前服务商模型列表（id 去重保序）。desc 可显式传入（测试构造；缺省按注册表查找当前 provider） */
export async function fetchProviderModels(
  providerId?: string,
  deps: ModelsFetchDeps = {}
): Promise<ModelOption[]> {
  const id = providerId || resolveProviderId((tryGetSettings()).aiProvider);
  const desc = providerDescriptorOf(id);

  // 端点来源：Ollama 用本地根地址（注册表 /v1 兼容面去掉后缀），自定义读设置里的地址，其余用注册表
  const endpoint = desc.id === 'ollama' ? OLLAMA_BASE_URL : endpointFor(id);
  /* 自定义没填地址：先让人去填，别拿空端点拼出 `/models` 这种相对路径去请求 */
  if (!endpoint) {
    throw new Error(t('ai.error.noEndpoint'));
  }

  const key = keyFor(id);
  // 除 Ollama / LM Studio 本地服务外，缺 key 即拦截（对齐 getAIProvider 的拦截文案）
  if (!key && desc.id !== 'ollama' && desc.id !== 'lmstudio') {
    throw new Error(t('ai.error.missingKey', { provider: providerLabelOf(desc), label: providerKeyLabelOf(desc) }));
  }

  const url = desc.id === 'ollama' ? `${endpoint}/api/tags` : `${endpoint}/models`;
  const headers: Record<string, string> = {};
  if (key) headers['Authorization'] = `Bearer ${key}`;
  const timeoutMs = desc.id === 'ollama' ? OLLAMA_TIMEOUT_MS : MODELS_TIMEOUT_MS;

  const data = await fetchModelsJson(url, headers, timeoutMs, providerLabelOf(desc), deps);
  const ids = parseModelList(desc, data);
  const seen = new Set<string>();
  return ids
    .filter((m) => (seen.has(m) ? false : (seen.add(m), true)))
    .map((m) => ({ id: m, detail: providerLabelOf(desc) }));
}

/* ==================== 向量化模型（Embedding；issue 422/ADR-0182） ==================== */

/** Ollama /api/tags 单条：id + 能力标签 + 展示说明（参数量 + 向量维度，缺字段回落服务名） */
export interface OllamaTag {
  id: string;
  capabilities: string[];
  detail: string;
}

/** /api/tags 响应 → 结构化条目列表（畸形项跳过；capabilities 旧版服务不返回，空数组表示「未知」） */
export function parseOllamaTags(data: unknown): OllamaTag[] {
  if (!isRecord(data)) return [];
  const list = data.models;
  if (!isUnknownArray(list)) return [];
  const out: OllamaTag[] = [];
  for (const m of list) {
    if (!isRecord(m) || typeof m.name !== 'string' || !m.name) continue;
    const capabilities = isUnknownArray(m.capabilities)
      ? m.capabilities.filter((c): c is string => typeof c === 'string')
      : [];
    const det = isRecord(m.details) ? m.details : {};
    const bits: string[] = [];
    if (typeof det.parameter_size === 'string' && det.parameter_size) bits.push(det.parameter_size);
    if (typeof det.embedding_length === 'number' && det.embedding_length > 0) bits.push(t('ai.dims', { n: det.embedding_length }));
    out.push({ id: m.name, capabilities, detail: bits.join('，') || 'Ollama' });
  }
  return out;
}

/** 向量化模型选项：有 capabilities 的按 embedding 能力过滤（聊天模型不进列表）；
 *  旧版 Ollama 不返回该字段（全部为空）→ 不过滤，全量返回由用户自辨。 */
export function pickEmbeddingModels(data: unknown): ModelOption[] {
  const tags = parseOllamaTags(data);
  const known = tags.some((t) => t.capabilities.length > 0);
  return (known ? tags.filter((t) => t.capabilities.includes('embedding')) : tags).map((t) => ({
    id: t.id,
    detail: t.detail,
  }));
}

/** Qwen3-Embedding-8B 判定（issue 427/ADR-0186 建；issue 431/ADR-0189 起收窄为**本地重排通道**门）：
 *  secondbrain/config `rerankChannel()` 的 local 档与 AI 面板「重排模型」行的可见性共用这一条判定
 *  （「启用重排」总闸自 issue 431 起常显——Jev 第二通道不吃本地显存、不绑此门，8B 门只管本地通道）。
 *  只认 8b：本地重排是给 8B 嵌入配的增强档（显存共驻考量，8b 之外的嵌入模型不启用本地通道）。 */
export function isQwen3Embedding8b(model: unknown): boolean {
  const name = typeof model === 'string' ? model : '';
  return /qwen3[-_]?embedding[:\-_.]?8b\b/i.test(name);
}

/**
 * 向量化服务端点（「获取模型」按钮拉列表用）：与 secondbrain/config.ts buildConfig 同口径——
 * 移动端优先「移动端远程地址」、未配置回落本地；两键留空一律默认 http://localhost:11434。
 * 嵌入与重排两个模型行共用这一个地址（issue 429：重排走的就是同一台 Ollama）。
 * （规则镜像域侧实现：域侧 IS_MOBILE 另有 UA 兜底，此处按 obsidian Platform 判定。）
 */
export function embeddingServiceUrl(): string {
  const s = tryGetSettings();
  const local = String(s.secondBrainOllamaUrl || '').trim() || OLLAMA_BASE_URL;
  const remote = String(s.secondBrainRemoteOllamaUrl || '').trim();
  return isMobileEnv() && remote ? remote : local;
}

/** 重排模型名判定：社区转换版命名五花八门、capabilities 里也没有 rerank 这一档，
 *  只按名字软过滤（硬按能力过滤会把真正的重排模型滤掉）。 */
const RERANK_NAME_RE = /rerank/i;

/** 列表里是否含名字带 rerank 的条目（issue 429：选择器标题据此提示「全量回退」——
 *  一个都没匹配到时列的是全部模型，不是筛选失败，用户需要知道为什么列表这么长）。 */
export function hasRerankNamed(items: Array<{ id: string }>): boolean {
  return items.some((m) => RERANK_NAME_RE.test(m.id));
}

/** 重排模型选项（issue 429）：名字含 rerank 的优先；一个都没有 → 全量返回由用户自辨。 */
export function pickRerankModels(data: unknown): ModelOption[] {
  const tags = parseOllamaTags(data);
  const rerank = tags.filter((t) => RERANK_NAME_RE.test(t.id));
  return (rerank.length ? rerank : tags).map((t) => ({ id: t.id, detail: t.detail }));
}


