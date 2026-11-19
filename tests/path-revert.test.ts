/**
 * path 行异步否决回退回归（BY-REV-MIGRATE-CANCEL）。
 *
 * 真实 bug：数据目录「取消迁移」时只回退了 chips，data.json 的 storagePath 已落盘成新目录，
 * 下次启动读空目录、看似「数据丢失」。根因是通用 path 行先写盘、异步回调返回回退清单时
 * 只更新 chips、不回写 binding 与落盘（core/settings-schema.ts）。
 *
 * 这里两层断言：
 *  1. 纯函数口径（single 去斜杠 / multi 数组 + 变更判定）——可精确测，不依赖 DOM；
 *  2. 渲染器源码断言：同步分支和异步分支都走 applyFinal → acc.write + safePersist，
 *     防止将来有人只改一半又回归。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathListToValue, pathValueChanged } from '../src/core/path-value';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');
const schema = read('src/core/settings-schema.ts');

describe('path 行 · 异步否决回退落盘', () => {
  it('single 清单换算：取首项 + 去首尾斜杠（与写盘口同口径）', () => {
    expect(pathListToValue(false, ['migrated-store'])).toBe('migrated-store');
    expect(pathListToValue(false, ['/bz-review/storage/'])).toBe('bz-review/storage');
    expect(pathListToValue(false, [])).toBe('');
  });

  it('multi 清单换算：原样数组副本', () => {
    const list = ['a', 'b'];
    const out = pathListToValue(true, list);
    expect(out).toEqual(['a', 'b']);
    expect(out).not.toBe(list); // 副本，不会被外部后续改动串改
  });

  it('single 变更判定：回退值与写入值不同即需回写', () => {
    expect(pathValueChanged(false, 'migrated-store', 'bz-review/storage')).toBe(true);
    expect(pathValueChanged(false, 'bz-review/storage', 'bz-review/storage')).toBe(false);
    expect(pathValueChanged(false, '', 'bz-review/storage')).toBe(true);
  });

  it('multi 变更判定：按项与长度比较，顺序敏感', () => {
    expect(pathValueChanged(true, ['a', 'b'], ['a'])).toBe(true);
    expect(pathValueChanged(true, ['a'], ['a', 'b'])).toBe(true);
    expect(pathValueChanged(true, ['a', 'b'], ['b', 'a'])).toBe(true);
    expect(pathValueChanged(true, ['a', 'b'], ['a', 'b'])).toBe(false);
  });

  it('渲染器：同步与异步两路都经 applyFinal 修正 binding + 落盘', () => {
    // 不能出现「异步分支直接返回 final、不回写」的旧写法
    expect(schema).not.toContain('(final) => (Array.isArray(final) ? final : list)');
    // applyFinal 里必须有写 binding + 持久化
    const applyFinalBlock = schema.slice(schema.indexOf('const applyFinal'), schema.indexOf('let res:'));
    expect(applyFinalBlock).toContain('acc.write(finalV)');
    expect(applyFinalBlock).toContain('safePersist(() => acc.persist()');
    // 两路都调用 applyFinal（同步分支 + 异步 then）
    expect(schema).toContain('applyFinal(Array.isArray(final) ? final : list)');
    expect(schema).toContain('return Array.isArray(res) ? applyFinal(res) : undefined');
  });

  it('数据目录取消分支仍只返回回退清单（由渲染器统一负责落盘回退）', () => {
    const reviewSchema = read('src/review/settings-schema.ts');
    expect(reviewSchema).toContain('已取消，数据目录没变');
    // 取消分支返回 [prev]，落盘回退交给渲染器 applyFinal，避免两处各写一份口径
    const cancelBlock = reviewSchema.slice(
      reviewSchema.indexOf("已取消，数据目录没变") - 120,
      reviewSchema.indexOf("已取消，数据目录没变") + 120
    );
    expect(cancelBlock).toContain('return [prev]');
  });
});
