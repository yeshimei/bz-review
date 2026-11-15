/**
 * 复习计划设置 schema（自 src/review/ui.ts 拆出，ticket 131 声明式；ADR-0064）
 *
 * 检查提醒/做题家/复习节奏/记忆算法/自动化/界面 + 移动端六组卡片。
 * 做题家子项显隐（原 quizBox style.display）收敛为 visibleWhen 声明式联动；
 * 监听文件夹走通用 path 行（multi chips，落盘外部 binding 自管：新增先确认存量收编、
 * 移除连带清理排除记录）；排除名单走通用 list 行（chips 自绘 DOM 已退役）。
 * deps 仅在交互回调（custom/path onChange）经闭包引用，工厂构建无副作用。
 *
 * settings-panel 桌面侧栏经 reviewSettingsSchema 消费（入口契约保持自 review/ui re-export）。
 */
import type { App } from 'obsidian';
import { notice } from '../core/notice';
import { diskReadText, jsonFileStore } from '../core/storage';
import { openFlowDialog } from '../core/flow-dialog';
import { getSettings, saveSettings } from '../core/settings-provider';
import type { SettingsSchema } from '../core/settings-schema';
import type { ReviewItem } from './data';
import type { ReviewDataManager } from './data';
import { getReviewFilePath, getReviewMetaPath } from './data';
import { cardModeOf } from './card-ai';
import { GROUP_ID, PURCHASE_URL, licenseSummary, refreshLicense } from '../data/entitlement';
import { copyReviewData, migrateFromBz } from '../data/migrate';
import { panelModeOf } from './panel-mode';
import { latestSnapshotName, readSnapshot, writeSnapshotNow } from './snapshot-store';
import { parseReviewFile, reviewMeta, serializeReviewItems } from './store-format';

export function reviewSettingsSchema(deps: { app: App; dataManager: ReviewDataManager }): SettingsSchema {
  // enableAutoNotify 常驻轮询在 main.ts onload 注册、运行时按设置实时读值（app.ts checkOverdueAndNotify
  // 门控），设置弹窗 toggle 只需落盘，渲染器键直绑自动完成，无需额外副作用回调。
  /** 数据目录迁移：上一次已生效的目录（防抖窗口里连续输入只搬一次） */
  let dirTimer: ReturnType<typeof setTimeout> | null = null;
  let lastDir = String((getSettings() as any).storagePath || 'CONFIG/REVIEW');
  return {
    groups: [
      /* 授权 / 数据 / AI 三组原先只在原生设置页（settings-tab.ts）里。2026-11-13 用户拍板：
         设置不写在原生设置页，全部搬进主界面的 ⚙️ ——与 bz Reader 同形制，一个插件只有
         一处设置。原生设置页据此下线，这里必须把它那三组补齐，否则等于删了功能。 */
      {
        icon: 'key-round',
        name: '授权',
        rows: [
          {
            type: 'info',
            name: '当前状态',
            desc: licenseSummary(),
            actions: [
              { text: '打开店铺', onClick: () => { window.open(PURCHASE_URL, '_blank'); } },
              { text: '交流群', onClick: () => { window.open(`https://qm.qq.com/q/${GROUP_ID}`, '_blank'); } },
            ],
          },
          {
            type: 'text',
            name: '激活码',
            desc: '填高级版激活码，解锁不限数量。离线验签，不联网。',
            placeholder: 'BZP2.…',
            binding: { key: 'licenseKey' },
            actions: [
              {
                text: '激活',
                cta: true,
                onClick: async () => {
                  // 文本行的输入先写内存再防抖落盘，这里读内存值即可
                  const code = String((getSettings() as any).licenseKey || '').trim();
                  const state = await refreshLicense(code);
                  await saveSettings();
                  notice(
                    state.paid
                      ? `已激活高级版${state.name ? `（${state.name}）` : ''}，数量不限。`
                      : '激活码无效或已过期。',
                    state.paid ? 'success' : 'warning'
                  );
                },
              },
            ],
          },
        ],
      },
      {
        icon: 'database',
        name: '数据',
        rows: [
          {
            type: 'text',
            name: '数据目录',
            desc: '复习数据存在这个目录下的 review.json。默认 CONFIG/REVIEW，与 bz 的 CONFIG/STORAGE 分开。',
            placeholder: 'CONFIG/REVIEW',
            binding: { key: 'storagePath' },
            /* 换目录必须把已有数据带过去。原来只改字段、什么也不搬——面板下一秒变成
               「今日已清空」，18 条全不见，零提示，用户只会以为数据丢了。
               落盘有 800ms 防抖，这里等 900ms 再看最终值，避免逐字符搬目录。
               复制而不是移动：旧目录原样留着，搬错了改回去就自愈。 */
            onChange: () => {
              if (dirTimer) clearTimeout(dirTimer);
              dirTimer = setTimeout(() => {
                dirTimer = null;
                const prev = lastDir;
                const next = String((getSettings() as any).storagePath || 'CONFIG/REVIEW').trim() || 'CONFIG/REVIEW';
                if (next === prev) return;
                lastDir = next;
                void (async () => {
                  try {
                    const { copied, kept } = await copyReviewData(deps.app, prev, next);
                    if (copied.length) {
                      notice(`已把复习数据复制到 ${next}（${copied.length} 个文件），原目录保留`, 'success');
                    } else if (kept.length) {
                      notice(`${next} 里已有复习数据，没有覆盖。旧数据仍在 ${prev}`, 'warning');
                    }
                  } catch {
                    notice(`已切换数据目录，但数据没能搬过去。旧数据仍在 ${prev}`, 'warning');
                  }
                })();
              }, 900);
            },
          },
          {
            type: 'button',
            name: '从 bz 导入',
            desc: '把 bz 里已有的复习计划搬过来。只导一次，目标已有数据就不覆盖，bz 那边不动。',
            buttonText: '导入',
            onClick: async () => {
              const res = await migrateFromBz(deps.app, getSettings());
              notice(res.message, res.ok ? 'success' : 'warning');
            },
          },
          {
            /* 快照是最后一道保险：合并写错、同步出事、手滑清空，都能从这里退回去。
               回滚前先给当前数据留一份，所以「回滚」本身也能反悔。 */
            type: 'info',
            name: '自动快照',
            desc: '每次写数据前留一份当天的快照，保留 7 天。回滚前会再给当前数据备份一次，反悔还能拿回来。',
            actions: [
              {
                text: '立即备份',
                onClick: async () => {
                  const raw = await diskReadText(deps.app, getReviewFilePath());
                  if (!raw) {
                    notice('还没有复习数据，先加一条再备份', 'warning');
                    return;
                  }
                  const name = await writeSnapshotNow(deps.app, raw, new Date());
                  notice(name ? `已备份：${name}` : '备份失败，去控制台看原因', name ? 'success' : 'warning');
                },
              },
              {
                text: '回滚到最近快照',
                onClick: async () => {
                  const name = await latestSnapshotName(deps.app);
                  if (!name) {
                    notice('还没有任何快照', 'warning');
                    return;
                  }
                  const v = await openFlowDialog({
                    title: '回滚到最近快照？',
                    message: `会用 ${name} 覆盖当前复习数据。回滚前会再给当前数据留一份，反悔还能拿回来。`,
                    actions: [
                      { label: '取消', value: 'cancel' },
                      { label: '回滚', value: 'ok', cta: true, danger: true },
                    ],
                  });
                  if (v !== 'ok') return;
                  try {
                    const raw = await diskReadText(deps.app, getReviewFilePath());
                    if (raw) await writeSnapshotNow(deps.app, raw, new Date());
                    const snap = await readSnapshot(deps.app, name);
                    if (!snap) {
                      notice('这份快照读不出来，换一份试试', 'warning');
                      return;
                    }
                    const parsed = parseReviewFile(JSON.parse(snap));
                    await jsonFileStore<any>(getReviewFilePath(), { app: deps.app }).write(
                      serializeReviewItems(parsed.items)
                    );
                    await jsonFileStore<any>(getReviewMetaPath(), { app: deps.app }).write(reviewMeta(new Date()));
                    notice('已回滚，重新打开面板就能看到', 'success');
                  } catch (e) {
                    notice('回滚失败：' + (e instanceof Error ? e.message : String(e)), 'warning');
                  }
                },
              },
            ],
          },
        ],
      },
      {
        icon: 'layout-panel-left',
        name: '界面',
        rows: [
          {
            type: 'select',
            name: '打开方式',
            desc: '复习面板开成标签页，还是屏幕中央的浮层',
            help:
              '「Obsidian 标签页」跟工作区一起保存和恢复，能分屏，也不挡正在看的笔记；' +
              '「独立弹窗」压在所有东西上面，适合小屏临时看一眼。' +
              '改完从下一次打开生效，已经开着的那个不会自己变形。',
            binding: {
              get: () => panelModeOf(getSettings()),
              set: (v: string) => {
                (getSettings() as any).reviewPanelMode = v === 'popup' ? 'popup' : 'native';
              },
              save: () => saveSettings(),
            },
            options: [
              { value: 'native', label: 'Obsidian 标签页（默认）' },
              { value: 'popup', label: '独立弹窗' },
            ],
          },
          {
            type: 'toggle', name: '文件树标记', desc: '文件树中标记复习笔记',
            help:
              '在 Obsidian 文件树里给复习中的笔记染色并挂阶段徽标，不开复习面板也能看出哪些到期、处在哪个阶段。' +
              '关掉只是不画这些视觉标记，排期计算与到期提醒都不受影响，文件树恢复宿主原样。',
            binding: { key: 'reviewTreeBadge' },
          },
        ],
      },
      {
        icon: 'bell',
        name: '检查提醒',
        rows: [
          { type: 'toggle', name: '到期提醒', desc: '有笔记到期待复习时自动弹出提醒', binding: { key: 'enableAutoNotify' } },
          { type: 'toggle', name: '新笔记加入提醒', desc: '新笔记被自动加入时弹出提示，多条合并成一条', binding: { key: 'reviewAutoAddNotice' } },
        ],
      },
      {
        /* 划线卡（2026-11-11）：一条划线就是一张卡，复习时不开任何文件。
           三档方式由复习计划这边定：AI 抽认卡（问句当提示面）、AI 做题
           （四选一，每轮抽三分之一）、展开全文（不碰 AI，自己评难度）。 */
        icon: 'layers',
        name: '划线卡',
        rows: [
          {
            type: 'select',
            name: '复习方式',
            desc: '划线卡按哪种方式复习',
            help:
              '五种都只复习这张卡自己的内容，不打开任何笔记。' +
              '「AI 抽认卡」先给一句不能照抄原文的问句，想不起来再看原文；' +
              '「AI 填空」把关键短语挖掉，自己填；' +
              '「上下文」只给前后几句，猜中间被藏起来的那段；' +
              '「AI 做题」按划线长短生成 3~15 道四选一，每轮只抽其中一部分；' +
              '「展开全文」不调用 AI，直接把整段话摆出来，你自己评难度。' +
              'AI 内容在加入复习计划时生成一次；老卡第一次用到时会现生成。想换的话，' +
              '在复习面板里右键那张卡点「重新生成」。',
            binding: {
              // 设置里存的是五个字面量之一，schema 的 key 只接 string 型键，所以自管读写
              get: () => cardModeOf(),
              set: (v: string) => {
                (getSettings() as any).reviewCardMode =
                  v === 'quiz' || v === 'plain' || v === 'cloze' || v === 'context' ? v : 'flashcard';
              },
              save: () => saveSettings(),
            },
            options: [
              { value: 'flashcard', label: 'AI 抽认卡' },
              { value: 'cloze', label: 'AI 填空' },
              { value: 'context', label: '上下文' },
              { value: 'quiz', label: 'AI 做题' },
              { value: 'plain', label: '展开全文（不用 AI）' },
            ],
          },
          {
            type: 'select',
            name: '每轮抽题比例',
            desc: '题库固定，每轮只抽其中一部分',
            binding: {
              get: () =>
                String(Math.min(4, Math.max(2, Math.round(Number((getSettings() as any).reviewCardQuizRatio) || 3)))),
              set: (v: string) => {
                (getSettings() as any).reviewCardQuizRatio = Math.min(
                  4,
                  Math.max(2, Math.round(Number(v) || 3))
                );
              },
              save: () => saveSettings(),
            },
            options: [
              { value: '2', label: '一半' },
              { value: '3', label: '三分之一' },
              { value: '4', label: '四分之一' },
            ],
            visibleWhen: (s) => (s as any).reviewCardMode === 'quiz',
            isChild: true,
          },
        ],
      },
      {
        icon: 'graduation-cap',
        name: '做题家',
        rows: [
          { type: 'toggle', name: '用做题测难度', desc: '开始复习即做题，按正确率自动定难度',
            help:
              '打开后「开始复习」先出题，再按正确率定本次难度。' +
              '下面多选、题量、打乱顺序、出题难度四行是它的子项，只在开着时显示；关掉则回到普通跳转复习。',
            binding: { key: 'forceQuizForReview' } },
          // 出题子项：仅「用做题测难度」开启时显示（ticket 170 isChild 联动 + visibleWhen 兜底）
          { type: 'toggle', name: '允许多选题', desc: '开启后 AI 可能出多选题，关闭则只出单选题', binding: { key: 'enableMultipleChoice' }, visibleWhen: (s) => s.forceQuizForReview === true, isChild: true },
          // 数量语义行口径对齐全域（深审新-14①）：number 行 + min 钳制（原 text 行可输 -5/abc）。
          // 键仍为 string 型（session parseInt||0 消费），binding 自管转 string 落盘；0=自动语义保留
          {
            type: 'number',
            name: '每篇笔记出题数量',
            desc: '固定每篇笔记出题的数量，0 为自动',
            binding: {
              get: () => Number((getSettings() as any).questionsPerNote) || 0,
              set: (v) => { (getSettings() as any).questionsPerNote = String(v); },
              save: () => saveSettings(),
            },
            min: 0,
            max: 100,
            visibleWhen: (s) => s.forceQuizForReview === true,
            isChild: true,
          },
          { type: 'toggle', name: '打乱出题顺序', desc: '做题时随机排列题目顺序', binding: { key: 'shuffleQuestions' }, visibleWhen: (s) => s.forceQuizForReview === true, isChild: true },
          {
            type: 'select',
            name: '出题难度',
            desc: '控制 AI 出题深浅',
            binding: { key: 'difficulty' },
            options: [
              { value: 'random', label: '随机' },
              { value: 'easy', label: '简单' },
              { value: 'medium', label: '中等' },
              { value: 'hard', label: '困难' },
            ],
            visibleWhen: (s) => s.forceQuizForReview === true,
            isChild: true,
          },
        ],
      },
      {
        icon: 'timer',
        name: '复习节奏',
        rows: [
          // 非正数钳制为 0（原 onChange 口径：>0 保留否则 0）；空串不写（防脏值落盘）
          { type: 'number', name: '每日复习上限', desc: '一轮最多复习的篇数', binding: { key: 'reviewDailyLimit' }, min: 0, max: 1000 },
          // 深审新-14②/A14：超界改渲染器声明钳制（min/max 进界并回写输入框，R9 通路显示值=落盘值），
          // 原.onChange「超上界回 1」复刻删除——输入 8 落 5 且回显 5，不再出现显示 8 落 1 的缝
          {
            type: 'number',
            name: '复习间隔缩放',
            desc: '数值越小复习越频繁，数值越大越宽松',
            help:
              '作用在 FSRS 动态间隔上的乘数：间隔 = intervalDays × scale，只对已进入 FSRS 的复习生效；固定的阶梯间隔表（含进入 FSRS 那一步）不受影响。' +
              '范围 0.1 到 5，填 0.5 更勤、填 2 更宽松。',
            binding: { key: 'reviewIntervalScale' },
            min: 0.1,
            max: 5,
          },
          // ADR-0077：R 目标阈值（低于该值视为可复习/提前；默认 0.9）。
          // F3 语义披露：该阈值仅用于提前复习判定，不改变排期间隔（真阈值排期是待拍板项）
          {
            type: 'number',
            name: 'R 目标阈值',
            desc: '触发提前复习的保留度阈值，不改变排期间隔',
            help:
              'R 是算法估计的记忆保留度，取值 0 到 1（1 = 完全记得）。' +
              '低于这个阈值会触发一次提前复习，但不改变排期间隔本身，所以调它不会让整体节奏变快变慢。',
            binding: { key: 'reviewRThreshold' },
            min: 0.5,
            max: 0.99,
          },
        ],
      },
      {
        icon: 'brain',
        name: '记忆算法',
        rows: [
          // ADR-0077：FSRS 参数自动拟合（全自动定期重算）
          { type: 'toggle', name: '参数自动拟合', desc: '按个人复习历史拟合记忆参数，优化复习节奏',
            help:
              '用你的复习记录重新拟合 FSRS 参数。' +
              '样本少于 100 条直接跳过（沿用默认参数），100 到 300 条只拟合基础八参，300 条以上拟合全参——所以刚开始用看不出差别。',
            binding: { key: 'reviewEnableFit' } },
          {
            type: 'number',
            name: '每 N 次复习重算',
            desc: '累计 N 次评级后自动重拟合一次',
            binding: { key: 'reviewFitEveryN' },
            min: 1,
            visibleWhen: (s) => (s as any).reviewEnableFit === true,
            isChild: true,
          },
        ],
      },
      {
        icon: 'sliders-horizontal',
        name: '自动化',
        rows: [
          // 监听文件夹：通用 path 行（multi chips + 添加… 按钮，ticket 133 形态）。
          // 落盘走外部 binding 自管（权威写盘在 onChange）：新增目录需先确认存量收编（取消=不加入，
          // 回传回退清单否决本次变更），移除目录需连带清理其下排除记录（ticket 099）。
          {
            type: 'path',
            mode: 'multi',
            name: '监听文件夹',
            desc: '新笔记自动加入复习计划',
            help:
              '目录里的新笔记自动加入复习计划。库根目录不支持监听，会被拦下。' +
              '首次添加目录时会问是否把目录内已有笔记一并收编：取消 = 该目录不加入监听（新老笔记都不收），确认才加入。',
            binding: {
              get: () => ((getSettings() as any).reviewWatchedFolders || []) as string[],
              set: () => {},
              save: () => {},
            },
            pickerTitle: '选择监听文件夹',
            pickerDesc: '文件夹里的新笔记自动加入复习计划，包括子文件夹',
            onChange: (list) => {
              const prev = [...(((getSettings() as any).reviewWatchedFolders as string[]) || [])];
              return (async (): Promise<string[]> => {
                const { ReviewWatcher } = await import('./watch');
                const watcher = new ReviewWatcher(deps.app, deps.dataManager);
                const kept: string[] = [];
                for (const folder of list) {
                  if (!folder) {
                    notice('暂不支持监听库根目录', 'warning');
                    continue;
                  }
                  if (prev.includes(folder)) {
                    kept.push(folder);
                    continue;
                  }
                  // 新增：先确认存量收编；取消 = 该目录不加入（不写排除名单）
                  if (await watcher.confirmBatchAddForFolder(folder)) kept.push(folder);
                }
                for (const folder of prev) {
                  if (list.includes(folder)) continue;
                  // 移除：同时清空其下排除记录（否则二次添加时存量被旧黑名单挡住）
                  const cleared = await watcher.removeWatchedFolder(folder);
                  notice(cleared > 0 ? `已移除监听文件夹，并清理其下 ${cleared} 条排除记录` : '已移除监听文件夹', 'success');
                }
                (getSettings() as any).reviewWatchedFolders = kept;
                await saveSettings();
                return kept;
              })();
            },
          },
          // 排除名单（通用 list 行，chips 自绘 DOM 已退役）：单条解除 = 移除按钮，逐条清理
          {
            type: 'list',
            name: '排除名单',
            desc: '自动加入的排除名单',
            items: () => ((getSettings() as any).reviewExcludedNotes || []).map((path: string) => ({ key: path, label: path })),
            emptyText: '暂无排除笔记',
            removeLabel: '解除',
            onChange: (keys) => {
              void (async () => {
                const prev: string[] = (getSettings() as any).reviewExcludedNotes || [];
                const removed = prev.filter((p) => !keys.includes(p));
                if (removed.length === 0) return;
                const { ReviewWatcher } = await import('./watch');
                const watcher = new ReviewWatcher(deps.app, deps.dataManager);
                for (const path of removed) await watcher.removeExcludedNote(path);
                notice('已解除排除', 'success');
              })();
            },
          },
        ],
      },
      {
        icon: 'sparkles',
        name: 'AI',
        rows: [
          {
            type: 'select',
            name: '服务商',
            desc: '抽认卡与做题要用。没有也能复习，只是不会有 AI 内容。',
            binding: { key: 'aiProvider' },
            options: [
              { value: '', label: '不启用' },
              { value: 'deepseek', label: 'DeepSeek' },
              { value: 'zhipu-plan', label: '智谱 Plan' },
              { value: 'ollama', label: 'Ollama' },
              { value: 'custom', label: '自定义' },
            ],
          },
          /* 密钥按服务商分开存（切服务商不会把上一家的 key 带过去），所以这里按当前
             服务商只露一行——比「一个框跟着下拉换值」少一类「这家的 key 到底填没填」的
             错位状态。密钥一律走 secret 行：密码框 + 眼睛切明文，截图/投屏不泄。 */
          {
            type: 'secret', name: 'DeepSeek API Key', desc: 'sk- 开头，在 DeepSeek 开放平台创建。',
            placeholder: 'sk-…', binding: { key: 'deepseekApiKey' },
            visibleWhen: (s) => s.aiProvider === 'deepseek',
          },
          {
            type: 'secret', name: '智谱 API Key', desc: '填智谱开放平台的 Key。',
            placeholder: '…', binding: { key: 'zhipuPlanApiKey' },
            visibleWhen: (s) => s.aiProvider === 'zhipu-plan',
          },
          {
            type: 'secret', name: 'Ollama API Key', desc: '本地 Ollama 通常不用填；远程实例才需要。',
            placeholder: '可留空', binding: { key: 'ollamaApiKey' },
            visibleWhen: (s) => s.aiProvider === 'ollama',
          },
          {
            type: 'text', name: '自定义服务商地址', desc: '兼容 OpenAI 格式的接口地址，含 /v1。',
            placeholder: 'https://example.com/v1', binding: { key: 'aiCustomEndpoint' },
            visibleWhen: (s) => s.aiProvider === 'custom',
          },
          {
            type: 'secret', name: '自定义 API Key', desc: '上面那家服务商的密钥。',
            placeholder: 'sk-…', binding: { key: 'aiCustomApiKey' },
            visibleWhen: (s) => s.aiProvider === 'custom',
          },
          {
            type: 'button',
            name: '测试连接',
            desc: '发一次最小的真实请求，确认密钥和服务商可用。',
            buttonText: '测试',
            visibleWhen: (s) => !!s.aiProvider,
            onClick: async () => {
              try {
                const { testAIConnectivity } = await import('../core/ai');
                const res = await testAIConnectivity();
                notice(`连接正常：${res.label} · ${res.model}（${res.ms}ms）`, 'success');
              } catch (e: any) {
                notice(`连接失败：${e?.message ?? e}`, 'error');
              }
            },
          },
        ],
      },
    ],
  };
}
