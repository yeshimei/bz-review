/**
 * 媒体卡 / 图片遮挡的配置弹窗（2026-11-20）。
 *
 * 以前复习界面把卡片当纯文本显示，图片标签根本不渲染；Anki 导入也只把媒体换成
 * `[图片：文件名]` 占位。这里让用户挑库内的图片/音频文件关联到卡片上，复习时
 * 真实显示或播放。图片遮挡用百分比坐标画方块，不依赖拖拽——手机也能按。
 */
import type { App, TFile } from 'obsidian';
import type { ReviewCard } from './data';
import { openFlowDialog } from '../core/flow-dialog';
import { notice } from '../core/notice';

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
const AUDIO_EXT = /\.(mp3|wav|ogg|m4a|aac|flac|webm)$/i;

export interface MediaConfig {
  mode: 'media' | 'occlusion';
  media?: { images?: string[]; audio?: string };
  occlusion?: ReviewCard['occlusion'];
}

/** 库里所有图片/音频文件路径，给输入框做候选 */
function mediaFiles(app: App): string[] {
  try {
    return app.vault
      .getFiles()
      .filter((f): f is TFile => IMAGE_EXT.test(f.extension) || AUDIO_EXT.test(f.extension))
      .map((f) => f.path);
  } catch {
    return [];
  }
}

function pickerInput(host: HTMLElement, label: string, value: string, candidates: string[], listId: string): HTMLInputElement {
  const field = host.createDiv({ cls: 'bzrv-edit-field' });
  field.createDiv({ cls: 'bzrv-edit-head', text: label });
  const input = field.createEl('input');
  input.type = 'text';
  input.value = value;
  input.setAttribute('list', listId);
  const dl = field.createEl('datalist');
  dl.id = listId;
  for (const c of candidates) {
    const o = dl.createEl('option');
    o.value = c;
  }
  return input;
}

/**
 * 打开配置弹窗。onSave 由调用方落盘（dataManager.updateCardMedia）。
 * 两种模式共用一个壳：媒体卡填图片/音频路径；图片遮挡填一张图 + 若干区域。
 */
export function openMediaEditor(
  app: App,
  card: ReviewCard,
  onSave: (config: MediaConfig) => void | Promise<void>
): void {
  const root = createDiv();
  root.className = 'bzrv-edit-modal';
  const files = mediaFiles(app);
  const images = files.filter((p) => IMAGE_EXT.test(p));
  const audios = files.filter((p) => AUDIO_EXT.test(p));

  const modeField = root.createDiv({ cls: 'bzrv-edit-field' });
  modeField.createDiv({ cls: 'bzrv-edit-head', text: '卡片方式' });
  const modeSel = modeField.createEl('select');
  modeSel.className = 'bzrv-input';
  const mMedia = modeSel.createEl('option', { value: 'media', text: '媒体卡（图片 / 音频）' });
  const mOccl = modeSel.createEl('option', { value: 'occlusion', text: '图片遮挡' });
  const isOccl = card.mode === 'occlusion';
  modeSel.value = isOccl ? 'occlusion' : 'media';
  void mMedia;
  void mOccl;

  /* 媒体卡输入 */
  const mediaWrap = root.createDiv();
  const imgInput = pickerInput(mediaWrap, '图片（库内路径，逗号分隔可多张）', (card.media?.images ?? []).join(', '), images, 'bzrv-media-img');
  const audioInput = pickerInput(mediaWrap, '音频（库内路径）', card.media?.audio ?? '', audios, 'bzrv-media-audio');

  /* 图片遮挡输入 */
  const occlWrap = root.createDiv();
  const occlImg = pickerInput(occlWrap, '要遮挡的图片（库内路径）', card.occlusion?.image ?? '', images, 'bzrv-occl-img');
  const regionField = occlWrap.createDiv({ cls: 'bzrv-edit-field' });
  regionField.createDiv({ cls: 'bzrv-edit-head', text: '遮挡区域' });
  regionField.createDiv({
    cls: 'bzrv-edit-desc',
    text: '每行一块：左%,上%,宽%,高%,答案文字。例如 10,20,30,15,长江。坐标是图片上的百分比，手机也能用。',
  });
  const regionArea = regionField.createEl('textarea', { cls: 'bzrv-edit-area' });
  regionArea.rows = 4;
  regionArea.value = (card.occlusion?.regions ?? [])
    .map((r) => [r.x, r.y, r.w, r.h, r.label].join(','))
    .join('\n');

  const syncMode = (): void => {
    const occl = modeSel.value === 'occlusion';
    mediaWrap.style.display = occl ? 'none' : '';
    occlWrap.style.display = occl ? '' : 'none';
  };
  syncMode();
  modeSel.onchange = syncMode;

  void openFlowDialog({
    title: '配置媒体卡',
    message: '只改这张卡的媒体与方式，复习排期不动。填库内已有文件的路径（下拉可选）。',
    body: root,
    actions: [
      { label: '取消', value: 'cancel' },
      { label: '保存', value: 'ok', cta: true },
    ],
  }).then((v) => {
    if (v !== 'ok') return;
    if (modeSel.value === 'media') {
      const imgs = imgInput.value
        .split(/[,，\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const audio = audioInput.value.trim();
      if (!imgs.length && !audio) {
        notice('至少填一张图片或一个音频', 'warning');
        return;
      }
      void Promise.resolve(onSave({ mode: 'media', media: { images: imgs, audio: audio || undefined } }));
    } else {
      const image = occlImg.value.trim();
      if (!image) {
        notice('要遮挡的图片不能为空', 'warning');
        return;
      }
      const regions = regionArea.value
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [x, y, w, h, ...rest] = line.split(',').map((s) => s.trim());
          return { x: Number(x), y: Number(y), w: Number(w), h: Number(h), label: rest.join(',') };
        })
        .filter((r) => Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.w) && Number.isFinite(r.h) && r.w > 0 && r.h > 0 && r.label);
      if (!regions.length) {
        notice('至少要有一块遮挡区域（左,上,宽,高,答案）', 'warning');
        return;
      }
      void Promise.resolve(onSave({ mode: 'occlusion', occlusion: { image, regions } }));
    }
  });
}
