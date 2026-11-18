/* ============================================================
 * bz · 更新日志数据（core/changelog-data.ts，内置）
 *
 * 2026-11-02 用户拍板：**更新提示不再下载远端日志**，直接内置进 main.js——
 * 省掉一次网络往返、省掉「远端日志没跟上就弹上一版内容」这一整类问题，
 * 也让提示在离线时照常能弹。
 *
 * 2026-11-02 二次拍板：小窗里**把能拿到的历史版本全列出来**（保留最近 50 版），
 * 用户自己滚、自己点，不再按「上次看到哪版」掐区间，也就不必猜用户的升级路径。
 *
 * 数据来源，以及一次必须记住的翻车（2026-11-02 用户当场纠正）：
 *  - 1.35.0 起取自 downloads/bz-changelog.html（按 git tag 切块，与 Releases 一一对应）；
 *  - 曾按旧手册回填过 1.0.0 → 1.25.0 那 26 条——日期是「每周一一条、09-08 起每天一条」
 *    的**部署周记**，版本号是我照顺序硬套上去的，等于编了 26 个从未发布的版本。
 *    已整段删除。**宁可少，不许假**：内置日志是小窗唯一的真相源，混进假版本就是骗人。
 *  - 1.26.0 → 1.34.1 本来就没有日志块（当年版本号手写，不生成），不必补。
 *
 * 发版时的手工约定：每版发布前在这里**插到最前面**一条，version 必须与 manifest.json
 * 完全一致（`pickReleaseFor` 是全等匹配，不是就近匹配）。忘了加 = 这版不弹提示，
 * 不会弹错版本——这是刻意选的失败方向。条数超过 50 版时从末尾裁掉最旧的。
 * ============================================================ */
import { normalizeVersion } from './version';

/** 一条日志条目（domain 是域名小标签，sub 是弱化副行） */
export interface ChangelogEntry {
  domain: string;
  text: string;
  sub?: string;
}

/** 一个版本的日志块 */
export interface ChangelogRelease {
  version: string;
  date?: string;
  added?: ChangelogEntry[];
  improved?: ChangelogEntry[];
  fixed?: ChangelogEntry[];
}

/** 取与 version 完全相等的那个日志块；找不到 → null（调用方据此「不弹、不记账」） */
export function pickReleaseFor(releases: readonly ChangelogRelease[], version: string): ChangelogRelease | null {
  const target = normalizeVersion(version);
  if (!target) return null;
  return releases.find((r) => normalizeVersion(r?.version || '') === target) || null;
}

/** 这一版有多少条改动（三段求和） */
export function releaseEntryCount(release: ChangelogRelease): number {
  return (release.added?.length || 0) + (release.improved?.length || 0) + (release.fixed?.length || 0);
}

/**
 * 内置日志（**最新在前**，最多 50 版）。
 * 文案口径与 docs/note-v<版本>.md（以及由此产出的 docs/changelog.html）一致——
 * 同名同句，不要在这里另写一版。
 */
export const CHANGELOG_RELEASES: readonly ChangelogRelease[] = [
  {
    version: '1.0.0',
    date: '2026-11-18',
    added: [
      { domain: '工作台', text: '双栏复习工作台，卡片形态随类型实时切换。' },
      { domain: '复习方式', text: '抽认卡、做题、填空、上下文、展开全文，五种方式按卡记忆。' },
      { domain: '听卡片', text: '本地 TTS 朗读，离线可用，不按次收费。' },
      { domain: '回到原文', text: '揭示答案后跳回书里那一句。' },
      { domain: '按书档案', text: '分组统计与 Markdown 报告导出。' },
      { domain: '卡片管理器', text: '挂起、埋藏、手动排期，不改 FSRS 排期。' },
    ],
    improved: [
      { domain: 'Reader 联动', text: '推卡时带上跳回原文的链接与前后文。' },
      { domain: '记忆分析', text: '留存率、稳定性、难度、评级分布、未来排程与逾期清单。' },
      { domain: '移动端', text: '工作栏自动收起，筛选控件换行不截断。' },
    ],
    fixed: [
      { domain: '管理器', text: '操作按钮图标此前未渲染，已补上图标挂载。' },
      { domain: '窄窗口', text: '筛选栏末项被挤压成半截字，已改为换行。' },
      { domain: '填空卡', text: 'AI 只回半句时降级为看原文，不再让用户背残句。' },
    ],
  },

];
