/* 照搬 reader 的对外链接与外链打开方式，地址换成 bz-review 自己的 */
import { REPO_SLUG } from '../../core/remote-base';
import { GROUP_ID } from '../../data/entitlement';

export const REPO_URL = `https://github.com/${REPO_SLUG}`;
/** 关于条用的推荐向那一集（第 1P；环境自检那一处仍用各自的分 P） */
export const VIDEO_TUTORIAL_URL = 'https://www.bilibili.com/video/BV1vNsZ6pE7i/?p=1';
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
