import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * 测试只跑纯逻辑（授权、数量门控、迁移解析），不启 jsdom。
 *
 * 搬 bz 的 UI 测试时要加两样东西：`environment: 'jsdom'`、
 * 以及把 `obsidian` 指到 tests/mock-obsidian.ts 的 alias。
 *
 * 为什么必须有 alias：npm 上的 obsidian 包只有类型、没有 JS 入口（main 为空），
 * vite 6 解析这种包会直接失败，所有 `vi.mock('obsidian')` 的测试在加载阶段就挂。
 */
export default defineConfig({
  resolve: {
    alias: {
      obsidian: fileURLToPath(new URL('./tests/mock-obsidian.ts', import.meta.url)),
    },
  },
  define: { __BZ_DEV__: 'false' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules/**'],
    testTimeout: 20000,
  },
});
