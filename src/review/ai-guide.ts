/* ============================================================
 * 复习 · AI 未配置的引导（review/ai-guide.ts）
 *
 * 2026-11-19 用户口径：AI 功能在「自己没配 + 共享也没借到」时要给一个能点的
 * 出口——点了直接落到设置面板的 AI 组，而不是一句「看看 AI 配置」让人自己找。
 *
 * 判据只认 `getAIProvider()`：它内部已经处理了「共享 bz Reader 的配置」，
 * 换句话说共享开着且对方配好了，这里就不会弹。
 * ============================================================ */
import { openFlowDialog } from '../core/flow-dialog';
import { requestSettingsPanel } from '../core/settings-provider';
import { t } from '../i18n/strings';

/** 把错误压成人话（缺密钥的原始错误已经够清楚，别再套一层） */
function errText(e: unknown): string {
  const msg = (e as Error)?.message;
  return typeof msg === 'string' ? msg.trim() : '';
}

/**
 * AI 就绪检查；没就绪 → 弹引导框并返回 false。
 *
 * @param why 这一步为什么需要 AI（「重新生成要用 AI」这种），拼进提示正文。
 */
export async function aiReadyOrGuide(why?: string): Promise<boolean> {
  const { getAIProvider } = await import('../core/ai');
  try {
    await getAIProvider();
    return true;
  } catch (e) {
    const detail = errText(e) || t('aig.notConfigured');
    void openFlowDialog({
      title: t('aig.notConfiguredShort'),
      message:
        `${why ? `${why}，` : ''}${detail}。` +
        t('aig.howto') +
        t('aig.shareHint'),
      actions: [
        { label: t('aig.goSettings'), value: 'settings', cta: true },
        { label: t('aig.later'), value: 'cancel' },
      ],
    }).then((v) => {
      if (v !== 'settings') return;
      /* 设置是本插件主面板里的内置页；anchor='ai' 让页面滚到 AI 组 */
      requestSettingsPanel('review', 'ai');
    });
    return false;
  }
}
