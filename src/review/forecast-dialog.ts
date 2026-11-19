/**
 * 未来负荷（批 6，界面层）。
 *
 * 一个纯文字弹窗就够：用户只需要知道「哪几天会堆起来」。做成图表要多一个
 * 画布、多一套配色、多一处暗色模式适配，收益却不如一行峰值日来得直接。
 * 2026-11-20 起统一走 core/flow-dialog，不再单开原生 Modal。
 */
import type { App } from 'obsidian';
import type { LoadPoint } from './queue';
import { forecastToText } from './report';
import { openFlowDialog } from '../core/flow-dialog';

export function openForecastDialog(app: App, points: readonly LoadPoint[]): void {
  void app;
  const body = createDiv();
  const pre = body.createEl('pre');
  pre.setText(forecastToText(points, 21));
  const tip = body.createEl('p');
  tip.setText('峰值太高说明那天排太满：可以在设置里调「复习间隔缩放」，或用「休假到」把节奏压后。');
  void openFlowDialog({
    title: '未来复习负荷',
    message: '',
    body,
    actions: [{ label: '知道了', value: 'ok', cta: true }],
  });
}
