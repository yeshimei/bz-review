import { defineConfig } from 'vitest/config';

/**
 * 测试只跑纯逻辑（授权、数量门控、迁移解析），不启 jsdom。
 *
 * 搬 bz 的 UI 测试时要加两样东西：`environment: 'jsdom'`、
 * 以及把 `obsidian` 指到 tests/mock-obsidian-entry.ts 的 alias。
 */
export default defineConfig({
  define: { __BZ_DEV__: 'false' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules/**'],
    testTimeout: 20000,
  },
});
