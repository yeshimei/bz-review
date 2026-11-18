/**
 * 未来负荷（批 6，界面层）。
 *
 * 一个纯文字弹窗就够：用户只需要知道「哪几天会堆起来」。做成图表要多一个
 * 画布、多一套配色、多一处暗色模式适配，收益却不如一行峰值日来得直接。
 */
import { Modal, type App } from 'obsidian';
import type { LoadPoint } from './queue';
import { forecastToText } from './report';

/** 静态样式字面量提成常量，避免 no-static-styles-assignment（值不变） */
const CSS_WHITE_SPACE_PRE_WRAP = 'pre-wrap';
const CSS_FONT_FAMILY_MONO = 'var(--font-monospace)';
const CSS_LINE_HEIGHT = '1.6';
const CSS_COLOR_MUTED = 'var(--text-muted)';
const CSS_FONT_SIZE_SMALLER = 'var(--font-ui-smaller)';

export function openForecastDialog(app: App, points: readonly LoadPoint[]): void {
  const modal = new Modal(app);
  modal.titleEl.setText('未来复习负荷');
  const pre = modal.contentEl.createEl('pre');
  pre.setText(forecastToText(points, 21));
  pre.style.whiteSpace = CSS_WHITE_SPACE_PRE_WRAP;
  pre.style.fontFamily = CSS_FONT_FAMILY_MONO;
  pre.style.lineHeight = CSS_LINE_HEIGHT;
  const tip = modal.contentEl.createEl('p');
  tip.setText('峰值太高说明那天排太满：可以在设置里调「复习间隔缩放」，或用「休假到」把节奏压后。');
  tip.style.color = CSS_COLOR_MUTED;
  tip.style.fontSize = CSS_FONT_SIZE_SMALLER;
  modal.open();
}
