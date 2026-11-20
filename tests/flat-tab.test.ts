/**
 * 独立复习界面顶部的「复习」页签（2026-11-20，图三形制）
 *
 * 左栏整条撤掉，那一项挪到头栏成了一个横排页签。三条口径：
 *   1. 页签文字永远固定「复习」两个字——进内置页（数据/设置）也不换成页名；
 *   2. 进内置页时页签淡化、对应图标高亮即可，页面名不占页签位；
 *   3. 嵌入 reader 时头行由 CSS 整体隐藏、页签由宿主画，这里只管独立态。
 * 纯函数钉在 render 层。
 */
import { describe, expect, it } from 'vitest';
import { panelHeadHtml, queueViewHtml } from '../src/review/render';

describe('独立界面头行：固定的「复习」页签', () => {
  it('页签渲染成 stutab 按钮，文字固定「复习」，带日历图标', () => {
    const html = panelHeadHtml();
    expect(html).toContain('bzrv-stutab');
    expect(html).toMatch(/<button[^>]*data-act="home"[^>]*class="[^"]*bzrv-stutab[^"]*"/);
    expect(html).toContain('calendar-check');
    expect(html).toMatch(/bzrv-stutab-txt">复习<\/span>/);
  });

  it('主队列时页签选中（is-on + 下划线）', () => {
    expect(panelHeadHtml()).toMatch(/bzrv-stutab[^"]*is-on/);
  });

  it('即使外面传了 title，页签也不改名（内置页 fixed 显示复习）', () => {
    const html = panelHeadHtml({ title: '数据', activePage: 'stats' });
    expect(html).toMatch(/bzrv-stutab-txt">复习<\/span>/);
    expect(html).not.toContain('bzrv-stutab-txt">数据<');
  });

  it('进内置页时页签淡化（无 is-on），对应图标高亮', () => {
    const html = panelHeadHtml({ activePage: 'stats' });
    expect(html).not.toMatch(/bzrv-stutab[^"]*is-on/);
    expect(html).toMatch(/data-act="data"[^>]*is-on/);
  });

  it('主队列头行也带上这个页签（queueViewHtml 走同一个 panelHeadHtml）', () => {
    const html = queueViewHtml([], { now: new Date(2026, 10, 20).getTime() });
    expect(html).toContain('bzrv-stutab');
    expect(html).toContain('data-act="home"');
    expect(html).toMatch(/bzrv-stutab-txt">复习<\/span>/);
  });
});
