/**
 * 设置单条条目的自建牌组与标签（2026-11-20）。
 *
 * 牌组以前只能从文件夹/书名自动推导，用户没法把跨文件夹的内容归到一起；标签
 * 则完全没有入口。这里给「卡片管理器」每一行加一个编辑框：填牌组名（可从已有
 * 牌组里挑，也可新建）和标签（逗号分隔），保存只动 deck/tags 两个字段，排期不碰。
 */
import type { App } from 'obsidian';
import type { ReviewItem } from './data';
import { openFlowDialog } from '../core/flow-dialog';
import { parseTagsInput, tagsToInput } from './card-manager';
import { tagsOf } from './deck';

export interface DeckTagValues {
  deck: string;
  tags: string[];
}

/**
 * 打开编辑弹窗。onSave 由调用方落盘（dataManager.updateItemMeta）。
 * existingDecks / existingTags 提供带候选的输入，让用户复用已有分组而不是各写各的。
 */
export function openDeckTagEditor(
  app: App,
  item: ReviewItem,
  existingDecks: readonly string[],
  existingTags: readonly string[],
  onSave: (v: DeckTagValues) => void | Promise<void>
): void {
  void app;
  const root = createDiv();
  root.className = 'bzrv-edit-modal';

  const deckField = root.createDiv({ cls: 'bzrv-edit-field' });
  deckField.createDiv({ cls: 'bzrv-edit-head', text: '牌组' });
  deckField.createDiv({
    cls: 'bzrv-edit-desc',
    text: '留空则按原来的文件夹 / 书名自动分组；填了就以这里为准。可直接输入新牌组名。',
  });
  const deckInput = deckField.createEl('input');
  deckInput.type = 'text';
  deckInput.value = String(item.deck ?? '');
  deckInput.setAttribute('list', 'bzrv-deck-candidates');
  const deckList = deckField.createEl('datalist');
  deckList.id = 'bzrv-deck-candidates';
  for (const d of existingDecks) {
    const opt = deckList.createEl('option');
    opt.value = d;
  }

  const tagField = root.createDiv({ cls: 'bzrv-edit-field' });
  tagField.createDiv({ cls: 'bzrv-edit-head', text: '标签' });
  tagField.createDiv({ cls: 'bzrv-edit-desc', text: '逗号或空格分隔，支持新建。笔记原有的 Obsidian 标签会自动一起参与筛选。' });
  const tagInput = tagField.createEl('input');
  tagInput.type = 'text';
  tagInput.value = tagsToInput(item.tags);
  tagInput.setAttribute('list', 'bzrv-tag-candidates');
  const tagList = tagField.createEl('datalist');
  tagList.id = 'bzrv-tag-candidates';
  for (const t of existingTags) {
    const opt = tagList.createEl('option');
    opt.value = t;
  }

  void openFlowDialog({
    title: '牌组与标签',
    message: '保存只改分组与标签，复习排期和历史都不动。',
    body: root,
    actions: [
      { label: '取消', value: 'cancel' },
      { label: '保存', value: 'ok', cta: true },
    ],
  }).then((v) => {
    if (v !== 'ok') return;
    void Promise.resolve(
      onSave({
        deck: deckInput.value.trim(),
        tags: parseTagsInput(tagInput.value),
      })
    );
  });
}

/** 候选标签：条目自建 +  Obsidian 元数据标签，去重 */
export function allTagsOf(items: readonly ReviewItem[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    for (const t of tagsOf(it)) {
      if (!seen.has(t)) {
        seen.add(t);
        out.push(t);
      }
    }
  }
  return out;
}
