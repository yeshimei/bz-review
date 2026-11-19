import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

const IDS = [
  'deepseek', 'zhipu-plan', 'ollama', 'zhipu', 'qwen', 'kimi', 'siliconflow',
  'volcengine', 'stepfun', 'openai', 'anthropic', 'google', 'xai', 'mistral',
  'groq', 'openrouter', 'lmstudio', 'custom',
];

describe('AI 服务商整套移植', () => {
  it('注册表照 bz 的 18 家，不是旧的 4 家', () => {
    const ai = read('src/core/ai.ts');
    for (const id of IDS) expect(ai, `缺服务商 ${id}`).toContain(`id: '${id}'`);
  });

  it('设置页由注册表驱动，不再硬编码 5 家下拉', () => {
    const schema = read('src/review/settings-schema.ts');
    expect(schema).toContain('AI_PROVIDER_REGISTRY.map');
    expect(schema).toContain('rows: reviewLlmRows()');
    expect(schema).not.toContain("{ value: 'zhipu', label: '智谱' }");
  });

  it('密钥表、双协议、模型拉取与思考档位都接上了', () => {
    const schema = read('src/review/settings-schema.ts');
    expect(schema).toContain('aiApiKeys');
    expect(schema).toContain('aiCustomProtocol');
    expect(schema).toContain('fetchProviderModels');
    expect(schema).toContain('thinkingLevelsOf');
  });
});
