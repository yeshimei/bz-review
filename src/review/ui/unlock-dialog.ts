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
    title: '数量上限 · 唯一差异',
    rows: [
      { label: '复习笔记 + 划线卡合计', free: '20 条', pro: '不限' },
    ],
  },
  {
    title: '加入与复习方式',
    rows: [
      { label: '选中文字加入复习', free: YES, pro: YES },
      { label: '划线一键复习', free: YES, pro: YES },
      { label: '整本书批量加入：按划线 / 重点 / 章节选范围', free: YES, pro: YES },
      { label: '全文回忆', free: YES, pro: YES },
      { label: '抽认卡', free: YES, pro: YES },
      { label: '做题', free: YES, pro: YES },
    ],
  },
  {
    title: '卡片制作',
    rows: [
      { label: '卡片正面可改', free: YES, pro: YES },
      { label: 'AI 重新生成卡片', free: YES, pro: YES },
      { label: '做题删题补题', free: YES, pro: YES },
    ],
  },
  {
    title: '复习与排期',
    rows: [
      { label: '抽认卡复习', free: YES, pro: YES },
      { label: '做题原样考', free: YES, pro: YES },
      { label: 'FSRS 科学排期', free: YES, pro: YES },
      { label: 'FSRS 参数自动拟合', free: YES, pro: YES },
      { label: '按书档案', free: YES, pro: YES },
      { label: '卡片管理器', free: YES, pro: YES },
    ],
  },
  {
    title: '出题玩法',
    rows: [
      { label: '题量与难度自定义', free: YES, pro: YES },
      { label: '多选题', free: YES, pro: YES },
      { label: '乱序出题', free: YES, pro: YES },
    ],
  },
  {
    title: '数据与备份',
    rows: [
      { label: '数据统计', free: YES, pro: YES },
      { label: '快照备份', free: YES, pro: YES },
      { label: '一键回滚', free: YES, pro: YES },
    ],
  },
  {
    title: 'AI 与自动化',
    rows: [
      { label: '18 家 AI 服务商与模型选择', free: YES, pro: YES },
      { label: '本地 TTS 听卡片', free: YES, pro: YES },
      { label: '文件夹监听与自动加入', free: YES, pro: YES },
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
    `<div class="bzs-plan-row is-total"><span>合计 ${total - different} 项功能 · 功能完全一致，仅 ${different} 项数量不同</span>${cell('', false)}${cell('', true)}</div>` +
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
