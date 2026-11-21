/**
 * 未来负荷（批 6，界面层）。
 *
 * 用户只需要知道「哪几天会堆起来」，所以不做图表库；柱子用 DOM 条形走强调色，
 * 切档/明暗自动跟随，无需另配一套颜色。2026-11-20 起统一走 core/flow-dialog。
 */
import type { App } from 'obsidian';
import type { LoadPoint } from './queue';
import { forecastToText, renderForecastInto } from './report';
import { openFlowDialog } from '../core/flow-dialog';

export function openForecastDialog(app: App, points: readonly LoadPoint[]): void {
  void app;
  const body = createDiv();
  const bars = body.createDiv({ cls: 'bzrv-fc-bars' });
  renderForecastInto(bars, forecastToText(points, 21));
  const tip = body.createEl('p');
  tip.setText('峰值太高说明那天排太满：可以在设置里调「复习间隔缩放」，或用「休假到」把节奏压后。');
  void openFlowDialog({
    title: '未来复习负荷',
    message: '',
    body,
    actions: [{ label: '知道了', value: 'ok', cta: true }],
  });
}
