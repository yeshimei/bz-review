/* ============================================================
 * 高级功能弹窗（照 bz-reader 的功能对照表）：
 * 两版功能完全一致，只有复习笔记 / 划线卡数量不同。价格不写进插件。
 * ============================================================ */
import { uiModal } from '../../core/ui/modal';
import { GROUP_ID, PURCHASE_URL } from '../../data/entitlement';
import { getLicenseState } from '../../data/entitlement';
import { openExternalUrl } from './links-bridge';

interface PlanRow {
  label: string;
  free: string;
  pro: string;
  note?: string;
}

const YES = '✓';

const GROUPS: Array<{ title: string; rows: PlanRow[] }> = [
  {
    title: '数量',
    rows: [
      { label: '复习笔记', free: '20 篇', pro: '不限', note: '基础版' },
      { label: '划线卡', free: '50 条', pro: '不限', note: '基础版' },
    ],
  },
  {
    title: '复习功能',
    rows: [
      { label: '抽认卡 / 做题 / 填空 / 上下文 / 展开全文', free: YES, pro: YES },
      { label: 'FSRS 排期与参数自动拟合', free: YES, pro: YES },
      { label: '做题家（题量、难度、多选、乱序）', free: YES, pro: YES },
      { label: '按书档案、卡片管理器、数据统计', free: YES, pro: YES },
      { label: '快照备份与回滚', free: YES, pro: YES },
    ],
  },
  {
    title: 'AI 与自动化',
    rows: [
      { label: '18 家 AI 服务商与模型选择', free: YES, pro: YES },
      { label: '本地 TTS 听卡片', free: YES, pro: YES },
      { label: '文件夹监听与自动加入', free: YES, pro: YES },
      { label: '更新日志与支持作者', free: YES, pro: YES },
    ],
  },
];

const esc = (s: string): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function cell(v: string, pro: boolean): string {
  return `<i class="c${pro ? ' pro' : ''}${v === YES ? ' y' : ''}">${esc(v)}</i>`;
}

export function unlockDialogHtml(paid: boolean): string {
  const body = GROUPS.map(
    (g) =>
      `<div class="bzs-plan-row is-group"><span>${esc(g.title)}</span>${cell('', false)}${cell('', true)}</div>` +
      g.rows
        .map(
          (r) =>
            `<div class="bzs-plan-row"><span>${esc(r.label)}${r.note ? `<em>${esc(r.note)}</em>` : ''}</span>${cell(r.free, false)}${cell(r.pro, true)}</div>`,
        )
        .join(''),
  ).join('');
  const different = GROUPS.reduce((n, g) => n + g.rows.filter((r) => r.free !== r.pro).length, 0);
  const total = GROUPS.reduce((n, g) => n + g.rows.length, 0);
  return (
    '<div class="bzs-unlock">' +
    '<div class="bzs-unlock-hd"><h2>高级版功能</h2><p>两版功能完全一样，只差数量上限。</p></div>' +
    '<div class="bzs-plan-head"><span>功能</span><i class="c">基础版<small>免费不限时</small></i><i class="c pro">高级版<small>一次买断</small></i></div>' +
    `<div class="bzs-plan">${body}</div>` +
    `<div class="bzs-plan-row is-total"><span>合计 ${total} 项，${different} 项数量不同</span>${cell('', false)}${cell('', true)}</div>` +
    `<div class="bzs-unlock-foot">${
      paid ? '' : '<button class="bzs-btn pri" type="button" data-act="unlockbuy">去购买</button>'
    }<button class="bzs-btn" type="button" data-act="unlockgroup">交流群 ${esc(GROUP_ID)}</button></div>` +
    '</div>'
  );
}

/** 打开高级功能弹窗（设置页授权组入口） */
export function openReviewUnlockDialog(): void {
  const paid = getLicenseState().paid;
  const modal = uiModal({
    content: unlockDialogHtml(paid),
    className: 'bzs-unlock-dialog',
    title: '高级版功能',
    maxWidth: 720,
  });
  modal.popup.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'unlockbuy') openExternalUrl(PURCHASE_URL);
    else if (act === 'unlockgroup') openExternalUrl(`https://qm.qq.com/q/${GROUP_ID}`);
  });
}
