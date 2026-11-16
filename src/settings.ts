/**
 * 设置模型（src/settings.ts）
 *
 * 从 bz 拆出来时只留复习真正会读的字段：复习节奏 / 划线卡 / 做题家 / 提醒 /
 * 记忆拟合 / 面板尺寸，加上 AI 与激活码。
 *
 * `core/settings-provider.ts` 的 `panelSizePersist` 会拿 `keyof BzSettings` 做
 * 编译期约束，所以字段名必须与 bz 那份逐字一致——改了会让面板尺寸记忆静默失效。
 */

/** 强调色档位：auto 跟随 Obsidian，其余为固定色板。落盘值，body 挂 data-bzaccent 供 CSS 选档。 */
export type AccentMode = 'auto' | 'copper' | 'indigo' | 'moss';

const ACCENT_MODES: AccentMode[] = ['auto', 'copper', 'indigo', 'moss'];

/** 非法/历史遗留值一律回落 auto，别把脏档位写到 body 上 */
export function normalizeAccent(v: unknown): AccentMode {
  return ACCENT_MODES.includes(v as AccentMode) ? (v as AccentMode) : 'auto';
}

/** 把强调色档位挂到 body，CSS 按 body[data-bzaccent] + .theme-light/.theme-dark 选色。 */
export function applyAccent(v: unknown): void {
  document.body.dataset.bzaccent = normalizeAccent(v);
}

export default interface BzSettings {
  /** 共享 JSON 数据目录（复习的 review.json 住这里） */
  storagePath: string;
  /** 界面语言：auto / zh / en */
  language: string;
  /** 强调色档位（界面交互色单一来源）：auto 跟随 Obsidian，读不到回退铜金 */
  accent: AccentMode;
  /** 高级版激活码（离线验签） */
  licenseKey: string;

  // ===== 复习 =====
  /** 有笔记到期待复习时自动提醒 */
  enableAutoNotify: boolean;
  /** 新笔记被自动加入时提示一句 */
  reviewAutoAddNotice: boolean;
  /** 复习时强制做题（做题家） */
  forceQuizForReview: boolean;
  /** 每日复习上限，0 = 不限 */
  reviewDailyLimit: number;
  /** 间隔缩放（1 = 标准） */
  reviewIntervalScale: number;
  /** 文件树显示复习角标 */
  reviewTreeBadge: boolean;
  /** 按复习历史拟合个人记忆曲线 */
  reviewEnableFit: boolean;
  /** 每复习多少次重算一次拟合 */
  reviewFitEveryN: number;
  /** 拟合的召回阈值 */
  reviewRThreshold: number;
  /**
   * 旧版的**全局**划线卡复习方式（AI 抽认卡 / 填空 / 上下文 / 做题 / 展开全文）。
   *
   * 2026-11-15 起复习方式跟着每张卡自己走（`ReviewCard.mode`），这个字段只做两件事：
   *   1. 老卡片（没有 `mode`）的回落值；
   *   2. 加入计划时的默认值（`reviewCardDefaultMethod` 为「手动」时不再读它）。
   * 新代码不要直接读它，用 `card-ai.ts` 的 `modeOfCard()`；设置页也不再暴露这个开关。
   */
  reviewCardMode: 'flashcard' | 'cloze' | 'context' | 'quiz' | 'plain';
  /**
   * 新卡默认制卡方式：manual = 每次让用户选（默认）；
   * 选了具体方式就不再弹选择界面，新卡一律按它制。
   */
  reviewCardDefaultMethod: 'manual' | 'flashcard' | 'cloze' | 'context' | 'quiz' | 'plain';
  /** 开卡前是否弹二次确认面板（抽认卡可改内容、做题卡可删题）；默认开 */
  reviewCardConfirm: boolean;
  /** 评级键位（四个字符，顺序＝忘了/困难/一般/简单；默认 1234） */
  reviewRatingKeys: string;
  /** 休假到哪天（ISO；空 = 不休假）。到期那天把整份计划顺延，回来不雪崩 */
  reviewVacationUntil: string;
  /** 休假开始时间（ISO；用于算顺延多长，用户看不到） */
  reviewVacationFrom: string;
  /** 最长复习间隔（天；0 = 不限） */
  reviewMaxIntervalDays: number;
  /** 手填 FSRS 权重（19 个数，逗号分隔；空 = 用拟合值） */
  reviewFsrsWeights: string;
  /** 每轮新条目上限（0 = 不限） */
  reviewNewLimit: number;
  /** 每轮到期条目上限（0 = 不限） */
  reviewReviewLimit: number;
  /** 本轮顺序：先清到期（due-first）/ 先上新卡（new-first）；用字符串是为了走通用文本绑定 */
  reviewOrder: string;
  /** 每日提醒时间 HH:MM（空 = 不提醒） */
  reviewRemindAt: string;
  /** 上次提醒的日期（YYYY-MM-DD，防一天弹多次；用户看不到） */
  reviewRemindLast: string;
  /** 低配/纯文字：分析改走文字报告，不跑动效 */
  reviewAnalysisPlain: boolean;
  /** 做题时每轮抽题比例（1/3、1/2…） */
  reviewCardQuizRatio: number;
  /** 被监控并自动加入复习的文件夹 */
  reviewWatchedFolders: string[];
  /** 排除在自动加入之外的笔记 */
  reviewExcludedNotes: string[];
  /** 面板布局（预留） */
  reviewSkin: string;
  /** 面板主题（预留） */
  reviewSkinTheme: string;
  /** 主界面打开方式：native = Obsidian 标签页（默认），popup = 插件自绘浮层 */
  reviewPanelMode: 'native' | 'popup';
  /** 主面板宽高记忆，0 = 未拖过 */
  reviewPanelWidth: number;
  reviewPanelHeight: number;
  /** 做题家每篇笔记出题数量，'0' = 自动 */
  questionsPerNote: string;
  /** 做题家：四选一（关闭则填空） */
  enableMultipleChoice: boolean;
  /** 做题家：每次打乱选项顺序 */
  shuffleQuestions: boolean;
  /** 做题家：出题难度 */
  difficulty: string;

  // ===== AI（划线卡的抽认卡与出题要用）=====
  aiProvider: string;
  deepseekApiKey: string;
  zhipuPlanApiKey: string;
  ollamaApiKey: string;
  aiCustomEndpoint: string;
  aiCustomApiKey: string;
  aiModelOverrides: Record<string, string>;
  aiMaxTokensOverrides: Record<string, number>;
  aiThinkingOverrides: Record<string, string>;
}

export const DEFAULT_SETTINGS: BzSettings = {
  /* 与 bz 的默认值故意不同：bz 用 CONFIG/STORAGE，这里用 CONFIG/REVIEW，
     两个插件同时装也不会抢同一个 review.json。 */
  storagePath: 'CONFIG/REVIEW',
  language: 'auto',
  accent: 'auto',
  licenseKey: '',

  enableAutoNotify: true,
  reviewAutoAddNotice: true,
  forceQuizForReview: true,
  reviewDailyLimit: 0,
  reviewIntervalScale: 1,
  reviewTreeBadge: true,
  reviewEnableFit: true,
  reviewFitEveryN: 10,
  reviewRThreshold: 0.9,
  reviewCardMode: 'flashcard',
  /* 默认「手动」：加入计划那一刻每次问用户选哪种制卡方式（用户 2026-11-15 拍板的默认值） */
  reviewCardDefaultMethod: 'manual',
  reviewCardConfirm: true,
  reviewRatingKeys: '1234',
  reviewVacationUntil: '',
  reviewVacationFrom: '',
  reviewMaxIntervalDays: 0,
  reviewFsrsWeights: '',
  reviewNewLimit: 0,
  reviewReviewLimit: 0,
  reviewOrder: 'due-first',
  reviewRemindAt: '',
  reviewRemindLast: '',
  reviewAnalysisPlain: false,
  reviewCardQuizRatio: 3,
  reviewWatchedFolders: [],
  reviewExcludedNotes: [],
  reviewSkin: 'default',
  reviewSkinTheme: 'sage',
  /* 默认原生页：Obsidian 用户对标签页的心智比浮层稳，也不挡正在看的笔记 */
  reviewPanelMode: 'native',
  reviewPanelWidth: 0,
  reviewPanelHeight: 0,
  questionsPerNote: '0',
  enableMultipleChoice: true,
  shuffleQuestions: true,
  difficulty: 'medium',

  aiProvider: '',
  deepseekApiKey: '',
  zhipuPlanApiKey: '',
  ollamaApiKey: '',
  aiCustomEndpoint: '',
  aiCustomApiKey: '',
  aiModelOverrides: {},
  aiMaxTokensOverrides: {},
  aiThinkingOverrides: {},
};
