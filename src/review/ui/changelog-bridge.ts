/* ============================================================
 * 更新日志数据适配（src/review/ui/changelog-bridge.ts）
 *
 * bz-review 内置日志的 domain/text 是单语文案；reader 弹窗按 {zh,en} 取词。
 * 这里把内置数据映射成 reader 的形状，弹窗代码一字不改即可 1:1 工作。
 * ============================================================ */
import { CHANGELOG_RELEASES as BUILTIN } from '../../core/changelog-data';
import { compareVersions, normalizeVersion } from '../../core/version';

export { compareVersions, normalizeVersion };

export interface L10nText {
  zh: string;
  en: string;
}

export interface ChangelogEntry {
  domain: L10nText;
  text: L10nText;
  issue?: number;
  qq?: string;
}

export interface ChangelogRelease {
  version: string;
  date?: string;
  added?: ChangelogEntry[];
  improved?: ChangelogEntry[];
  fixed?: ChangelogEntry[];
}

const l = (s: string): L10nText => ({ zh: s, en: s });
const entries = (rows: readonly { domain: string; text: string; sub?: string }[] | undefined): ChangelogEntry[] | undefined =>
  rows?.map((r) => ({ domain: l(r.domain), text: l(r.sub ? `${r.text}（${r.sub}）` : r.text) }));

/** 内置日志 → reader 弹窗要的形状（最新在前） */
export const REVIEW_RELEASES: readonly ChangelogRelease[] = BUILTIN.map((r) => ({
  version: r.version,
  date: r.date,
  added: entries(r.added),
  improved: entries(r.improved),
  fixed: entries(r.fixed),
}));

export function releaseEntryCount(release: ChangelogRelease): number {
  return (release.added?.length || 0) + (release.improved?.length || 0) + (release.fixed?.length || 0);
}
