# bz-review 商业化功能方向竞品调研

调研日期：2026-11-18

## 0. 调研边界与现状对齐

先对齐「不重复造轮子」的边界。下列现状来自 bz-review 仓库 README 与 parent 提供的源码核查，不作为竞品结论：

- bz-review README 第 26–36 行明确写明「提醒 / 评级 / 排期 / 统计 / 记忆分析 / 四种复习方式」基础版与高级版都有，只限数量（20 篇笔记 / 50 张卡），不限功能，超限不删除。
- 记忆分析已派生：当前留存率 R、稳定性 S、难度 D、阶段分布、评级分布（忘了/困难/一般/简单）、忘了率、连续添柴天数、最近 14 天每日复习数、未来 8 天排程、逾期清单、最稳卡片榜（`src/review/analysis/data.ts`）。因此本报告的候选清单**排除了通用的复习统计、热力图、留存率面板**；只在「按书/章节维度」和「导出报告」这两个确实缺失的切口上讨论。
- bz-review 与 bz Reader 无硬依赖，通过 `reviewApi` 联动；划线由 Reader 推送，并附带前后各一段上下文。卡片形态已有抽认卡 / 做题（选择）/ 填空 / 上下文 / 全文。
- 商业模式是**中国大陆个人开发者 + 爱发电/自有店铺卖断 + 离线验签**，不是订阅。这一条决定了：凡是需要持续服务器成本或持续 API 调用成本的功能，都不能照搬订阅制竞品。

调研方法：只用一手来源（厂商官网功能页与定价页、官方帮助文档、GitHub README / issues、Obsidian 官方社区插件目录页、官方 APK 文档）。二手评测只在官网被反爬拦截时作为旁证，并明确标注。

## 一、竞品一手事实速览

### Obsidian 社区复习类插件

- **Spaced Repetition（st3v3nmw）**：[Obsidian 官方社区插件目录页](https://community.obsidian.md/plugins/obsidian-spaced-repetition)显示 635k 下载、MIT 许可、桌面+移动端、版本 1.15.4；支持 FSRS 或 SM-2 两种算法，卡片格式为单行 `Question::Answer`、反向 `Question:::Answer`、多行 `?`、多行反向 `??`、cloze（`==高亮==` / 加粗 / 花括号 / 自定义），富文本继承 Obsidian，支持图片/音频/视频、LaTeX、代码高亮、脚注，按标签或文件夹组织牌组，并「Track due items and view review statistics」。
- **该插件的 GitHub issues 暴露了真实未满足诉求**：[issues 列表](https://github.com/st3v3nmw/obsidian-spaced-repetition/issues/)里有 #1538「Store schedule data outside of notes」（把排程数据从笔记正文挪出去，帮助 wanted）、#1646「Add a Flashcard Manager window to quickly filter, search, bury, suspend, delete and review custom decks」、#1675「Weighted cram mode with temporary per-session intervals」、#1397「Shorter review intervals & Algo update」。这四条分别对应「卡片管理器」「临时加权速刷」「算法/间隔调参」三类需求。
- **Obsidian_to_Anki**：[官方社区目录页](https://community.obsidian.md/plugins/obsidian-to-anki-plugin)显示 135k 下载、GPL-3.0、仅桌面端；[GitHub README](https://github.com/ObsidianToAnki/Obsidian_to_Anki)写明「Easy cloze formatting」、「Frozen Fields Obsidian integration - A link to the file that made the flashcard, full link and image embed support」、「Custom syntax - Using regular expressions」。它是**从 Obsidian 导出到 Anki**，与「导入 Anki 包」方向相反。
- **AnkiBridge**：[官方文档站](https://jeppeklitgaard.github.io/ObsidianAnkiBridge/)写明是单向同步（Obsidian 是 ground truth），支持 Sandwich / BasicCodeBlock 两种 blueprint，渲染数学、图片、音频、视频、cloze、Markdown、链接（含 Obsidian URI）、「Linking to source from Anki」，以及自动更新标签与字段内容。
- **Recall（martin-jw）**：[官方社区目录页](https://community.obsidian.md/plugins/obsidian-recall)显示 12k 下载、MIT、桌面+移动端，卖点是「A flexible and configurable spaced repetition plugin with multiple algorithms to choose from」；[用法文档](https://github.com/open-spaced-repetition/obsidian-spaced-repetition-recall/blob/dev-master/docs/usage.md)显示其被 open-spaced-repetition 组织接手，用独立的 `tracked_files.json` 存排程数据，文档提到 FSRS v4 参数与从原插件迁移的备份警告。
- **Heatmap Calendar**：第三方插件目录 [VaultPicks](https://vaultpicks.net/tools/obsidian-plugin-finder) 统计约 170k 下载（二手目录数据，仅作量级旁证），定位是 DataviewJS 的年度活动概览（GitHub 风格），可用于「复习热力图」。这是 bz-review 已覆盖的方向，不列为建议。
- [True Recall 的插件对比页](https://truerecall.app/docs/compare/obsidian-flashcard-plugins)（厂商自建对比，带立场，仅作旁证）给出调度器差异：True Recall FSRS v6、Spaced Repetition 默认 SM-2 且自 1.15.0 起可选 FSRS、Decks FSRS-6、Lemma FSRS 4.5、Obsidian_to_Anki 用 Anki 自己的调度器。说明「多算法可选」是这一赛道的常见卖点，但算法本身并不稀缺。

### 主流复习 APP

- **Readwise（最贴近对标）**：[官方定价页](https://readwise.io/pricing)显示 Full Readwise $9.99/月（年付，Reader + Highlights）、Highlights only $7.99/月、Highlights Lite $5.59/月、Reader only $7.99/月，30 天免费后收费。Highlights only 的清单里明确包含「Mastery flashcards」「Review tuning」「Export your highlights to Notion, Obsidian, and more」「Ghostreader AI」「OCR to capture physical books」「CLI / MCP server / API / ChatGPT Connector」；Highlights Lite 明确**不含**「tags & notes」「exports」。Reader only 的清单里明确包含「Text to speech」。
- **Readwise Mastery（即划线转卡的核心机制）**：[官方帮助文档](https://docs.readwise.io/highlights/guides/mastery)写明 Mastery 把高亮转成 Q&A 与 cloze deletion 两种主动回忆格式；创建后 Daily Review 分成两半，前半是未处理的高亮，后半是 Mastery cards，后者「resurfaced according to a spaced repetition algorithm」；文档还提到可用 `.qa` Action Tag 配合 Reader 里的 Ghostreader 提示词，在阅读时就生成卡片。
- **Mochi Cards**：[官方定价页](https://www.mochi.cards/pricing/)显示永久免费档含无限离线卡片与牌组、导入导出、卡片模板；Pro $5/月（年付）增加跨设备同步、发布牌组、动态字段、AI 集成、10GB 云存储、HTTP API。关键证据：TTS 被列为按量服务，免费档 200 字符/月、Pro 200,000 字符/月；字典 20 次 vs 1000 次、翻译 1000 字符 vs 100000 字符、转录 500 秒 vs 20000 秒、图片搜索 20 次 vs 1000 次。
- **RemNote**：[官方定价页](https://www.remnote.com/pricing)显示免费档无限笔记/抽认卡/同步设备，但限量 3 个带标注 PDF、5 张 Image Occlusion、1 份手写文档；Pro $8/月解锁无限 PDF 标注、Image Occlusion、考试排期、手写与 1000 AI credits；Pro with AI $18/月给 20000 credits，含「AI Cards from Text, PDF & PPTs」「AI Grading」「AI Tutor Chat」「Image to Text Conversion」「Audio Transcription」。
- **Anki / AnkiDroid**：[AnkiDroid 官方 README](https://github.com/ankidroid/Anki-Android/blob/main/README.md)列出的功能包括 night mode、whiteboard、progress widget、detailed statistics、Syncing with AnkiWeb、Text-to-speech integration、10,000+ premade decks、「Spaced repetition (AI-optimized FSRS algorithm)」、支持 text/images/sounds/MathJax、可从词典等外部应用 intent 加卡。[Anki 官网](https://apps.ankiweb.net/)定位为「powerful, intelligent flashcards」。
- **Anki 的图片遮挡与线索卡是内置免费功能**：[Anki 官方手册 Adding/Editing](https://docs.ankiweb.net/manual/editing)写明「Anki 23.10+ supports Image Occlusion cards natively」，提供矩形/椭圆/多边形三种形状与「Hide All, Guess One」「Hide One, Guess One」两种模式；同一页也详述 cloze deletion 与自定义字段（如 book / page）。
- **AnkiWeb 同步**：[Anki 官方手册 Syncing with AnkiWeb](https://docs.ankiweb.net/manual/syncing)写明 AnkiWeb 用于多设备同步与在线学习，冲突时可上传/下载。
- **AnkiHub**：[官网首页](https://www.ankihub.net)公开的价目为 Free $0、Core $6/月、Premium $10/月、Lifetime $450（一次买断）。Core 卖「同步维护中的牌组」，Premium 加 AI 能力。这说明共享牌组市场主要是订阅生意，但也存在 Lifetime 买断档。
- **SuperMemo**：[官方 Premium 订阅页](https://www.supermemo.com/en/premium-subscription)显示 35.99 PLN/月或 359 PLN/年，卖点是 25 种语言近 300 门课程、MemoChat 对话、AI Assistant、MemoTranslator、自建课程容量（100 万词）、4 倍多媒体空间与多设备。注意：**付费点几乎全在内容与 AI，不在调度算法本身**。
- **Migaku**：[官网首页](https://migaku.com/)定位是 Chrome 扩展，把 Netflix / YouTube / 任意网页变成学习材料，一键制卡、点词查释义/发音/图片/ChatGPT 语境解释，并强调「Advanced text-to-speech」；首页在主推「60% OFF Lifetime」，即买断制。它是「阅读/观看→卡片」链路中卖断模式的直接参照。
- **Quizlet / Knowt（一手页受限，仅作旁证）**：[Quizlet 首页](https://quizlet.com/)自述「free flashcards and premium study tools」，但 [upgrade 页](https://quizlet.com/upgrade)被反爬拦截，未取到一手价目；[Knowt 首页](https://knowt.com/)自述是 Quizlet 替代品并强调 AI 工具，但 `/pricing` 返回 404。两者不作为本报告的定价断言依据。

## 二、候选功能逐条评估

### A. 强相关：建议重点考虑

- **功能名：听卡片 / 听复习（复用 bz Reader 本地 TTS）**
  - 谁在做：[Mochi 定价页](https://www.mochi.cards/pricing/)把 Text to speech 列为 AI/语言服务，免费 200 字符/月、Pro 200,000 字符/月；[Readwise 定价页](https://readwise.io/pricing)把 text-to-speech 放进 Reader 付费档；[AnkiDroid README](https://github.com/ankidroid/Anki-Android/blob/main/README.md)列有 Text-to-speech integration；[Migaku 官网](https://migaku.com/)强调 Advanced text-to-speech；[SuperMemo Premium](https://www.supermemo.com/en/premium-subscription)用 AI 与多媒体空间做付费点。
  - 解决什么痛点：复习时眼睛累了或想利用碎片时间，原文与题目只能看不能听，而订阅竞品的 TTS 要么按量收费、要么必须联网。
  - 对 bz-review 的契合度：**高** —— bz Reader 已有本地 CosyVoice（7 个预置音色）与离线整章音频包、按句高亮能力，`reviewApi` 已经打通划线上下文，是现成能力复用，不是新造轮子。
  - 实现体量：**中** —— 在复习卡渲染层加播放控件、复用音频缓存与音色设置；难点在移动端与桌面端的音频会话管理，不在合成本身。
  - 建议档位：**高级档** —— 有真实付费证据（Mochi 按量收费），且卖断模式下本地 TTS 零边际成本；可把「离线整章音频包 + 卡片朗读」打包成一个卖点，而不是按次收费。

- **功能名：复习卡片一键跳回书中原文并高亮定位**
  - 谁在做：[AnkiBridge 文档](https://jeppeklitgaard.github.io/ObsidianAnkiBridge/)列出「Linking to source from Anki」与 Obsidian URI 支持；[Obsidian_to_Anki README](https://github.com/ObsidianToAnki/Obsidian_to_Anki)写明卡片带「a link to the file that made the flashcard」；[Readwise 帮助文档](https://docs.readwise.io/highlights/guides/mastery)的 Mastery 卡保留其来源高亮。
  - 解决什么痛点：复习时只看到孤立的一句话，想不起它在全书里的位置与前后逻辑，答对了也没有真正重建语境。
  - 对 bz-review 的契合度：**高** —— Reader 推卡时已附带前后各一段上下文，且 bz Reader 已有按句锚点高亮（`{block, at, len}` + `CSS.highlights`）的成熟实现，链路天然闭合。
  - 实现体量：**中** —— 卡数据需要保存可跳转的书/章节/锚点元数据，复习侧调 `reviewApi` 打开 Reader 并高亮；跨插件协议要约定清楚。
  - 建议档位：**高级档** —— 这是「配套 bz Reader 才有的体验」，是卖断套装最正当的溢价点，也顺带强化两插件的捆绑价值。

- **功能名：按书 / 按章节维度的复习分析 + 可导出的复习报告**
  - 谁在做：[Readwise 定价页](https://readwise.io/pricing)把「Export your highlights to Notion, Obsidian, and more」放在 Highlights only 及以上，Lite 档明确不含导出；[Anki 官方手册](https://docs.ankiweb.net/manual/editing)建议用 book / page 字段对内容分类；[AnkiDroid README](https://github.com/ankidroid/Anki-Android/blob/main/README.md)列出 detailed statistics。
  - 解决什么痛点：现有分析只有全局视图，用户不知道「这本书读完了到底记住多少」「哪一章最该重读」，也无法把成果带出插件。
  - 对 bz-review 的契合度：**中高** —— 不是重做统计面板，而是在已派生的 R/S/D 与评级分布之上增加「按书/章节」分组与导出，复用现有派生逻辑，避开了 parent 明确要求不要重复的部分。
  - 实现体量：**中** —— 分组键来自卡片元数据；导出 Markdown/CSV 是纯本地文件写入，零服务器成本。
  - 建议档位：**高级档** —— 导出在 Readwise 是明确的付费分界线；本地导出零边际成本，适合卖断。

- **功能名：集中复习 / 考前速刷模式（临时加权、不污染长期排程）**
  - 谁在做：[Spaced Repetition GitHub issue #1675](https://github.com/st3v3nmw/obsidian-spaced-repetition/issues/)「Weighted cram mode with temporary per-session intervals」；[Anki 官方手册 Adding/Editing](https://docs.ankiweb.net/manual/editing)的「Custom Study and Filtered Decks」章节说明可用搜索词建临时牌组，考前集中练而不打乱正常牌组。
  - 解决什么痛点：考试或汇报前想把某一本书/某一章的卡临时高密度过一遍，又不想把 FSRS 的长期排程搅乱。
  - 对 bz-review 的契合度：**高** —— 现有 FSRS 调度与队列已经是底座，加一层「临时会话」是最小增量。
  - 实现体量：**小到中** —— 复用队列与评级 UI，关键是确保所有评级写入临时会话而不回写主排程。
  - 建议档位：**高级档** —— 有 GitHub issue 佐证是用户主动诉求，实现轻，是性价比很高的付费小功能。

- **功能名：卡片管理器（搜索 / 筛选 / 挂起 / 埋藏 / 删除 / 手动排期）**
  - 谁在做：[Spaced Repetition GitHub issue #1646](https://github.com/st3v3nmw/obsidian-spaced-repetition/issues/)「Add a Flashcard Manager window to quickly filter, search, bury, suspend, delete and review custom decks」；[Recall 文档](https://github.com/open-spaced-repetition/obsidian-spaced-repetition-recall/blob/dev-master/docs/usage.md)用独立 `tracked_files.json` 管理已跟踪条目；[Anki 官方手册](https://docs.ankiweb.net/manual/editing)有 tags / flags / fields 检索与筛选牌组。
  - 解决什么痛点：卡片一多就找不到某一张，也不能临时把「这周不想看到的卡」挂起，只能硬着头皮按队列走。
  - 对 bz-review 的契合度：**高** —— 双栏工作台已有「类型分布 / 本轮队列 / 当前卡信息」，增加一个管理视图是自然延伸；高级档已经不限卡量，管理需求会随卡量放大。
  - 实现体量：**中** —— 主要是列表/过滤 UI 与批量操作，数据结构基本现成。
  - 建议档位：**高级档** —— 与「不限量」形成组合拳：免费档 50 张不需要管理器，高级档用户才有痛感。

- **功能名：Anki 包 / CSV 导入（把已有卡片迁进来）**
  - 谁在做：[Anki 官方手册 Syncing/Exporting](https://docs.ankiweb.net/manual/exporting)说明 Anki 可导出含排程信息的 `.apkg`；[Obsidian_to_Anki GitHub README](https://github.com/ObsidianToAnki/Obsidian_to_Anki)做的是反向的 Markdown→Anki 导出；[Mochi 定价页](https://www.mochi.cards/pricing/)把 Import and export 放在免费档；[RemNote 定价页](https://www.remnote.com/pricing)的宣传页也提到 Anki importer。
  - 解决什么痛点：用户已经在 Anki 里攒了几百上千张卡，换到 bz-review 时不想从头再来。
  - 对 bz-review 的契合度：**中** —— 导入只是一次性动作、无持续成本，但 `.apkg` 是 SQLite 容器，解析体量与 bz-review 的卡片形态（抽认卡/选择/填空/上下文/全文）映射有工作量。
  - 实现体量：**中到大** —— 若只支持 CSV/文本，体量小；要完整解析 `.apkg` 的牌组、笔记类型、cloze 与媒体，体量大。
  - 建议档位：**高级档**，但建议先做 CSV/文本导入 —— 它是「降低迁移门槛」的转化功能，不是持续成本；免费档给 CSV 导入、高级档给 `.apkg` 完整导入也是可行切分。

- **功能名：每日复习摘要笔记（本地生成，替代付费邮件日报）**
  - 谁在做：[Readwise 定价页](https://readwise.io/pricing)把「Daily Review (email & app)」列为核心卖点，用户证言里反复出现「每天早上收 10 条高亮」；[SuperMemo Premium](https://www.supermemo.com/en/premium-subscription)也用 progress summaries 与 ranking 做留存。
  - 解决什么痛点：用户想要一个「今天复习了什么、明天该看什么」的固定仪式感入口，但不想再收一封邮件，也不想为了日报付订阅费。
  - 对 bz-review 的契合度：**高** —— 现有数据已包含最近 14 天复习数、未来 8 天排程、逾期清单，写进 Obsidian 库里是一份现成的笔记；而且完全本地、零服务器成本，正好是卖断模式能对订阅制打的差异牌。
  - 实现体量：**小** —— 复用已有派生数据拼 Markdown 模板 + 定时写入。
  - 建议档位：**高级档** —— 与「统计/分析」同属已有能力的呈现层，作为高级档的「仪式感」卖点成本极低。

### B. 有价值但有成本或定位风险

- **功能名：AI 出题策略 / 提示词模板库（BYOK，不送额度）**
  - 谁在做：[Readwise 定价页](https://readwise.io/pricing)的 Ghostreader AI 与「Mastery flashcards」绑定；[RemNote 定价页](https://www.remnote.com/pricing)把 AI Credits 分级售卖（1000 / 20000）；[Mochi 定价页](https://www.mochi.cards/pricing/)把 AI completion 做成 5000 / 500000 tokens 的额度差。
  - 解决什么痛点：AI 出题质量高度依赖提示词，用户不知道「怎么让 AI 出好题」，而 bz-review 现在只退回到内置规则。
  - 对 bz-review 的契合度：**中** —— 出题目前是 Reader 的职责，review 侧只消费卡片，除非把「复习时再加工」也纳入分工，否则会越界。
  - 实现体量：**小** —— 内置几套提示词模板与参数，仍是用户自带 Key。
  - 建议档位：**高级档的「内容」而非「额度」** —— 卖断模式下绝对不要送 AI 调用额度（持续成本、且用户已自带 Key）；可以卖提示词库、出题策略、质量校验规则这类一次性内容。

- **功能名：本地/自带存储的复习进度备份与恢复**
  - 谁在做：[Anki 官方手册 Syncing with AnkiWeb](https://docs.ankiweb.net/manual/syncing)说明多设备同步靠 AnkiWeb；[Mochi 定价页](https://www.mochi.cards/pricing/)把 Sync across devices 和 10GB 云存储放进 Pro；[Recall 文档](https://github.com/open-spaced-repetition/obsidian-spaced-repetition-recall/blob/dev-master/docs/usage.md)反复强调迁移前必须备份 `data.json`。
  - 解决什么痛点：换设备或库损坏时，复习排程（不是书）丢失的代价极高。
  - 对 bz-review 的契合度：**中** —— 已有 `CONFIG/REVIEW/review.json` 与「从 bz 导入」，做文件级备份/恢复很自然，但用户真正的诉求是跨设备「自动同步」，本地备份只解决一半。
  - 实现体量：**小** —— 导出/导入一个 JSON。
  - 建议档位：**免费档** —— 备份是数据安全底线，不宜收费；把它作为「不联网、数据在你自己手里」的卖点，反而有助于卖断信任。

- **功能名：云同步（明确不建议做）**
  - 谁在做：[Anki 官方手册 Syncing with AnkiWeb](https://docs.ankiweb.net/manual/syncing)、[Mochi 定价页](https://www.mochi.cards/pricing/)的 Sync/10GB、[Readwise 定价页](https://readwise.io/pricing)的整体订阅模式。
  - 解决什么痛点：多设备进度一致。
  - 对 bz-review 的契合度：**中** —— 痛点真实，但 bz-review 是卖断、离线验签、插件本身不联网（README 第 50–52 行）。
  - 实现体量：**大** —— 服务端、账号体系、冲突合并、长期运维。
  - 建议档位：**不做** —— 成本风险最高的功能：卖断一次收入要覆盖多年服务器与流量费，且国内网络与合规成本更高。替代方案是让用户用 Obsidian Sync / 网盘同步 `review.json`，插件只保证文件格式稳定。

- **功能名：卡片模板市场 / 共享牌组市场（不建议现在做）**
  - 谁在做：[AnkiHub 官网](https://www.ankihub.net)的核心生意就是维护中的共享牌组（Core $6/月、Premium $10/月、Lifetime $450）；[Mochi 定价页](https://www.mochi.cards/pricing/)把 Publish decks 放进 Pro；[Quizlet 首页](https://quizlet.com/)以共享学习集为卖点。
  - 解决什么痛点：不想自己出题，想直接用别人做好的卡组。
  - 对 bz-review 的契合度：**低** —— bz-review 的卡来自用户自己的书，共享牌组与「个人阅读记忆」的定位相冲；且卡片形态与 bz Reader 深度绑定，别人做不出来。
  - 实现体量：**大** —— 需要服务端、审核、版权与运营。
  - 建议档位：**不做** —— 与卖断模式、个人开发者资源都不匹配。若一定要做，只能做「本地模板文件导入」，不涉及平台。

### C. 明确不该做（已覆盖 / 伪需求 / 弱相关）

- **功能名：复习统计热力图 / 留存率面板**
  - 谁在做：[Heatmap Calendar](https://vaultpicks.net/tools/obsidian-plugin-finder)（第三方目录统计约 170k 下载）；[Spaced Repetition 官方目录页](https://community.obsidian.md/plugins/obsidian-spaced-repetition)已含 review statistics。
  - 解决什么痛点：可视化复习连续性。
  - 对 bz-review 的契合度：**低 —— 已覆盖**，README 第 34 行与 `src/review/analysis/data.ts` 已包含评级分布、最近 14 天每日复习数、连续添柴天数、留存率等。
  - 实现体量：**小**（但属于重复投入）。
  - 建议档位：**不新增档位** —— 只有在「按书/章节维度 + 导出」这两个缺口上才值得做，见 A 组对应条目。

- **功能名：复习提醒（通用）**
  - 谁在做：[Readwise 定价页](https://readwise.io/pricing)的 Daily Review (email & app)；[AnkiDroid README](https://github.com/ankidroid/Anki-Android/blob/main/README.md)的 progress widget。
  - 解决什么痛点：忘记复习。
  - 对 bz-review 的契合度：**低 —— 已覆盖**，README 第 34 行明确基础版/高级版都有提醒。
  - 实现体量：小。
  - 建议档位：**不新增** —— 不应作为新付费点重复宣传。

- **功能名：图片遮挡卡**
  - 谁在做：[Anki 官方手册 Adding/Editing](https://docs.ankiweb.net/manual/editing)写明 23.10+ 原生支持 Image Occlusion（三种形状、两种模式）；[RemNote 定价页](https://www.remnote.com/pricing)免费档限量 5 张、Pro 无限。
  - 解决什么痛点：记住图片/图表上的位置信息。
  - 对 bz-review 的契合度：**低** —— bz-review 的卡来自电子书划线，主体是文字；Anki 已免费内置，付费吸引力被稀释。
  - 实现体量：**中到大**（需要图片选区与遮挡渲染）。
  - 建议档位：**不做** —— 与「读书划线」主链路弱相关，投入产出比差。

- **功能名：音频卡 / 自己录音的卡**
  - 谁在做：[Anki 官方手册 Adding/Editing](https://docs.ankiweb.net/manual/editing)的麦克风录音与媒体附件；[AnkiDroid README](https://github.com/ankidroid/Anki-Android/blob/main/README.md)支持 sounds；[Mochi 定价页](https://www.mochi.cards/pricing/)的 Transcription 按量收费。
  - 解决什么痛点：语言学习中的听力与发音。
  - 对 bz-review 的契合度：**低** —— bz-review 不是语言学习工具；「听卡片」应走 TTS 复用路线，而不是新增录音卡形态。
  - 实现体量：中。
  - 建议档位：**不做**（除非先验证 TTS 听复习的付费意愿）。

- **功能名：成就系统 / 徽章 / 排行榜**
  - 谁在做：[SuperMemo Premium](https://www.supermemo.com/en/premium-subscription)用 statistics、progress summaries 与 ranking 做留存。
  - 解决什么痛点：用游戏化维持习惯。
  - 对 bz-review 的契合度：**低** —— 已有「连续添柴天数」这一最有效的连续记录；徽章对成年读书用户付费意愿弱。
  - 实现体量：中。
  - 建议档位：**免费档或不做** —— 即便做也只是留存装饰，撑不起付费点。

- **功能名：OCR 识别纸质书划线**
  - 谁在做：[Readwise 定价页](https://readwise.io/pricing)把「OCR to capture physical books」列在付费档。
  - 解决什么痛点：纸质书划线无法数字化。
  - 对 bz-review 的契合度：**低** —— 链路起点是 bz Reader 的电子书划线，用户路径根本不经过拍照。
  - 实现体量：大。
  - 建议档位：**不做** —— 这是 Readwise 的业务，不是 bz-review 的业务。

## 三、我的推荐优先级（前 8）

排序标准是「付费吸引力 × 与现有能力契合 × 实现成本」，且已扣掉持续成本风险：

- **第 1 名：听卡片 / 听复习（复用本地 TTS）** —— Mochi/Readwise/AnkiDroid/Migaku 都有 TTS 证据，付费吸引力已被验证；bz Reader 的本地音色与离线音频包是零边际成本的现成能力；卖断 + 离线 + 中文音色是订阅制竞品给不了的差异化。这是最值得押注的一项。
- **第 2 名：复习卡一键跳回原文并高亮定位** —— 只属于「bz Reader + bz-review」组合的体验，竞品里 AnkiBridge/Obsidian_to_Anki 只做到「跳回源文件」，做不到「跳回书里那一句并高亮」。契合度最高，且能直接卖出套装价值。
- **第 3 名：按书/章节维度的复习分析 + 导出报告** —— 在已有派生数据上做增量，避开重复建设；Readwise 明确把导出作为付费分界线，零服务器成本。
- **第 4 名：卡片管理器（搜索/筛选/挂起/埋藏/删除）** —— GitHub issue #1646 是真实用户诉求；与「高级档不限卡量」形成组合拳，实现轻。
- **第 5 名：集中复习 / 考前速刷模式** —— GitHub issue #1675 佐证；复用队列与评级，只加一层不回写主排程的临时会话，体量最小。
- **第 6 名：每日复习摘要笔记（本地生成）** —— 用本地笔记替代 Readwise 的付费邮件日报，完全零成本，强化「数据留在本地」的卖断信任。
- **第 7 名：Anki CSV/文本导入** —— 降低迁移门槛的转化功能；先做轻量的 CSV/文本，`.apkg` 完整解析留到验证有需求之后。
- **第 8 名：AI 出题策略 / 提示词模板库（BYOK，不送额度）** —— 有付费先例，但出题目前归 bz Reader，耦合度最高；作为高级档的「内容包」而非额度来卖，避免任何持续成本。

一句话结论：**前 3 项是真正能撑起溢价的，4–8 项是提高高级档「值感」的配套；不要为了凑数把「云同步」「AI 额度」「卡片市场」塞进高级档。**

## 四、明确不该做的清单

- **云同步 / 账号体系**：卖断一次收入覆盖不了多年服务器、流量与合规成本（依据：[Anki 官方同步手册](https://docs.ankiweb.net/manual/syncing)、[Mochi 定价页](https://www.mochi.cards/pricing/)）。让 Obsidian Sync / 网盘同步 `review.json` 即可。
- **送 AI 调用额度 / 内置 AI 服务**：RemNote 1000→20000 credits、Mochi 5000→500000 tokens 都是订阅内的按量设计（依据：[RemNote 定价页](https://www.remnote.com/pricing)、[Mochi 定价页](https://www.mochi.cards/pricing/)），卖断模式下这是负毛利。坚持 BYOK，只卖提示词与规则内容。
- **卡片模板市场 / 共享牌组平台**：AnkiHub 靠订阅和 Lifetime $450 才撑得住（依据：[AnkiHub 官网](https://www.ankihub.net)），个人开发者卖断做平台是资源错配；且与「个人读书记忆」定位冲突。
- **通用统计热力图 / 留存率面板 / 通用提醒**：bz-review README 第 34 行已写明基础版高级版都有，源码已有完整派生数据（依据：[bz-review README](https://github.com/yeshimei/bz-review) 及本地 `src/review/analysis/data.ts`）。重复做不产生新付费理由。
- **图片遮挡卡**：Anki 23.10+ 已免费内置（依据：[Anki 官方手册](https://docs.ankiweb.net/manual/editing)），且文字划线场景下使用率低。
- **音频卡 / 录音卡、OCR 纸书划线、成就系统**：与「电子书划线→卡片→复习」主链路弱相关（依据：[Anki 官方手册](https://docs.ankiweb.net/manual/editing)、[Readwise 定价页](https://readwise.io/pricing)、[SuperMemo Premium](https://www.supermemo.com/en/premium-subscription)），付费吸引力弱或实现成本不匹配。

## 五、来源清单

- https://community.obsidian.md/plugins/obsidian-spaced-repetition —— 证明 Spaced Repetition 的下载量、许可、卡片格式、FSRS/SM-2、统计等完整免费功能面。
- https://github.com/st3v3nmw/obsidian-spaced-repetition/issues/ —— 证明卡片管理器、临时加权速刷、排程数据外置、间隔调参是真实未满足诉求。
- https://community.obsidian.md/plugins/obsidian-to-anki-plugin —— 证明 Obsidian_to_Anki 的下载量、许可、桌面端限制与「导出到 Anki」定位。
- https://github.com/ObsidianToAnki/Obsidian_to_Anki —— 证明其 cloze 语法、源文件链接、自定义语法等具体能力。
- https://jeppeklitgaard.github.io/ObsidianAnkiBridge/ —— 证明 AnkiBridge 的单向同步原则、blueprint、媒体渲染与「Linking to source from Anki」。
- https://community.obsidian.md/plugins/obsidian-recall —— 证明 Recall 的下载量、MIT 许可与「多算法可选」卖点。
- https://github.com/open-spaced-repetition/obsidian-spaced-repetition-recall/blob/dev-master/docs/usage.md —— 证明 OSR 对原插件的接手、FSRS v4 参数体系、独立 `tracked_files.json` 与迁移备份风险。
- https://vaultpicks.net/tools/obsidian-plugin-finder —— 第三方目录数据，证明 Heatmap Calendar 属高下载量通用可视化插件（二手旁证）。
- https://truerecall.app/docs/compare/obsidian-flashcard-plugins —— 厂商自建对比页，证明各 Obsidian 插件调度器差异（带立场，旁证）。
- https://readwise.io/pricing —— 证明 Readwise 各档价格、Mastery flashcards/Review tuning/导出/Ghostreader/OCR 均属付费档、Lite 不含导出、Reader 含 text-to-speech、30 天试用。
- https://docs.readwise.io/highlights/guides/mastery —— 证明 Mastery 把高亮转 Q&A 与 cloze、Daily Review 分两半、Mastery 卡按间隔重复、`.qa` Action Tag 在阅读时生成卡片。
- https://www.mochi.cards/pricing/ —— 证明 Mochi 免费/Pro 边界、TTS 按量收费（200 vs 200,000 字符）、同步/发布牌组/AI 均属 Pro。
- https://www.remnote.com/pricing —— 证明 RemNote 免费档的 PDF/图片遮挡/手写限额、Pro 与 Pro with AI 的价格与 AI credits 分级。
- https://github.com/ankidroid/Anki-Android/blob/main/README.md —— 证明 AnkiDroid 的 TTS 集成、FSRS、详细统计、AnkiWeb 同步与 10000+ 预置牌组。
- https://docs.ankiweb.net/manual/editing —— 证明 Anki 原生支持 cloze 与 Image Occlusion（23.10+）、麦克风录音、book/page 字段与筛选牌组。
- https://docs.ankiweb.net/manual/syncing —— 证明 AnkiWeb 的多设备同步与冲突合并机制。
- https://www.ankihub.net —— 证明共享牌组市场的 Free/Core/Premium/Lifetime 定价与 Lifetime 买断档存在。
- https://www.supermemo.com/en/premium-subscription —— 证明 SuperMemo 付费点集中在课程与 AI、而非调度算法，并含排行榜等留存工具。
- https://migaku.com/ —— 证明 Migaku 的「网页/视频→卡片」链路、高级 TTS 与 Lifetime 买断策略。
- https://quizlet.com/ —— 二手受限来源，仅证明 Quizlet 有免费卡与付费学习工具的分层（upgrade 页被反爬拦截，未取到一手价目）。
- https://knowt.com/ —— 二手受限来源，仅证明 Knowt 以 AI 工具为差异化（pricing 页 404，未取到一手价目）。
- https://github.com/yeshimei/bz-review —— 证明 bz-review 现状：提醒/评级/排期/统计/记忆分析/复习方式在基础版与高级版都可用、20/50 限量、离线验签、不联网。
