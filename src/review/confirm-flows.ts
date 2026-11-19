/**
 * 移出 / 顺延的二次确认（2026-11-19 用户口径）。
 *
 * 背景：单条移出原先按「效率整改 5」口径免确认直达（只给 6 秒撤销 toast）。
 * 用户真机反馈：右键抽屉、卡片管理器那两行垃圾桶一碰就把条目挪走，撤销 toast
 * 一过就只能去回收站里翻——要求所有手动移出都先弹一次确认；批量顺延同样要有。
 *
 * 为什么单独一层：移出有四个手动入口（队列抽屉 / 卡片管理器 / 批量选择 / 命令），
 * 各写一遍就是四份文案、四套按钮顺序，改一次漏三处。这里只认「问一句」，
 * 确认之后照样保留撤销 toast——确认不是替代反悔窗口，是补一道前置闸。
 *
 * 不走确认的路径（有意为之）：监听文件夹发现文件被删、复习会话里原文已不在，
 * 这两条是自动清理，弹窗只会打断无人值守的流程。
 */
import { openFlowDialog } from '../core/flow-dialog';

/** 确认移出：name 只给单条用；给了 count 就按批量口径写标题 */
export async function confirmRemovePlan(opts: { name?: string; count?: number } = {}): Promise<boolean> {
  const count = Math.max(1, Math.round(opts.count ?? 1));
  const what = count > 1 ? `${count} 条` : opts.name ? `「${opts.name}」` : '这条';
  const v = await openFlowDialog({
    title: `移出${what}？`,
    message: '移出后先进回收站，30 天内都能恢复，排期与复习历史一并保留。',
    actions: [
      { label: '取消', value: 'cancel' },
      { label: '移出', value: 'ok', cta: true, danger: true },
    ],
  });
  return v === 'ok';
}

/** 确认顺延：批量选择那条「顺延 N 天」用；单条排期自带选择框，不再叠一层 */
export async function confirmPostponePlan(count: number, days: number): Promise<boolean> {
  const n = Math.max(1, Math.round(count));
  const span = Math.max(1, Math.round(days));
  const v = await openFlowDialog({
    title: n > 1 ? `把 ${n} 条顺延 ${span} 天？` : `顺延 ${span} 天？`,
    message: `下次复习日期整体往后推 ${span} 天；想改回来可以去卡片管理器里手动排期。`,
    actions: [
      { label: '取消', value: 'cancel' },
      { label: '顺延', value: 'ok', cta: true },
    ],
  });
  return v === 'ok';
}
