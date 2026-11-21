/**
 * 中文文案包（src/i18n/zh.ts）—— **基准包**
 *
 * 这个文件的 key 集合就是全局类型真源：`MsgKey = keyof typeof ZH`，
 * 英文包漏一条 `tsc` 直接红。所以新增文案永远先加这里。
 *
 * 命名：`域名.动作`，一律扁平带点（不用嵌套对象——嵌套会让「补一条文案」
 * 变成「改三层结构」）。范围从 P0 起步：入口（命令 / ribbon / 右键菜单）、
 * 通知、设置页语言项、支持作者弹窗。面板与其余弹窗按批次逐步收口。
 *
 * 文案口径沿用壳层原有写法（改语言不顺手改中文）。
 */

export const ZH = {
  /* ── 通用词 ──────────────────────────────────────────────── */
  'common.untitled': '未命名',
  'common.close': '关闭',
  'common.loading': '加载中…',

  /* ── 插件入口 ────────────────────────────────────────────── */
  'ribbon.review': '复习',
  'view.review': '复习',
  'menu.addToReview': '加入复习',
  'menu.addFolderToReview': '加入复习（文件夹）',

  /* ── 命令 ────────────────────────────────────────────────── */
  'cmd.open': '打开复习',
  'cmd.start': '开始复习',
  'cmd.addCurrent': '把当前笔记加入复习',
  'cmd.addFromReader': '从阅读器加入复习',
  'cmd.addSelection': '把选中内容加入复习',
  'cmd.removeCurrent': '把当前笔记移出复习',
  'cmd.jumpOverdue': '跳到逾期复习',
  'cmd.rate': '选择复习难度',
  'cmd.undo': '撤销上一次评级',
  'cmd.reviewAll': '不限到期，全部过一遍',
  'cmd.setNextDate': '设置当前笔记的下次复习日期',
  'cmd.importMd': '从当前笔记导入卡片',
  'cmd.importAnki': '从 Anki 文件导入卡片',
  'cmd.exportBackup': '导出备份（JSON）',
  'cmd.exportCsv': '导出表格（CSV）',
  'cmd.restoreBackup': '从备份恢复',
  'cmd.backupHistory': '备份与回滚',
  'cmd.forecast': '未来复习负荷',
  'cmd.achievements': '成就',
  'cmd.exportStats': '导出统计（CSV）',
  'cmd.exportCards': '划线卡导出为笔记',
  'cmd.report': '复习分析报告',
  'cmd.bookReport': '按书档案',
  'cmd.cardManager': '卡片管理器',
  'cmd.exportBookReport': '导出按书报告（Markdown）',
  'cmd.quiz': '做题练习',
  'cmd.rateAgain': '复习评级：忘了',
  'cmd.rateHard': '复习评级：困难',
  'cmd.rateGood': '复习评级：一般',
  'cmd.rateEasy': '复习评级：简单',
  'cmd.migrateBz': '从 bz 导入复习',

  /* ── 通知：入口与导入导出 ────────────────────────────────── */
  'notice.importMd.empty': '这篇里没有认出卡片（写法：`问题 :: 答案` 或 `{{挖空}}`）',
  'notice.importMd.atLimit': '合计已达基础版上限，这批未加入；升级高级版后可继续',
  'notice.importMd.done': '导入 {added} 张',
  'notice.importMd.skipped': '，跳过 {skipped} 张（已存在）',
  'notice.exportBackup.done': '已导出 {n} 条：{path}',
  'notice.exportStats.done': '统计已导出：{path}',
  'notice.exportCards.done': '已导出划线卡：{path}',
  'notice.exportBookReport.done': '按书报告已导出：{path}',
  'notice.exportBookReport.empty': '还没有复习数据，先加入条目并完成一次复习。',
  'notice.exportBookReport.action': '导出按书报告',

  /* ── 授权 ────────────────────────────────────────────────── */
  'notice.license.invalid': '激活码无效或已过期，原来的激活码已保留。',
  'notice.license.activated': '已激活高级版',
  'notice.license.activatedName': '已激活高级版（{name}）',
  'notice.license.unlimitedNote': '，数量不限。',

  /* ── 设置页：语言 ────────────────────────────────────────── */
  'settings.language': '语言',
  'settings.language.desc': '界面显示中文还是英文',
  'settings.language.auto': '跟随 Obsidian',
  'settings.language.hint': '命令面板里的命令名要在重启 Obsidian 后才更新，其余界面切换后立即生效。',
  'notice.language.changed': '界面语言已切换，命令名需重启 Obsidian 后更新',

  /* ── 设置页：关于条 ──────────────────────────────────────── */
  'settings.about.support': '支持作者',
  'settings.about.supportTip': '看看支持作者的方式',
  'settings.about.changelog': '更新日志',
  'settings.about.changelogTip': '看看每一版改了什么',
  'about.video': '视频教程',
  'about.group': 'QQ 交流群',
  'about.githubSr': '打开 GitHub 仓库',
  'about.videoSr': '打开视频教程',
  'about.copyGroupSr': '复制群号',
  'about.supportSr': '看看支持作者的方式',
  'about.changelogSr': '看看每一版改了什么',
  'about.pro': '高级版',
  'about.base': '基础版',
  'about.patron': '赞助人',

  /* ── 设置页：插件组 ──────────────────────────────────────── */
  'plugin.title': '插件',
  'plugin.readerChip': '配套阅读器',
  'plugin.readerDesc':
    '把库变成阅读器：桌面 + 手机、多种格式、AI 追问与全文问答、离线朗读、阅读统计，数据全留本地。',
  'plugin.readerInstalled': '已安装{version}{disabled}。',
  'plugin.disabledNote': '（未启用）',
  'plugin.tag.formats': '多格式',
  'plugin.tag.qa': 'AI 问答',
  'plugin.tag.tts': '离线朗读',
  'plugin.install': '安装',
  'plugin.open': '打开',

  /* ── 设置页：快捷键 ──────────────────────────────────────── */
  'shortcuts.title': '快捷键',
  'shortcuts.unset': '未设置',
  'shortcuts.hint': '到 Obsidian 快捷键设置里改这条命令',
  'shortcuts.open': '打开复习面板',
  'shortcuts.start': '开始复习',
  'shortcuts.add': '把当前笔记加入复习',
  'shortcuts.rate': '标记复习（评级）',

  /* ── 通知：Reader 安装器 ─────────────────────────────────── */
  'notice.reader.mobile': '插件安装要在桌面端完成；手机上请到社区插件市场安装',
  'notice.reader.installed': 'bz Reader v{version} 已安装并启用',
  'notice.reader.installedManual': 'bz Reader v{version} 已安装，请在第三方插件里手动启用',
  'notice.reader.notReady': '已装好，到命令面板运行「bz Reader: 打开书架」',
  'notice.reader.shelfNotReady': 'bz Reader 还没加载好，稍后到命令面板运行「打开书架」',
  'notice.reader.failed': '安装失败：{reason}',
  'reader.stage.prepare': '准备…',
  'reader.stage.retry': '重试',

  /* ── 支持作者弹窗 ────────────────────────────────────────── */
  'support.title': '支持作者',
  'support.lead': '这个插件和这些教程都是一个人在做。',
  'support.ways': '微信扫码',
  'support.sponsor': '成为赞助人',
  'support.star': '给个 Star',
  'support.note': '打赏后会出现在这份名单里。',
  'support.list': '支持者',
  'support.empty': '还没有人打赏',
  'support.loading': '名单加载中…',
  'support.loadFailed': '名单没加载出来',
  'support.retry': '重试',
  'support.amountPatron': '赞助人',
  'support.codeAlt': '微信赞赏码',
  'support.done': '知道了',
  'support.close': '关闭支持作者',
};

export type MsgKey = keyof typeof ZH;
