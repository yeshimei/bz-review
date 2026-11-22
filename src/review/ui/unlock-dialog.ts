/* ============================================================
 * 高级功能弹窗（照 bz-reader 的功能对照表）：
 * 两版功能完全一致，只差笔记 + 划线的合计数量上限。价格不写进插件。
 * 弹窗只做引导（去购买 / 交流群）；填激活码统一走设置页「授权」组，别在两处各做一份。
 * ============================================================ */
import { uiModal } from '../../core/ui/modal';
import { FREE_ITEM_LIMIT, GROUP_ID, PURCHASE_URL, isPaid } from '../../data/entitlement';
import { openExternalUrl } from './links-bridge';
import { t, type MsgKey } from '../../i18n';

const YES = '✓';

/** 对照表行：label 存 key，渲染时按当前语言出词；free/pro 只存四种标记。
 *  （模块级常量不能直接存 t() 结果，否则语言会冻在首次加载那一刻。） */
type CellMark = 'yes' | 'limit' | 'unlimited';
interface PlanRowSpec {
  label: MsgKey;
  note?: string;
  free: CellMark;
  pro: CellMark;
}

const GROUPS: Array<{ title: MsgKey; rows: PlanRowSpec[] }> = [
  {
    title: 'unlock.g.count',
    rows: [{ label: 'unlock.r.limit', free: 'limit', pro: 'unlimited' }],
  },
  {
    title: 'unlock.g.add',
    rows: [
      { label: 'unlock.r.selText', free: 'yes', pro: 'yes' },
      { label: 'unlock.r.oneTap', free: 'yes', pro: 'yes' },
      { label: 'unlock.r.batch', free: 'yes', pro: 'yes' },
      { label: 'unlock.r.fullRecall', free: 'yes', pro: 'yes' },
      { label: 'unlock.r.flash', free: 'yes', pro: 'yes' },
      { label: 'unlock.r.quiz', free: 'yes', pro: 'yes' },
    ],
  },
  {
    title: 'unlock.g.make',
    rows: [
      { label: 'unlock.r.editFront', free: 'yes', pro: 'yes' },
      { label: 'unlock.r.regen', free: 'yes', pro: 'yes' },
      { label: 'unlock.r.addDel', free: 'yes', pro: 'yes' },
    ],
  },
  {
    title: 'unlock.g.schedule',
    rows: [
      { label: 'unlock.r.flashReview', free: 'yes', pro: 'yes' },
      { label: 'unlock.r.quizAsIs', free: 'yes', pro: 'yes' },
      { label: 'unlock.r.fsrs', free: 'yes', pro: 'yes' },
      { label: 'unlock.r.fit', free: 'yes', pro: 'yes' },
      { label: 'unlock.r.books', free: 'yes', pro: 'yes' },
      { label: 'unlock.r.manager', free: 'yes', pro: 'yes' },
    ],
  },
  {
    title: 'unlock.g.quiz',
    rows: [
      { label: 'unlock.r.countDiff', free: 'yes', pro: 'yes' },
      { label: 'unlock.r.multi', free: 'yes', pro: 'yes' },
      { label: 'unlock.r.shuffle', free: 'yes', pro: 'yes' },
    ],
  },
  {
    title: 'unlock.g.data',
    rows: [
      { label: 'unlock.r.stats', free: 'yes', pro: 'yes' },
      { label: 'unlock.r.snapshot', free: 'yes', pro: 'yes' },
      { label: 'unlock.r.rollback', free: 'yes', pro: 'yes' },
    ],
  },
  {
    title: 'unlock.g.ai',
    rows: [
      { label: 'unlock.r.providers', free: 'yes', pro: 'yes' },
      { label: 'unlock.r.tts', free: 'yes', pro: 'yes' },
      { label: 'unlock.r.watch', free: 'yes', pro: 'yes' },
    ],
  },
];

const esc = (s: string): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function cell(v: string, pro: boolean): string {
  return `<i class="c${pro ? ' pro' : ''}${v === YES ? ' y' : ''}">${esc(v)}</i>`;
}

function cellMark(mark: CellMark): string {
  if (mark === 'limit') return t('unlock.items50');
  if (mark === 'unlimited') return t('unlock.unlimited');
  return YES;
}

export function unlockDialogHtml(paid: boolean, reason = ''): string {
  const body = GROUPS.map(
    (g) =>
      `<div class="bzs-plan-row is-group"><span>${esc(t(g.title))}</span>${cell('', false)}${cell('', true)}</div>` +
      g.rows
        .map(
          (r) =>
            `<div class="bzs-plan-row"><span>${esc(t(r.label))}${r.note ? `<em>${esc(r.note)}</em>` : ''}</span>${cell(cellMark(r.free), false)}${cell(cellMark(r.pro), true)}</div>`,
        )
        .join(''),
  ).join('');
  const different = GROUPS.reduce((n, g) => n + g.rows.filter((r) => r.free !== r.pro).length, 0);
  const total = GROUPS.reduce((n, g) => n + g.rows.length, 0);
  return (
    '<div class="bzs-unlock">' +
    `<p class="bzs-unlock-sub">${esc(reason || t('unlock.subtitle'))}</p>` +
    `<div class="bzs-plan-head"><span>${t('unlock.headFeature')}</span><i class="c">${t('unlock.headBase')}<small>${t('unlock.headBaseSmall')}</small></i><i class="c pro">${t('unlock.headPro')}<small>${t('unlock.headProSmall')}</small></i></div>` +
    `<div class="bzs-plan">${body}</div>` +
    `<div class="bzs-plan-row is-total"><span>${t('unlock.total', { total: total - different, diff: different })}</span>${cell('', false)}${cell('', true)}</div>` +
    '</div>'
  );
}

/** 打开高级功能弹窗（设置页授权组入口 / 额度到顶时自动弹出） */
export function openReviewUnlockDialog(opts: { reason?: string } = {}): void {
  const paid = isPaid();
  const modal = uiModal({
    content: unlockDialogHtml(paid, opts.reason),
    className: 'bzs-unlock-dialog',
    title: t('unlock.title'),
    head: true,
    size: 'lg',
  });
  /* 照 bz-reader 的 modal：头、可滚表格、底部购买/交流群按钮三段。
     按钮不塞进滚动内容里，否则长表一滚就看不见，用户不知道去哪买。 */
  modal.popup.classList.add('bzs-unlock-modal');
  const foot = createDiv({ cls: 'bzs-unlock-foot' });
  if (!paid) {
    const buy = createEl('button', { cls: 'bzs-btn pri' });
    buy.type = 'button';
    buy.dataset.act = 'unlockbuy';
    buy.textContent = t('unlock.buy');
    foot.appendChild(buy);
  }
  const group = createEl('button', { cls: 'bzs-btn' });
  group.type = 'button';
  group.dataset.act = 'unlockgroup';
  group.textContent = t('unlock.group', { id: GROUP_ID });
  foot.appendChild(group);
  modal.popup.appendChild(foot);
  modal.popup.scrollTop = 0;
  modal.popup.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'unlockbuy') openExternalUrl(PURCHASE_URL);
    else if (act === 'unlockgroup') openExternalUrl(`https://qm.qq.com/q/${GROUP_ID}`);
  });
}

/**
 * 基础版额度到顶：弹同一份对照表，顶上说明合计额度已满、数据不会被删。
 * 额度是笔记 + 划线合计，不再按类别分两句。
 */
export function openQuotaUpgradeDialog(): void {
  openReviewUnlockDialog({
    reason: t('unlock.quota', { limit: FREE_ITEM_LIMIT }),
  });
}
