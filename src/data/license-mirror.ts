/**
 * 激活码镜像（src/data/license-mirror.ts）
 *
 * 与 bz Reader 同口径：data.json 是真相，localStorage 只是一份兜底镜像。
 * 删了插件目录重装、data.json 被清掉时，码还能从镜像拿回来——不然用户
 * 得回头翻邮件找码。
 *
 * 镜像里只放**码原文**，不放「已激活」结论：结论每次启动都从码真验一次
 * （见 entitlement.refreshLicense）。所以往 localStorage 里塞假码没有用，
 * 跟改 data.json 一样过不了验签。
 */
export const LICENSE_MIRROR_KEY = 'bz-review:license:v1';

/** 只需要这三个方法的窄接口，便于测试用内存 mock，也便于 WebView 里退化成 null */
export interface CodeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** data.json 里没有码时从镜像取回；取不到返回空 */
export function readLicenseMirror(store: CodeStorage | null): string {
  if (!store) return '';
  try {
    const raw = store.getItem(LICENSE_MIRROR_KEY);
    return typeof raw === 'string' && raw.trim() ? raw.trim() : '';
  } catch {
    return '';
  }
}

/** 每次保存设置时同步镜像；码清空就删镜像，不给旧码留复活机会 */
export function writeLicenseMirror(store: CodeStorage | null, code: string): void {
  if (!store) return;
  try {
    if (code && code.trim()) store.setItem(LICENSE_MIRROR_KEY, code.trim());
    else store.removeItem(LICENSE_MIRROR_KEY);
  } catch {
    /* 隐私模式 / 移动端 WebView 可能禁 localStorage：镜像失败不该影响主流程 */
  }
}
