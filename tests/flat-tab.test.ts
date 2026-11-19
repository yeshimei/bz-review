/**
 * 独立复习界面的「复习计划」页签（2026-11-20）
 *
 * 独立界面原来左侧有一条竖栏（只有「复习计划」一项），像图二那样。用户要的是
 * 像 bz-reader 图三那样：把那一项挪到顶部成一个横排页签，左栏整个撤掉。
 * 页签点击回主列表（承接原竖栏 onSelect），其余功能仍走头栏右侧图标。
 *
 * 嵌入 reader 时头行由 CSS 整体隐藏、页签由 reader 画，所以这里只管独立态的
 * head markup，embed 态不受影响。纯函数钉在 render 层。
 */
import { describe, expect, it } from 'vitest';
import { panelHeadHtml, queueViewHtml } from '../src/review/render';

describe('独立界面头行：复习计划是一个可点页签', () => {
  it('标题位渲染成 stutab 页签按钮，带 home 动作与日历图标', () => {
    const html = panelHeadHtml({ title: '复习计划' });
    expect(html).toContain('bzrv-stutab');
    expect(html).toMatch(/<button[^>]*data-act="home"[^>]*class="[^"]*bzrv-stutab[^"]*"/);
    expect(html).toContain('calendar-check');
    expect(html).toContain('复习计划</span>');
  });

  it('页签默认选中态（is-on），带强调下划线那套类', () => {
    const html = panelHeadHtml();
    expect(html).toMatch(/bzrv-stutab[^"]*is-on/);
  });

  it('主队列头行也带上这个页签（queueViewHtml 走同一个 panelHeadHtml）', () => {
    const html = queueViewHtml([], { now: new Date(2026, 10, 20).getTime() });
    expect(html).toContain('bzrv-stutab');
    expect(html).toContain('data-act="home"');
  });

  it('内置页（数据/设置）的头行也有页签，点它能回主列表', () => {
    const html = panelHeadHtml({ title: '数据', activePage: 'stats' });
    expect(html).toContain('bzrv-stutab');
    expect(html).toContain('data-act="home"');
  });
});
