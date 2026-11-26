/**
 * 原生设置页门牌（src/settings-tab.ts）：只渲染一行按钮；点按钮先收宿主设置 Modal，
 * 宿主离场后再走分流入口（内嵌页 / 独立面板）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/review/settings-entry', () => ({ openSettingsFromHost: vi.fn() }));
vi.mock('../src/core/ui/host-settings', () => ({ afterHostSettingsClosed: vi.fn() }));
vi.mock('../src/review/reader-embed', () => ({ embeddedReviewRoute: vi.fn(() => null) }));
vi.mock('../src/review', () => ({ ensureReview: vi.fn(), uiManager: null }));
vi.mock('../src/i18n', () => ({ t: (key: string) => (key === 'settings.tab.open' ? '打开设置面板' : '说明文案') }));

/* 桩 Settings 把这一行记在模块级数组里（vi.mock 工厂不能引用未来才初始化的顶层变量，
   所以记录器定义在工厂内部，再挂到 vi.mock 的返回上由测试读回）。 */
const recorded: Array<{ name: string; desc: string; button: { text: string; cta: boolean; click: () => void } }> = [];
vi.mock('obsidian', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  class StubButton {
    text = '';
    cta = false;
    click: () => void = () => undefined;
    setButtonText(v: string): this {
      this.text = v;
      return this;
    }
    setCta(): this {
      this.cta = true;
      return this;
    }
    onClick(fn: () => void): this {
      this.click = fn;
      return this;
    }
  }
  return {
    ...mod,
    Setting: class {
      name = '';
      desc = '';
      button = new StubButton();
      constructor(_container: unknown) {}
      setName(v: string): this {
        this.name = v;
        return this;
      }
      setDesc(v: string): this {
        this.desc = v;
        return this;
      }
      addButton(cb: (b: StubButton) => void): this {
        cb(this.button);
        /* 工厂里拿不到外层 recorded（提升）：改用全局符号，测试里同源读取 */
        (globalThis as unknown as { __bzrvSettingCalls: typeof recorded }).__bzrvSettingCalls.push({
          name: this.name,
          desc: this.desc,
          button: this.button,
        });
        return this;
      }
    },
    PluginSettingTab: class {
      app: unknown;
      containerEl = { empty: () => undefined };
      constructor(app: unknown, _plugin: unknown) {
        this.app = app;
      }
    },
  };
});

import { openSettingsFromHost } from '../src/review/settings-entry';
import { afterHostSettingsClosed } from '../src/core/ui/host-settings';
import { BzReviewSettingTab } from '../src/settings-tab';

/** mock 工厂执行后才挂得上，惰性读 */
function calls(): typeof recorded {
  return (globalThis as unknown as { __bzrvSettingCalls: typeof recorded }).__bzrvSettingCalls;
}

describe('原生设置页门牌', () => {
  const app = { id: 'app' };

  beforeEach(() => {
    (globalThis as unknown as { __bzrvSettingCalls: typeof recorded }).__bzrvSettingCalls = [];
    vi.mocked(openSettingsFromHost).mockReset();
    vi.mocked(afterHostSettingsClosed).mockReset();
  });

  it('只渲染一行：名字与说明来自语言包，按钮是强调色', () => {
    const tab = new BzReviewSettingTab(app as never, {} as never);
    tab.display();

    expect(calls()).toHaveLength(1);
    expect(calls()[0].name).toBe('打开设置面板');
    expect(calls()[0].desc).toBe('说明文案');
    expect(calls()[0].button.cta).toBe(true);
    expect(calls()[0].button.text).toBe('打开设置面板');
  });

  it('点按钮 → 先走宿主交接，交接完成后再分流打开设置', () => {
    const tab = new BzReviewSettingTab(app as never, {} as never);
    tab.display();
    const args: unknown[] = [];

    /* 交接壳：断言 run 传进来时还没调分流，然后模拟宿主离场后执行它 */
    vi.mocked(afterHostSettingsClosed).mockImplementation((a, el, run) => {
      args.push(a, el);
      expect(openSettingsFromHost).not.toHaveBeenCalled();
      run();
    });

    calls()[0].button.click();

    expect(args[0]).toBe(app);
    expect(args[1]).toBe(tab.containerEl);
    expect(afterHostSettingsClosed).toHaveBeenCalledTimes(1);
    /* 分流入口拿到完整依赖：route（这里没装 reader，null）+ 面板单例上的 openSettings */
    expect(openSettingsFromHost).toHaveBeenCalledTimes(1);
    const deps = vi.mocked(openSettingsFromHost).mock.calls[0][0];
    expect(deps.route).toBeNull();
    expect(typeof deps.openSettings).toBe('function');
  });
});
