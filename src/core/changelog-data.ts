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
    date: '2026-11-21',
    added: [
      { domain: '工作台', text: '双栏复习工作台，五种卡片形态混排，切到哪张就换成哪种题面。' },
      { domain: '复习方式', text: '抽认卡、做题、填空、上下文、展开全文，每张卡各记各的方式。' },
      { domain: '加入流程', text: '笔记、选段、文件夹、阅读器、手动创建都走同一条流程，确认才入库。' },
      { domain: '挑内容', text: '从阅读器按划线或章节挑，AI 只挑值得长期记住的句子。' },
      { domain: 'Anki 导入', text: '直接读官方导出的 apkg，按名配对媒体，遮挡卡一起进来。' },
      { domain: '模板与媒体', text: '正反面字段自选，能放图和音频，图片遮挡卡点一下揭示。' },
      { domain: '牌组与标签', text: '自建牌组、随手打标签，筛选和按书档案都认。' },
      { domain: '备份回滚', text: '多份自动备份，任意时间点回滚，回滚前再留一份快照。' },
      { domain: 'FSRS-7', text: '按记忆稳定性排期，参数随复习记录自适应拟合。' },
      { domain: '按书档案', text: '按书或文件夹汇总留存与逾期，一键导出 Markdown 报告。' },
      { domain: '管理器', text: '挂起、埋藏、恢复、手动排期，挂起和埋藏不改 FSRS 排期。' },
      { domain: '更多菜单', text: '筛选、数据、设置、成就和批量选择收进更多菜单。' },
      { domain: '英文界面', text: '界面、命令、通知与设置支持英文，语言跟随 Obsidian。' },
    ],
    improved: [
      { domain: '空态引导', text: '没装 bz Reader 时点一下直达设置里的插件组。' },
      { domain: '听卡片', text: '本地 TTS 朗读，离线可用、不按次收费，合成结果缓存。' },
      { domain: '回到原文', text: '揭示答案后跳回书里那一句，老版本推来的卡也能兜底。' },
      { domain: '学习步骤', text: '新卡与重学对齐 Anki 的 1 分钟加 10 分钟，两类分开限额。' },
      { domain: '手机端', text: '工作栏自动收起，卡片占满屏幕，筛选控件换行不截断。' },
      { domain: '记忆分析', text: '留存率、稳定性、难度、评级分布、未来排程与逾期都在一处。' },
      { domain: '弹窗', text: '8 个弹窗统一头尾与焦点行为，窄屏激活码输入框铺满整行。' },
    ],
    fixed: [
      { domain: '重复加入', text: '查重认整篇钥匙，同一篇笔记不会因为入口不同进两份。' },
      { domain: '预设方式', text: '只跳过选方式，题面仍然必须人审。' },
      { domain: '额度到顶', text: '弹同一份对照窗引导升级，不再显示加入失败。' },
      { domain: '管理器', text: '操作按钮图标此前未渲染，已补上图标挂载。' },
      { domain: '窄窗口', text: '筛选栏末项被挤压成半截字，已改为换行。' },
      { domain: '填空卡', text: 'AI 只回半句时降级为看原文，不再让用户背残句。' },
    ],
  },

];
