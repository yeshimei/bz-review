/**
 * 统计与划线卡的导出落盘（批 6，IO 薄层）。
 *
 * 与备份不同：这两样是「给人看/带走」的产物，默认写在库里能直接打开的位置，
 * 而不是藏在数据目录——用户导出完的第一件事是打开看看长什么样。
 */
import type { App } from 'obsidian';
import type { ReviewItem } from './data';
import { computeStats } from './stats';
import { cardsToMarkdown, statsToCsv } from './report';
import { exportDir } from './backup-io';
import { reviewApp } from './app';

function stamp(now: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
}

async function ensureDir(app: App, dir: string): Promise<void> {
  try {
    if (!(await app.vault.adapter.exists(dir))) await app.vault.adapter.mkdir(dir);
  } catch {
    /* 已存在/并发创建：写盘会给出真实错误 */
  }
}

/** 统计导出成 CSV（放导出目录，和备份在一起） */
export async function exportStatsCsv(app: App, items: readonly ReviewItem[]): Promise<string> {
  const dir = exportDir();
  await ensureDir(app, dir);
  const path = `${dir}/review-stats-${stamp(new Date())}.csv`;
  const stats = computeStats(items as ReviewItem[], { w: reviewApp.currentW() });
  await app.vault.adapter.write(path, statsToCsv(stats));
  return path;
}

/** 划线卡导出成 Markdown（写在库里的「复习卡片」文件夹，可直接打开） */
export async function exportCardsMarkdown(app: App, items: readonly ReviewItem[]): Promise<string> {
  const dir = '复习卡片';
  await ensureDir(app, dir);
  const path = `${dir}/划线卡.md`;
  await app.vault.adapter.write(path, cardsToMarkdown(items));
  return path;
}
