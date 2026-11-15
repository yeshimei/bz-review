/**
 * 未来负荷（批 6，界面层）。
 *
 * 一个纯文字弹窗就够：用户只需要知道「哪几天会堆起来」。做成图表要多一个
 * 画布、多一套配色、多一处暗色模式适配，收益却不如一行峰值日来得直接。
 */
import { Modal, type App } from 'obsidian';
import type { LoadPoint } from './queue';
import { forecastToText } from './report';

export function openForecastDialog(app: App, points: readonly LoadPoint[]): void {
  const modal = new Modal(app);
  modal.titleEl.setText('未来复习负荷');
  const pre = modal.contentEl.createEl('pre');
  pre.setText(forecastToText(points, 21));
  pre.style.whiteSpace = 'pre-wrap';
  pre.style.fontFamily = 'var(--font-monospace)';
  pre.style.lineHeight = '1.6';
  const tip = modal.contentEl.createEl('p');
  tip.setText('峰值太高说明那天排太满：可以在设置里调「复习间隔缩放」，或用「休假到」把节奏压后。');
  tip.style.color = 'var(--text-muted)';
  tip.style.fontSize = 'var(--font-ui-smaller)';
  modal.open();
}
