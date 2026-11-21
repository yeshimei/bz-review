/**
 * 手动指定下次复习日期（批 3，界面层）。
 *
 * 「明天要考试，今晚想再过一遍」「这本书明天还」，这些都是排期管不到的情况。
 * 排期是算出来的，人总有临时安排；给一个直接改日期的入口，比让用户去改系统时间体面。
 * 2026-11-20 起统一走 core/flow-dialog，不再单开原生 Modal。
 */
import type { App, TFile } from 'obsidian';
import { notice } from '../core/notice';
import { reviewApp } from './app';
import { openFlowDialog } from '../core/flow-dialog';
import { t } from '../i18n';

function toDateInput(iso?: string | null): string {
  const d = iso ? new Date(iso) : new Date(Date.now() + 86400000);
  const base = Number.isFinite(d.getTime()) ? d : new Date(Date.now() + 86400000);
  const mm = String(base.getMonth() + 1).padStart(2, '0');
  const dd = String(base.getDate()).padStart(2, '0');
  return `${base.getFullYear()}-${mm}-${dd}`;
}

export async function openNextDateDialog(app: App, file: TFile | null): Promise<void> {
  if (!file) {
    notice(t('nextdate.noNote'), 'warning');
    return;
  }
  reviewApp.ensure(app);
  const items = await reviewApp.dataManager!.loadItems();
  const item = items.find((i) => i.filePath === file.path);
  if (!item) {
    notice(t('nextdate.notInPlan'), 'warning');
    return;
  }
  const body = createDiv();
  const field = body.createDiv({ cls: 'bzrv-edit-field' });
  field.createDiv({ cls: 'bzrv-edit-head', text: t('nextdate.date') });
  field.createDiv({ cls: 'bzrv-edit-desc', text: t('nextdate.dateDesc') });
  const input = field.createEl('input');
  input.type = 'date';
  input.value = toDateInput(item.nextReviewDate);

  const v = await openFlowDialog({
    title: t('nextdate.title'),
    message: '',
    body,
    actions: [
      { label: t('common.cancel'), value: 'cancel' },
      { label: t('common.save'), value: 'ok', cta: true },
    ],
  });
  if (v !== 'ok') return;
  const value = input.value;
  /* 时间定在当天 09:00：太早会把人堵在半夜，太晚则当天上午看不到它 */
  const at = new Date(`${value}T09:00:00`);
  if (!Number.isFinite(at.getTime())) {
    notice(t('nextdate.badDate'), 'warning');
    return;
  }
  const ok = await reviewApp.dataManager!.setNextReview(file.path, at.toISOString());
  notice(ok ? t('nextdate.done', { date: value }) : t('nextdate.gone'), ok ? 'success' : 'warning');
  if (ok) void reviewApp.refreshPanel();
}
