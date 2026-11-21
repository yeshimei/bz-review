/**
 * 英文文案包（src/i18n/en.ts）
 *
 * 类型是 `Record<MsgKey, string>`：中文基准包加一条、这里漏一条，`tsc` 直接红。
 * 口径：命令名用动词开头、短句（命令面板里一个词就能搜到）；通知用完成态。
 * 专有名词保持原样（bz Reader / Obsidian / FSRS / Anki / GitHub）。
 */
import type { MsgKey } from './zh';

export const EN: Record<MsgKey, string> = {
  /* ── Common ─────────────────────────────────────────────── */
  'common.untitled': 'Untitled',
  'common.close': 'Close',
  'common.loading': 'Loading…',

  /* ── Entry points ───────────────────────────────────────── */
  'ribbon.review': 'Review',
  'view.review': 'Review',
  'menu.addToReview': 'Add to review',
  'menu.addFolderToReview': 'Add folder to review',

  /* ── Commands ───────────────────────────────────────────── */
  'cmd.open': 'Open review plan',
  'cmd.start': 'Start review',
  'cmd.addCurrent': 'Add current note to review plan',
  'cmd.addFromReader': 'Add from bz Reader',
  'cmd.addSelection': 'Add selection to review plan',
  'cmd.removeCurrent': 'Remove current note from review plan',
  'cmd.jumpOverdue': 'Jump to overdue review',
  'cmd.rate': 'Pick review difficulty',
  'cmd.undo': 'Undo last rating',
  'cmd.reviewAll': 'Review everything now',
  'cmd.setNextDate': 'Set next review date',
  'cmd.importMd': 'Import cards from current note',
  'cmd.importAnki': 'Import cards from Anki file',
  'cmd.exportBackup': 'Export backup (JSON)',
  'cmd.exportCsv': 'Export spreadsheet (CSV)',
  'cmd.restoreBackup': 'Restore from backup',
  'cmd.backupHistory': 'Backup & restore',
  'cmd.forecast': 'Upcoming workload',
  'cmd.achievements': 'Achievements',
  'cmd.exportStats': 'Export stats (CSV)',
  'cmd.exportCards': 'Export highlights to note',
  'cmd.report': 'Review report',
  'cmd.bookReport': 'Book report',
  'cmd.cardManager': 'Card manager',
  'cmd.exportBookReport': 'Export book report (Markdown)',
  'cmd.quiz': 'Quiz practice',
  'cmd.rateAgain': 'Rate: again',
  'cmd.rateHard': 'Rate: hard',
  'cmd.rateGood': 'Rate: good',
  'cmd.rateEasy': 'Rate: easy',
  'cmd.migrateBz': 'Import review plan from bz',

  /* ── Notices: import / export ───────────────────────────── */
  'notice.importMd.empty': 'No cards found in this note (use `Question :: Answer` or `{{cloze}}`)',
  'notice.importMd.atLimit': 'Basic plan limit reached, so this batch was not added. Upgrade for unlimited cards.',
  'notice.importMd.done': 'Imported {added}',
  'notice.importMd.skipped': ', skipped {skipped} (already exist)',
  'notice.exportBackup.done': 'Exported {n} item(s): {path}',
  'notice.exportStats.done': 'Stats exported: {path}',
  'notice.exportCards.done': 'Highlights exported: {path}',
  'notice.exportBookReport.done': 'Book report exported: {path}',
  'notice.exportBookReport.empty': 'No review data yet. Add items and finish one review first.',
  'notice.exportBookReport.action': 'export the book report',

  /* ── License ────────────────────────────────────────────── */
  'notice.license.invalid': 'Invalid or expired code. Your previous code was kept.',
  'notice.license.activated': 'Pro activated',
  'notice.license.activatedName': 'Pro activated ({name})',
  'notice.license.unlimitedNote': ', unlimited cards.',

  /* ── Settings: language ─────────────────────────────────── */
  'settings.language': 'Language',
  'settings.language.desc': 'Language used by the interface',
  'settings.language.auto': 'Follow Obsidian',
  'settings.language.hint': 'Command names update after restarting Obsidian; the rest of the interface switches immediately.',
  'notice.language.changed': 'Interface language changed. Command names update after an Obsidian restart',

  /* ── Settings: about bar ────────────────────────────────── */
  'settings.about.support': 'Support the author',
  'settings.about.supportTip': 'See ways to support the author',
  'settings.about.changelog': 'Changelog',
  'settings.about.changelogTip': 'See what changed in each release',
  'about.video': 'Video tutorials',
  'about.group': 'QQ group',
  'about.githubSr': 'Open the GitHub repository',
  'about.videoSr': 'Open the video tutorials',
  'about.copyGroupSr': 'Copy the group number',
  'about.supportSr': 'See ways to support the author',
  'about.changelogSr': 'See what changed in each release',
  'about.pro': 'Pro',
  'about.base': 'Basic',
  'about.patron': 'Sponsor',

  /* ── Settings: plugin group ─────────────────────────────── */
  'plugin.title': 'Plugins',
  'plugin.readerChip': 'Companion reader',
  'plugin.readerDesc':
    'Turn your vault into a reader: desktop and mobile, many formats, AI follow-ups and full-text Q&A, offline read-aloud, reading stats. All data stays local.',
  'plugin.readerInstalled': 'Installed{version}{disabled}. ',
  'plugin.disabledNote': ' (disabled)',
  'plugin.tag.formats': 'Formats',
  'plugin.tag.qa': 'AI Q&A',
  'plugin.tag.tts': 'Offline TTS',
  'plugin.install': 'Install',
  'plugin.open': 'Open',

  /* ── Settings: shortcuts ────────────────────────────────── */
  'shortcuts.title': 'Shortcuts',
  'shortcuts.unset': 'Not set',
  'shortcuts.hint': 'Change this command in Obsidian hotkey settings',
  'shortcuts.open': 'Open review plan',
  'shortcuts.start': 'Start review',
  'shortcuts.add': 'Add current note to review plan',
  'shortcuts.rate': 'Rate a review',

  /* ── Notices: Reader installer ──────────────────────────── */
  'notice.reader.mobile': 'Installing plugins must be done on desktop. On mobile, install from the community plugin marketplace.',
  'notice.reader.installed': 'bz Reader v{version} installed and enabled',
  'notice.reader.installedManual': 'bz Reader v{version} installed. Enable it in community plugins.',
  'notice.reader.notReady': 'Installed. Run "bz Reader: Open shelf" from the command palette.',
  'notice.reader.shelfNotReady': 'bz Reader is not ready yet. Run "Open shelf" from the command palette in a moment.',
  'notice.reader.failed': 'Install failed: {reason}',
  'reader.stage.prepare': 'Preparing…',
  'reader.stage.retry': 'Retry',

  /* ── Support dialog ─────────────────────────────────────── */
  'support.title': 'Support the author',
  'support.lead': 'This plugin and these tutorials are made by one person.',
  'support.ways': 'WeChat QR',
  'support.sponsor': 'Become a sponsor',
  'support.star': 'Give it a Star',
  'support.note': 'Supporters are listed below.',
  'support.list': 'Supporters',
  'support.empty': 'No one has tipped yet',
  'support.loading': 'Loading supporters…',
  'support.loadFailed': 'Could not load the list',
  'support.retry': 'Retry',
  'support.amountPatron': 'Sponsor',
  'support.codeAlt': 'WeChat tip QR code',
  'support.done': 'Got it',
  'support.close': 'Close the support dialog',
};
