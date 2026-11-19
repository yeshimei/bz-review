/* ============================================================
 * 照搬 reader 弹窗用的 key 式文案桥（src/review/ui/i18n-bridge.ts）
 *
 * bz-review 自己的 t(zh, en) 是双字面式；reader 的支持作者弹窗按 key 取词。
 * 这里只补那一个入口，文案与 reader 的中英两版逐字一致，不碰主 i18n。
 * ============================================================ */
import { currentLang } from '../../i18n';

const ZH: Record<string, string> = {
  'settings.about.support': '支持作者',
  'settings.about.supportTip': '看看支持作者的方式',
  'settings.about.changelog': '更新日志',
  'settings.about.changelogTip': '看看每一版改了什么',
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

const EN: Record<string, string> = {
  'settings.about.support': 'Support the author',
  'settings.about.supportTip': 'See ways to support the author',
  'settings.about.changelog': 'Changelog',
  'settings.about.changelogTip': 'See what changed in each release',
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

export function t(key: string): string {
  return currentLang() === 'en' ? (EN[key] ?? key) : (ZH[key] ?? key);
}

export function changelogLang(): 'zh' | 'en' {
  return currentLang();
}
