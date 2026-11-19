/* 点一下复制群号（与 reader 关于条同口径） */
import { notice } from '../../core/notice';
import { GROUP_ID } from '../../data/entitlement';

export async function copyReviewGroupId(): Promise<void> {
  try {
    await navigator.clipboard.writeText(GROUP_ID);
    notice(`已复制群号 ${GROUP_ID}，去 QQ 搜索就能找到`, 'success');
  } catch {
    notice(`复制失败，群号是 ${GROUP_ID}`, 'error');
  }
}
