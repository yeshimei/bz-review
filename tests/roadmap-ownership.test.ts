import { describe, expect, it, vi } from 'vitest';

/* bzr-data 只在拉取时用 requestUrl；解析是纯函数，桩掉宿主模块即可单测 */
vi.mock('obsidian', () => ({
  requestUrl: vi.fn(),
}));

const { parseBzrData } = await import('../src/review/ui/bzr-data');

/** 一份最小可用远端数据：日志 + 两个跳转地址，路线图按用例替换 */
function doc(items: unknown[]): unknown {
  return {
    changelog: [{
      version: '1.0.0',
      added: [{
        domain: { zh: '设置', en: 'Settings' },
        text: { zh: '说明', en: 'Note' },
      }],
    }],
    links: { support: 'https://wzyp.cn/shop/support', buy: 'https://wzyp.cn/shop/buy' },
    roadmap: [{ theme: '在路上', order: 1, items }],
  };
}

const fb = { kind: 'issue', n: 1, label: '#1' };

describe('路线图归属 · 各插件只看自己的条目', () => {
  it('Review 只收 plugin=review，reader / bz / 缺省一律丢掉', () => {
    const data = parseBzrData(
      doc([
        { title: 'Review 自己的', state: 'plan', src: 'github', plugin: 'review', fb },
        { title: 'Reader 的', state: 'plan', src: 'github', plugin: 'reader', fb },
        { title: 'bz 的', state: 'doing', src: 'github', plugin: 'bz', fb },
        { title: '老数据没标', state: 'done', src: 'github', fb },
      ])
    );
    expect(data).not.toBeNull();
    const items = data!.roadmap.flatMap((t) => t.items);
    expect(items.map((i) => i.title)).toEqual(['Review 自己的']);
  });

  it('整块只剩别人的条目时，路线图为空但数据本身仍可用', () => {
    const data = parseBzrData(
      doc([{ title: 'Reader 的', state: 'plan', src: 'github', plugin: 'reader', fb }])
    );
    expect(data).not.toBeNull();
    expect(data!.roadmap.every((t) => t.items.length === 0)).toBe(true);
  });

});
