/**
 * 对外输出的几种文字形态（批 6，纯函数）。
 *
 * 复习数据一直只在插件里：统计看得到、导不出，划线卡背得出来、带不走。
 * 这里把三样东西变成能离开插件的文本——统计表、划线卡清单、负荷预测，
 * 全部只读，不改任何数据。
 */
import type { ReviewItem } from './data';
import type { ReviewStats } from './stats';
import type { LoadPoint } from './queue';
import { t } from '../i18n/strings';

/** 统计导出成 CSV（两列长表，Excel 里好画图） */
export function statsToCsv(stats: ReviewStats): string {
  const rows: Array<[string, string | number]> = [
    [t('report.totalDays'), stats.totalReviews],
    [t('report.streak'), stats.streak],
    [t('report.today'), stats.todayReviews],
    [t('report.notes'), stats.reviewedNotes],
    [t('report.overdueRate'), `${Math.round(stats.overdueRate * 100)}%`],
    [t('report.avgR'), stats.avgR === null ? '—' : `${Math.round(stats.avgR * 100)}%`],
    [t('report.firstDate'), stats.firstReviewAt ?? '—'],
    [t('report.ratingAgain'), stats.ratingDist.again ?? 0],
    [t('report.ratingHard'), stats.ratingDist.hard ?? 0],
    [t('report.ratingGood'), stats.ratingDist.good ?? 0],
    [t('report.ratingEasy'), stats.ratingDist.easy ?? 0],
  ];
  for (const d of stats.daily7 ?? []) rows.push([t('report.last7', { date: d.date }), d.count]);
  const esc = (v: string | number): string => {
    let s = String(v);
    /* 防公式注入：指标名/日期若以 = + - @ 开头，Excel 会当公式执行。 */
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [t('report.csvHeader'), ...rows.map(([k, v]) => `${esc(k)},${esc(v)}`)].join('\n') + '\n';
}

/** 划线卡导出成 Markdown（按书分组；带想法与问答，导入 Anki 也好、打印也好） */
export function cardsToMarkdown(items: readonly ReviewItem[], now: Date = new Date()): string {
  const cards = items.filter((i) => i.kind === 'card' && i.card);
  const byBook = new Map<string, ReviewItem[]>();
  for (const it of cards) {
    const book = String(it.card?.bookTitle ?? '').trim() || t('report.untitled');
    const list = byBook.get(book) ?? [];
    list.push(it);
    byBook.set(book, list);
  }
  /* 本地日期：toISOString 是 UTC，东八区凌晨导出会写成前一天。 */
  const d = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const lines: string[] = [
    t('report.cardsTitle'),
    '',
    t('report.cardsIntro', { date: d, n: cards.length }),
    '',
  ];
  for (const [book, list] of byBook) {
    lines.push(`## ${book}`, '');
    for (const it of list) {
      const text = String(it.card?.text ?? '').replace(/\s+/g, ' ').trim();
      const comment = String(it.card?.comment ?? '').trim();
      lines.push(`- ${text}`);
      if (comment) lines.push(t('report.thought', { text: comment }));
      const qa = it.card?.qa;
      if (qa?.q && qa?.a) lines.push(t('report.qa', { q: qa.q }), t('report.answer', { a: qa.a }));
      const backlink = String(it.card?.backlink ?? '').trim();
      if (backlink) lines.push(t('report.backlink', { url: backlink }));
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** 负荷预测的纯文字版（弹窗与导出共用） */
export function forecastToText(points: readonly LoadPoint[], limit = 14): string {
  const head = points.slice(0, Math.max(1, limit)).filter((p) => p.count > 0);
  if (!head.length) return t('report.emptyForecast');
  /* 峰值要在全部 points 里找：total 算的是全部天数，若只在显示的 head（前 N 天）里
     找 peak，points 超过 N 天时会漏掉真正最忙的那天，报出一个偏小的假峰值。 */
  const peak = points.reduce((a, b) => (b.count > a.count ? b : a));
  const total = points.reduce((s, p) => s + p.count, 0);
  return [
    t('report.forecast', { points: points.length, total, day: peak.day, n: peak.count }),
    '',
    ...head.map((p) => `${p.day}  ${'▇'.repeat(Math.min(20, p.count))} ${p.count}`),
  ].join('\n');
}

/**
 * 把 forecastToText 的文本渲染成 DOM：日期/数字保持正文色，▇ 条改为真实条形走强调色 token。
 * 纯文本版仍供导出与测试使用；展示层两处（forecast 弹窗、数据页）共用这一份，避免一个跟随一个不跟随。
 */
export function renderForecastInto(host: HTMLElement, text: string): void {
  host.empty();
  for (const line of text.split('\n')) {
    const row = host.createDiv({ cls: 'bzrv-fc-row' });
    const m = /^(\S+)\s+(▇+)\s+(\d+)$/.exec(line);
    if (!m) {
      row.setText(line);
      continue;
    }
    row.createSpan({ cls: 'bzrv-fc-day', text: m[1] });
    const track = row.createSpan({ cls: 'bzrv-fc-track' });
    const bar = track.createSpan({ cls: 'bzrv-fc-bar' });
    bar.style.width = `${Math.round((m[2].length / 20) * 100)}%`;
    row.createSpan({ cls: 'bzrv-fc-num', text: m[3] });
  }
}
