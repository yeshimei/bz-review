/* ============================================================
 * bz · 复习工作台纯层（review/review-flow.ts）
 *
 * 真机两个毛病：Obsidian 全屏时题卡跟着窗口无限拉宽；一轮里混排的不同类型卡片
 * 切过去时界面没反应。这里只放「这一帧该显示什么」的纯判定——类型分布、队列
 * 状态、切换提示——不碰 DOM、不碰 obsidian，能在 node 里直接钉住口径。
 * ============================================================ */
import type { CardMode } from './card-mode';
import type { ReviewItem } from './data';
import { CARD_MODE_META, cardModeMetaList, modeMetaOf } from './card-mode-meta';
import { t } from '../i18n/strings';

export type { CardMode };
export { modeMetaOf };

/** 合法的方式值固定（与语言无关）：脏值兜底用 */
const MODES: readonly string[] = CARD_MODE_META.map((m) => m.value);

/** 卡上 mode 可能是老数据里的脏值；只认合法五种，其余按抽认卡 */
export function modeOfItem(item: ReviewItem): CardMode {
  const raw = (item.card as { mode?: unknown } | undefined)?.mode;
  return typeof raw === 'string' && MODES.includes(raw) ? (raw as CardMode) : 'flashcard';
}

export interface TypeBucket {
  mode: CardMode;
  label: string;
  icon: string;
  tone: string;
  count: number;
}

/** 本轮类型分布：按固定顺序，数量为 0 的不占位 */
export function typeBucketsOf(items: readonly ReviewItem[]): TypeBucket[] {
  const counts = new Map<CardMode, number>();
  for (const it of items) {
    const m = modeOfItem(it);
    counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  return cardModeMetaList()
    .filter((m) => (counts.get(m.value) ?? 0) > 0)
    .map((m) => ({
      mode: m.value,
      label: m.label,
      icon: m.icon,
      tone: m.tone,
      count: counts.get(m.value) ?? 0,
    }));
}

export type QueueRowState = 'done' | 'current' | 'todo';

export interface QueueRow {
  no: number;
  path: string;
  name: string;
  mode: CardMode;
  label: string;
  icon: string;
  tone: string;
  state: QueueRowState;
}

/** 右侧本轮队列：当前卡高亮，之前的压暗。找不到当前卡时没有一行冒充当前 */
export function queueRowsOf(items: readonly ReviewItem[], currentPath: string): QueueRow[] {
  const at = items.findIndex((it) => it.filePath === currentPath);
  return items.map((it, i) => {
    const mode = modeOfItem(it);
    const meta = modeMetaOf(mode);
    return {
      no: i + 1,
      path: it.filePath,
      name: it.name,
      mode,
      label: meta.label,
      icon: meta.icon,
      tone: meta.tone,
      state: at < 0 ? 'todo' : i < at ? 'done' : i === at ? 'current' : 'todo',
    };
  });
}

/** 切卡提示：同类型连做不打扰，换类型才说一句 */
export function switchNoticeOf(from: CardMode, to: CardMode): string {
  return from === to ? '' : t('flow.switched', { mode: modeMetaOf(to).label });
}
