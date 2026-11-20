/* 照搬 reader 的对外链接与外链打开方式，地址换成 bz-review 自己的 */
import { requestUrl } from 'obsidian';
import { REPO_SLUG } from '../../core/remote-base';
import { GROUP_ID } from '../../data/entitlement';

export const REPO_URL = `https://github.com/${REPO_SLUG}`;
/** 关于条用的推荐向那一集（第 1P；环境自检那一处仍用各自的分 P） */
export const VIDEO_TUTORIAL_URL = 'https://www.bilibili.com/video/BV1vNsZ6pE7i/?p=1';

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
