import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (rel: string): string => readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8');

/** 截出某个函数体（从签名到下一个顶层 export / 文件尾），只测这一段 */
function section(src: string, start: string): string {
  const i = src.indexOf(start);
  if (i < 0) return '';
  const rest = src.slice(i + start.length);
  const next = rest.search(/\nexport (async )?function |\nclass |\n\/\*\* =/);
  return next < 0 ? rest : rest.slice(0, next);
}

/**
 * 「加入复习」只有一个流程（2026-11-21 用户拍板）。
 *
 * 这条链路最容易被后续改动悄悄改回「某个入口直接写库」——以前有七套写法，
 * 用户原话是「各自调用各自的面板，非常的奇怪」。这里用源码接线钉死：
 * 任何入口都必须经过 add-flow.ts，任何入口都不许自己 addItem / addNotes。
 */
const index = read('review/index.ts');
const watch = read('review/watch.ts');
const ui = read('review/ui.ts');
const app = read('review/app.ts');
const schema = read('review/settings-schema.ts');
const wizard = read('review/card-wizard.ts');
const flow = read('review/add-flow.ts');

describe('加入复习 · 只有一个入口', () => {
  it('命令「把当前笔记加入复习」走统一流程', () => {
    expect(section(index, 'export async function reviewAddCurrent')).toContain('openAddToReviewFlow');
  });

  it('文件树右键单篇与文件夹都走统一流程', () => {
    const body = section(index, 'export async function reviewAddPath');
    expect(body).toContain("kind: 'folder'");
    expect(body).toContain("kind: 'note'");
    expect(body).not.toContain('addNotes(');
  });

  it('编辑区选段也走统一流程，不再直接开制卡窗', () => {
    const body = section(index, 'export async function reviewAddSelection');
    expect(body).toContain('openAddToReviewFlow');
    expect(body).not.toContain('openCardWizardForAdd');
  });

  it('面板空态按钮走统一流程', () => {
    const body = section(ui, 'private async addCurrentNote');
    expect(body).toContain('openAddToReviewFlow');
    expect(body).not.toContain('addCurrentToReview');
  });

  it('监听新建笔记也走统一流程，不直接 addItem', () => {
    const body = section(watch, 'async onVaultCreate');
    expect(body).toContain('openAddToReviewFlow');
    expect(body).not.toContain('addItem(');
  });

  it('监听文件夹批量收编也走统一流程，不直接 addItems', () => {
    const body = section(watch, 'async confirmBatchAddForFolder');
    expect(body).toContain('openAddToReviewFlow');
    expect(body).not.toContain('addItems(');
  });

  it('app.ts 不再保留第二套「直接写库」的方法', () => {
    expect(app).not.toContain('addCurrentToReview');
  });
});

describe('加入复习 · 跳过界面只有一个理由', () => {
  it('静默分支只认设置里的「新卡默认方式」', () => {
    expect(flow).toContain('silentModeOf(defaultCardMethod(');
    expect(flow).toContain('silentAdd');
  });

  it('静默入库也走卡片入库与同一句结果话术，不是另一种通知', () => {
    expect(flow).toContain('api.addCards(cards)');
    expect(flow).toContain('addSummaryText(res');
  });

  it('旧的「新笔记加入提醒」开关已移除（自动加入也走流程，弹不弹由默认方式决定）', () => {
    expect(schema).not.toContain('reviewAutoAddNotice');
    expect(watch).not.toContain('reviewAutoAddNotice');
  });
});

describe('加入复习 · 结果话术只有一处', () => {
  it('制卡窗确认入库用统一话术', () => {
    expect(wizard).toContain('addSummaryText(res');
  });
});
