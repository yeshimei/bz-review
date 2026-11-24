/**
 * 更新日志来源与 reader 一致（2026-11-24）：review 读在线日志。
 *
 * 之前 review 故意只用自己的内置日志，因为在线那份 changelog 是 reader 的，
 * 合并进来会串进 reader 的版本。现在数据源给 review 单开一块 reviewChangelog，
 * review 解析它并与内置日志按版本合并——机制与 reader 的 changelog 完全一致。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../src/i18n';
import {
  parseBzrData,
  _resetBzrDataForTests,
  type BzrData,
} from '../src/review/ui/bzr-data';
import { REVIEW_RELEASES } from '../src/review/ui/changelog-bridge';
import { changelogNoteHtml } from '../src/review/ui/changelog-note';

/** 一份带 review 在线日志的最小合法远程文档 */
const docWithOnline = (online: unknown): string => JSON.stringify({
  version: 1,
  updatedAt: '2026-11-24',
  changelog: [{ version: '1.6.0', date: '2026-11-21', added: [
    { domain: { zh: '阅读器', en: 'Reader' }, text: { zh: '这是 reader 的日志', en: 'reader log' } },
  ] }],
  reviewChangelog: online,
  roadmap: [],
  stats: { reward: 0, pro: 0, patrons: 0 },
  links: {
    support: 'https://afdian.net/a/x',
    buy: 'https://wzyp.cn/shop/IFCEI5I3',
  },
});

afterEach(() => {
  setLocale('zh');
  _resetBzrDataForTests();
});

describe('review 在线日志 · 解析', () => {
  it('解析 reviewChangelog 字段', () => {
    const data = parseBzrData(docWithOnline([{
      version: '1.0.3', date: '2026-11-24',
      fixed: [{ domain: { zh: '修复', en: 'Fix' }, text: { zh: '在线新增条目', en: 'online item' } }],
    }]));
    expect(data?.reviewChangelog).toHaveLength(1);
    expect(data?.reviewChangelog[0].version).toBe('1.0.3');
  });

  it('只有 review 在线日志、没有 reader 日志时整份数据仍然合法', () => {
    const onlyReview = JSON.stringify({
      version: 1, updatedAt: '2026-11-24',
      reviewChangelog: [{ version: '1.0.3', fixed: [
        { domain: { zh: '修复', en: 'Fix' }, text: { zh: '只有复习日志', en: 'review only' } },
      ] }],
      roadmap: [], stats: { reward: 0, pro: 0, patrons: 0 },
      links: { support: 'https://afdian.net/a/x', buy: 'https://wzyp.cn/shop/IFCEI5I3' },
    });
    const data = parseBzrData(onlyReview);
    expect(data).not.toBeNull();
    expect(data?.reviewChangelog[0].version).toBe('1.0.3');
    expect(data?.changelog).toEqual([]);
  });

  it('老数据没有 reviewChangelog 时降级为空数组，不影响整份数据合法', () => {
    const old = JSON.stringify({
      version: 1, updatedAt: '2026-11-21',
      changelog: [{ version: '1.6.0', added: [
        { domain: { zh: '阅读器', en: 'Reader' }, text: { zh: 'reader', en: 'reader' } },
      ] }],
      roadmap: [], stats: { reward: 0, pro: 0, patrons: 0 },
      links: { support: 'https://afdian.net/a/x', buy: 'https://wzyp.cn/shop/IFCEI5I3' },
    });
    const data = parseBzrData(old);
    expect(data).not.toBeNull();
    expect(data?.reviewChangelog).toEqual([]);
  });

  it('reviewChangelog 里的坏条目被丢弃，reader 的 changelog 不混进来', () => {
    const data = parseBzrData(docWithOnline([
      { version: '1.0.3', fixed: [{ domain: { zh: '修复', en: 'Fix' }, text: { zh: '有效', en: 'ok' } }] },
      { nope: 'bad' },
    ]));
    expect(data?.reviewChangelog).toHaveLength(1);
    // reader 的日志仍在 changelog 字段，但与 reviewChangelog 分开
    expect(data?.changelog[0].version).toBe('1.6.0');
    expect(data?.reviewChangelog[0].version).toBe('1.0.3');
  });
});

describe('review 在线日志 · 合并与渲染', () => {
  it('在线有的版本整块替换内置，在线没有的版本保留内置', () => {
    const data = parseBzrData(docWithOnline([{
      version: '1.0.2', date: '2026-11-24',
      fixed: [{ domain: { zh: '在线覆盖', en: 'Override' }, text: { zh: '在线版本的 1.0.2', en: 'online 1.0.2' } }],
    }])) as BzrData;
    setLocale('zh');
    const html = changelogNoteHtml(REVIEW_RELEASES, '1.0.2', [], data);
    // 在线条目出现，内置 1.0.2 的原条目（「修正依赖版本声明与锁文件」）消失
    expect(html).toContain('在线版本的 1.0.2');
    expect(html).not.toContain('修正依赖版本声明与锁文件');
    // 在线没有的 1.0.1 仍保留内置
    expect(html).toContain('清掉社区市场扫描报的 CSS 与依赖问题');
    // reader 的日志绝不出现
    expect(html).not.toContain('这是 reader 的日志');
  });

  it('在线有新版本时排在最前', () => {
    const data = parseBzrData(docWithOnline([{
      version: '9.9.9', date: '2026-11-24',
      added: [{ domain: { zh: '新版本', en: 'New' }, text: { zh: '在线的 9.9.9 版本', en: 'online 9.9.9' } }],
    }])) as BzrData;
    setLocale('zh');
    const html = changelogNoteHtml(REVIEW_RELEASES, '', [], data);
    expect(html).toContain('在线的 9.9.9 版本');
  });

  it('在线数据为空时只用内置日志', () => {
    setLocale('zh');
    const html = changelogNoteHtml(REVIEW_RELEASES, '1.0.2', [], null);
    expect(html).toContain('修正依赖版本声明与锁文件');
    expect(html).not.toContain('在线新增条目');
  });
});
