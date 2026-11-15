/**
 * 筛选面板（批 4b，界面层）。
 *
 * 搜索框当年退役（issue 254）是因为它只能按标题模糊匹配，越用越像一个坏掉的搜索。
 * 这里的筛选是「结构化的窄": 类型、牌组、状态各选一个，关键字只作补充——
 * 用户清楚自己在筛什么，结果也就可预期。
 */
import { Modal, Setting, type App } from 'obsidian';
import type { Facets } from './deck';
import type { ItemFilter, StatusFilter } from './deck';

const KIND_OPTIONS: Array<{ value: ItemFilter['kind']; label: string }> = [
  { value: 'all', label: '全部类型' },
  { value: 'note', label: '只看笔记' },
  { value: 'card', label: '只看划线' },
];

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: '不限状态' },
  { value: 'overdue', label: '只看逾期' },
  { value: 'today', label: '只看今天' },
  { value: 'future', label: '只看未来' },
];

export function openFilterDialog(app: App, facets: Facets, current: ItemFilter, onApply: (f: ItemFilter) => void): void {
  const modal = new Modal(app);
  modal.titleEl.setText('筛选');
  const draft: ItemFilter = { ...current };

  new Setting(modal.contentEl).setName('关键字').setDesc('标题、路径、卡片原文都算').addText((t) => {
    t.setValue(String(draft.query ?? '')).onChange((v) => {
      draft.query = v;
    });
    t.setPlaceholder('例如 数学');
  });

  new Setting(modal.contentEl).setName('类型').addDropdown((d) => {
    for (const o of KIND_OPTIONS) d.addOption(String(o.value), o.label);
    d.setValue(String(draft.kind ?? 'all')).onChange((v) => {
      draft.kind = v as ItemFilter['kind'];
    });
  });

  new Setting(modal.contentEl)
    .setName('牌组')
    .setDesc('笔记按文件夹、划线按书名')
    .addDropdown((d) => {
      d.addOption('', '全部牌组');
      for (const deck of facets.decks.slice(0, 40)) d.addOption(deck, deck);
      d.setValue(String(draft.deck ?? '')).onChange((v) => {
        draft.deck = v;
      });
    });

  new Setting(modal.contentEl).setName('状态').addDropdown((d) => {
    for (const o of STATUS_OPTIONS) d.addOption(String(o.value), o.label);
    d.setValue(String(draft.status ?? 'all')).onChange((v) => {
      draft.status = v as StatusFilter;
    });
  });

  new Setting(modal.contentEl)
    .addButton((b) =>
      b.setButtonText('清除').onClick(() => {
        onApply({});
        modal.close();
      })
    )
    .addButton((b) => b.setButtonText('取消').onClick(() => modal.close()))
    .addButton((b) =>
      b
        .setButtonText('应用')
        .setCta()
        .onClick(() => {
          onApply({ ...draft });
          modal.close();
        })
    );

  modal.open();
}
