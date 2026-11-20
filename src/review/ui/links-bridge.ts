/* 照搬 reader 的对外链接与外链打开方式，地址换成 bz-review 自己的 */
import { requestUrl } from 'obsidian';
import { notice } from '../../core/notice';
import { REPO_SLUG } from '../../core/remote-base';
import { GROUP_ID } from '../../data/entitlement';

export const REPO_URL = `https://github.com/${REPO_SLUG}`;
/**
 * 视频教程地址（2026-11-20）。
 *
 * 视频还没做，这里**故意留空**：不留任何 B 站占位地址，用户点到的每一下都由
 * `openVideoTutorial()` 弹一句「还在制作中」，不跳浏览器。做好后只改这一行，
 * 空态、设置页、更新日志三处入口同时生效。
 */
export const VIDEO_TUTORIAL_URL = '';

/**
 * 打开视频教程（空态 / 设置关于条 / 更新日志页脚共用）。
 * 地址为空 = 还没发布，弹通知；有地址就照旧走系统浏览器。
 */
export function openVideoTutorial(): void {
  if (!VIDEO_TUTORIAL_URL) {
    notice('视频教程还在制作中，做好后会在这里更新', 'info');
    return;
  }
  openExternalUrl(VIDEO_TUTORIAL_URL);
}

/**
 * 插件组「下载 bz Reader」（2026-11-20）：GitHub Release 页面直接下载三件套，
 * 码云作备份路线。两条都指向 latest，版本随发布自动跟进。
 */
export const READER_DOWNLOAD_URL =
  'https://github.com/yeshimei/bz-reader/releases/latest';
export const READER_DOWNLOAD_MIRROR =
  'https://gitee.com/ntbl/bz-reader/releases/latest';
export { GROUP_ID };

/** 桌面优先 Electron shell，移动端退回 window.open（与 reader 逐字同口径） */
export function openExternalUrl(url: string): void {
  if (!url) return;
  try {
    const req = (window as unknown as { require?: (m: string) => unknown }).require;
    const electron = req?.('electron') as { shell?: { openExternal?: (u: string) => Promise<void> | void } } | undefined;
    if (electron?.shell?.openExternal) {
      void electron.shell.openExternal(url);
      return;
    }
  } catch {
    /* 移动端 / 拿不到 electron：走下面的兜底 */
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * 打开下载页：GitHub 主线路，连不通自动切码云备份（2026-11-20）。
 * requestUrl 探测（走宿主网络栈、免 CORS）+ race 超时；对用户就是「点一下开浏览器」。
 */
export async function openDownloadWithFallback(primary: string, mirror: string): Promise<void> {
  const timeoutMs = 5000;
  let ok = false;
  try {
    const probe = requestUrl({ url: primary, method: 'HEAD', throw: false });
    let timer: number | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = window.setTimeout(() => reject(new Error('probe timeout')), timeoutMs);
    });
    try {
      const res = await Promise.race([probe, timeout]);
      ok = Number(res.status) >= 200 && Number(res.status) < 400;
    } finally {
      if (timer !== undefined) window.clearTimeout(timer);
    }
  } catch {
    ok = false;
  }
  openExternalUrl(ok ? primary : mirror);
}
