/* ============================================================
 * 复习 · 共享 bz Reader 的 AI 配置（core/ai-share.ts）
 *
 * 2026-11-19 用户口径：两个插件各自有一套 AI 配置，用户通常只在一填过。
 * 开一个开关（aiShareReader，默认开）后，自己的配置不完整就借用 bz Reader
 * 里填好的那一份——任一边配好，另一边都能用。
 *
 * 三条硬口径：
 *   1. **只读**：借来的配置只在本次解析里用，不写回本插件设置、不改对方文件。
 *   2. **只借能用的**：对方选了服务商却没密钥这类半成品不借——否则「共享开着
 *      却仍报未配置」，比不共享更让人困惑。
 *   3. **读不到就安静放弃**：对方没装 / 文件正在写 / JSON 坏了，都当没有，
 *      绝不把一次复习崩在跨插件读盘上。
 * ============================================================ */
import { getApp } from './app';
import type { AISettingsLike } from './ai';

/** bz Reader 的插件 id（目录名可以改，id 不会） */
export const READER_PLUGIN_ID = 'bz-reader';

/** 借来的配置多久重读一次（用户在另一边刚填完，不该等太久） */
const TTL_MS = 5000;

let cached: Partial<AISettingsLike> | null = null;
let cachedAt = 0;
let inFlight: Promise<Partial<AISettingsLike> | null> | null = null;

/** 测试用：直接塞一份「对方配置」，不碰文件系统 */
export function __setSharedAiForTests(patch: Partial<AISettingsLike> | null): void {
  cached = patch;
  cachedAt = Date.now();
  inFlight = null;
}

/** 测试用：清空缓存 */
export function __resetSharedAiForTests(): void {
  cached = null;
  cachedAt = 0;
  inFlight = null;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function strMap(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!v || typeof v !== 'object') return out;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const s = str(val);
    if (k && s) out[k] = s;
  }
  return out;
}

function numMap(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!v || typeof v !== 'object') return out;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const n = Number(val);
    if (k && Number.isFinite(n) && n > 0) out[k] = n;
  }
  return out;
}

/**
 * 把 bz Reader 的 data.json 映射成本插件设置里 AI 那几项。
 *
 * 两边服务商注册表是同一套 id，可以原样搬；字段名不同，外加 Reader 把自定义
 * 通道的模型放在 `modelOverrides.custom`，这里翻回本插件的同名表。纯函数。
 */
export function borrowAiFromReader(raw: unknown): Partial<AISettingsLike> | null {
  if (!raw || typeof raw !== 'object') return null;
  const root = raw as { ai?: unknown; settings?: { ai?: unknown } };
  /* Reader 的 data.json 把整份设置包在 settings 里（真机踩过：只认顶层 ai
     会把已经配好的用户当成没配），同时兼容顶层 ai 便于直接喂 settings 对象。 */
  const ai = root.settings?.ai ?? root.ai;
  if (!ai || typeof ai !== 'object') return null;
  const a = ai as Record<string, unknown>;

  const provider = str(a.provider);
  const endpoint = str(a.baseUrl);
  const apiKey = str(a.apiKey);
  const model = str(a.model);
  const modelOverrides = strMap(a.modelOverrides);
  /* Reader 的空服务商 + 填了地址 = 老自定义三件套，与它自己的解析同口径 */
  const id = provider || (endpoint ? 'custom' : '');
  if (!id) return null;

  const patch: Partial<AISettingsLike> = {
    aiProvider: id,
    aiApiKeys: strMap(a.apiKeys),
    aiCustomEndpoint: endpoint,
    aiCustomApiKey: apiKey,
    aiCustomProtocol: str(a.customProtocol) === 'anthropic' ? 'anthropic' : 'openai',
    aiModelOverrides: model ? { ...modelOverrides, custom: model } : modelOverrides,
    aiMaxTokensOverrides: numMap(a.maxTokensOverrides),
    aiThinkingOverrides: strMap(a.thinkingOverrides),
  };
  return readablePatchUsable(patch) ? patch : null;
}

/**
 * 借来的这一份能不能真的发请求（只看本地能判的部分）。
 *
 * 云端服务缺密钥、自定义缺地址或密钥，都算「借了也用不了」，不如不借。
 * 模型名不在这里判：注册表里有默认值，缺了由调用层给一次清楚的人话错误。
 */
export function readablePatchUsable(patch: Partial<AISettingsLike>): boolean {
  const id = String(patch.aiProvider || '').trim();
  if (!id) return false;
  if (id === 'custom') return !!String(patch.aiCustomEndpoint || '').trim() && !!String(patch.aiCustomApiKey || '').trim();
  if (id === 'ollama' || id === 'lmstudio') return true;
  return !!String(patch.aiApiKeys?.[id] || '').trim();
}

/** 本插件自己的 AI 配好了吗（够不够真的发请求） */
export function ownAiConfigured(s: AISettingsLike): boolean {
  const id = String(s.aiProvider || '').trim();
  if (!id) return false;
  if (id === 'custom') return !!String(s.aiCustomEndpoint || '').trim() && !!String(s.aiCustomApiKey || '').trim();
  if (id === 'ollama' || id === 'lmstudio') return true;
  const key = String(s.aiApiKeys?.[id] || '').trim();
  if (key) return true;
  const legacy =
    id === 'deepseek' ? s.deepseekApiKey : id === 'zhipu-plan' ? s.zhipuPlanApiKey : id === 'ollama' ? s.ollamaApiKey : '';
  return !!String(legacy || '').trim();
}

/**
 * bz Reader 的 data.json 路径。
 *
 * 真机踩过：manifest.dir 在一些 Obsidian 版本里已经是 `.obsidian/plugins/bz-reader`
 * 全路径，再拼一遍 configDir/plugins 就变成双重路径，读不到配置、白白弹「AI 未配置」。
 * 所以按「manifest.dir 是否带斜杠」自动判：带斜杠直接用，只有裸目录名才补前缀。
 */
export function readerDataPath(configDir: string, pluginDir: string): string {
  const cd = configDir.replace(/^\/+|\/+$/g, '');
  const d = pluginDir.replace(/^[/\\]+|[/\\]+$/g, '');
  const full = d.includes('/') || d.includes('\\') ? d : `${cd ? `${cd}/` : ''}plugins/${d}`;
  return `${full.replace(/\\/g, '/')}/data.json`;
}

/** 插件真实目录名（用户可以改 .obsidian/plugins 下的目录，id 不会变） */
function pluginDirOf(app: ReturnType<typeof getApp>, id: string): string {
  const manifests = (app as unknown as {
    plugins?: { manifests?: Record<string, { dir?: string }> };
  })?.plugins?.manifests;
  return String(manifests?.[id]?.dir || id);
}

/**
 * 读一次 bz Reader 的配置（带 5 秒缓存）。
 *
 * 返回 null = 没有可借的：对方没装 / 读不到 / JSON 坏了 / 配置本身不完整。
 * 对调用方来说都是同一种结果。
 */
export async function ensureReaderAi(force = false): Promise<Partial<AISettingsLike> | null> {
  const now = Date.now();
  if (!force && now - cachedAt < TTL_MS) return cached;
  if (inFlight) return inFlight;

  let app: ReturnType<typeof getApp> | null = null;
  try {
    app = getApp();
  } catch {
    cached = null;
    cachedAt = now;
    return null;
  }

  const path = readerDataPath(app.vault.configDir, pluginDirOf(app, READER_PLUGIN_ID));
  inFlight = (async () => {
    let next: Partial<AISettingsLike> | null = null;
    try {
      next = borrowAiFromReader(JSON.parse(await app.vault.adapter.read(path)));
    } catch {
      next = null;
    }
    cached = next;
    cachedAt = Date.now();
    inFlight = null;
    return next;
  })();
  return inFlight;
}
