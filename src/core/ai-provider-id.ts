/* ============================================================
 * bz · AI 服务商 id 解析（core/ai-provider-id.ts）
 *
 * 纯函数：只回答「这次该用哪个服务商」，不碰设置、不碰网络，
 * 目的是让「不启用」这件事能在 node 里直接断言。
 *
 * 拆出来的原因是一次真机事故：设置页把服务商选成「不启用」，复习时模型
 * 照样被调用。根子在 `s.aiProvider || DEFAULT_AI_PROVIDER` —— 空串是
 * **用户明确关掉**，`||` 却把它当成「没值」兜底回缺省服务商，于是每一张
 * 卡都在花用户的钱，而界面上写着「不启用」。
 *
 * 口径：只有真正「没这个字段」（undefined / null）才算没设置；空串、
 * 空白一律是「关掉」。
 * ============================================================ */

/** 缺省服务商（注册表首位；字段缺失时用它） */
export const DEFAULT_AI_PROVIDER = 'deepseek';

/**
 * 设置里的原始值 → 本次要用的服务商 id。
 *
 * 返回空串表示「用户关掉了 AI」——调用方应据此拦下请求，而不是自己再兜底。
 */
export function resolveProviderId(raw: string | null | undefined): string {
  if (raw === undefined || raw === null) return DEFAULT_AI_PROVIDER;
  return String(raw).trim();
}
