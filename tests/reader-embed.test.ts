/**
 * 「打开复习」命令借道 bz-reader 复习页签（2026-11-20）。
 *
 * 用户在 Reader 设置里开了「书架内显示复习」后，Review 的命令面板 / ribbon
 * 再点「打开复习」，就不该再开一张带左侧栏的原生页，而应直接亮出 Reader 的
 * 复习页签（那里嵌着同一份面板）。门面用 typeof 守卫：老版本 Reader 没有
 * readerApi，或没开嵌入，一律回退到原生页，行为不变。
 */
import { describe, expect, it, vi } from 'vitest';
import { embeddedReviewRoute } from '../src/review/reader-embed';

const openReviewTab = vi.fn();

function appWith(embedded: () => boolean, withApi = true): unknown {
  const readerApi = withApi ? { reviewEmbedded: embedded, openReviewTab } : undefined;
  return {
    plugins: { plugins: { 'bz-reader': readerApi ? { readerApi } : {} } },
  };
}

describe('embeddedReviewRoute：命令要不要借道 Reader 复习页签', () => {
  it('没装 bz-reader 插件时返回 null（走原生页）', () => {
    expect(embeddedReviewRoute({ plugins: { plugins: {} } } as any)).toBeNull();
    expect(embeddedReviewRoute({} as any)).toBeNull();
    expect(embeddedReviewRoute(null as any)).toBeNull();
  });

  it('Reader 没暴露 readerApi（老版本）时返回 null', () => {
    expect(embeddedReviewRoute(appWith(() => true, false) as any)).toBeNull();
  });

  it('readerApi 缺方法（写坏）时返回 null', () => {
    const app = { plugins: { plugins: { 'bz-reader': { readerApi: { reviewEmbedded: () => true } } } } } as any;
    expect(embeddedReviewRoute(app)).toBeNull();
  });

  it('Reader 没开嵌入时返回 null', () => {
    expect(embeddedReviewRoute(appWith(() => false) as any)).toBeNull();
  });

  it('Reader 开了嵌入时给出打开页签的回调', () => {
    const route = embeddedReviewRoute(appWith(() => true) as any);
    expect(route).not.toBeNull();
    route!.openReviewTab();
    expect(openReviewTab).toHaveBeenCalledOnce();
  });
});
