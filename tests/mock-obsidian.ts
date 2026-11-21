/* ============================================================
 * 测试环境里的 obsidian 占位（tests/mock-obsidian.ts）
 *
 * npm 上的 `obsidian` 包只有类型声明、没有运行时 JS 入口（package.json 的
 * main 是空字符串）。vite 6 遇到这种包会直接报「Failed to resolve entry」，
 * 于是所有 import 'obsidian' 的测试文件在加载阶段就挂了。
 *
 * 这里只提供能被解析的空壳：具体测试用 `vi.mock('obsidian', () => ({...}))`
 * 覆盖自己需要的那几个导出，没覆盖到的走这里的默认实现。
 * ========================================================== */
export const requestUrl = async (): Promise<never> => {
  throw new Error('obsidian stub: requestUrl 没有在测试里被 mock');
};

export class Modal {}
export class Setting {}
export class Plugin {}
export class ItemView {}
export class Notice {}
export class PluginSettingTab {}
export class TFile {}
export class TFolder {}
export class MarkdownView {}

export const setIcon = (): void => {};
export const Platform = { isMobile: false, isDesktop: true };
export const normalizePath = (p: string): string => p;
export const moment = {};
export const debounce = <T>(fn: T): T => fn;
