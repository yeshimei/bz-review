import { describe, expect, it } from 'vitest';
import { panelModeOf, REVIEW_VIEW_TYPE } from '../src/review/panel-mode';
import { queueViewHtml } from '../src/review/render';

describe('主界面打开方式（reviewPanelMode）', () => {
  it('缺省是原生页：老配置没有这个字段也能直接升级', () => {
    expect(panelModeOf(undefined)).toBe('native');
    expect(panelModeOf(null)).toBe('native');
    expect(panelModeOf({})).toBe('native');
  });

  it('只有 popup 字面量算独立弹窗', () => {
    expect(panelModeOf({ reviewPanelMode: 'popup' })).toBe('popup');
    expect(panelModeOf({ reviewPanelMode: 'native' })).toBe('native');
  });

  it('脏值一律回落原生页，不会开不出面板', () => {
    expect(panelModeOf({ reviewPanelMode: 'dialog' })).toBe('native');
    expect(panelModeOf({ reviewPanelMode: 0 })).toBe('native');
    expect(panelModeOf({ reviewPanelMode: true })).toBe('native');
  });

  it('视图类型 id 带 bzrv- 前缀（作用域守卫按前缀认领自有节点）', () => {
    expect(REVIEW_VIEW_TYPE.startsWith('bzrv-')).toBe(true);
  });
});

describe('队列空态文案', () => {
  it('一条都没有时说「还没有复习条目」，不说「今日已清空」', () => {
    const html = queueViewHtml([]);
    expect(html).toContain('还没有复习条目');
    expect(html).not.toContain('今日已清空');
  });

  it('头行给了设置入口（原生设置页下线后，这里是唯一入口）', () => {
    const html = queueViewHtml([]);
    expect(html).toContain('data-act="settings"');
  });
});
