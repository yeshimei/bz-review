// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { markSettingSplitRows } from '../src/core/settings-split';

function row(controlHtml: string, extraClass = ''): HTMLElement {
  const box = document.createElement('div');
  box.innerHTML = `<div class="setting-item ${extraClass}">
    <div class="setting-item-info"><div class="setting-item-name">名称</div></div>
    <div class="setting-item-control">${controlHtml}</div>
  </div>`;
  return box.firstElementChild as HTMLElement;
}

describe('移动端设置行两行式标记', () => {
  it('组合控件（≥2 子元素）继续拆两行', () => {
    const el = row('<button>甲</button><button>乙</button>');
    markSettingSplitRows(el.parentElement as HTMLElement);
    expect(el.classList.contains('bzrv-setting-split')).toBe(true);
  });

  it('单控件但控件很宽（分段器/文本框/下拉）也要拆两行', () => {
    const wide = [
      '<div class="bzrv-segmented"><button>甲</button></div>',
      '<input type="text" placeholder="路径">',
      '<select><option>选项</option></select>',
    ];
    for (const html of wide) {
      const el = row(html);
      markSettingSplitRows(el.parentElement as HTMLElement);
      expect(el.classList.contains('bzrv-setting-split')).toBe(true);
    }
  });

  it('开关、数字框等窄控件维持原生单行', () => {
    for (const html of [
      '<div class="checkbox-container"><input type="checkbox"></div>',
      '<input type="number" value="1">',
    ]) {
      const el = row(html);
      markSettingSplitRows(el.parentElement as HTMLElement);
      expect(el.classList.contains('bzrv-setting-split')).toBe(false);
    }
  });

  it('路径选择器行始终豁免，不被误拆', () => {
    const el = row('<button>选</button><div class="chips"></div>', 'bzrv-path-picker-setting-row');
    markSettingSplitRows(el.parentElement as HTMLElement);
    expect(el.classList.contains('bzrv-setting-split')).toBe(false);
  });

  it('重复调用幂等，不会误伤别的行', () => {
    const a = row('<div class="bzrv-segmented"></div>');
    const b = row('<input type="number">');
    const box = document.createElement('div');
    box.append(a, b);
    markSettingSplitRows(box);
    markSettingSplitRows(box);
    expect(a.classList.contains('bzrv-setting-split')).toBe(true);
    expect(b.classList.contains('bzrv-setting-split')).toBe(false);
  });
});
