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

  it('面板空态只留三颗按钮，当前笔记入口已移除', () => {
    /* 2026-11-21 用户要求：空态去掉「加入复习」，只保留看视频 / Anki / 阅读器 */
    expect(ui).toContain('empty-anki-import');
    expect(ui).toContain('empty-reader-add');
    expect(ui).toContain('watch-video');
    expect(ui).not.toContain('empty-add-current');
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

describe('加入复习 · 任何设置都不许绕过确认页', () => {
  it('「新卡默认方式」只跳过选方式，不许自己写库（2026-11-21 用户纠正）', () => {
    /* 曾经的错法：预设方式 → silentAdd 直接 addCards，AI 内容不给人看 */
    expect(flow).not.toContain('silentAdd');
    expect(flow).not.toContain('silentModeOf');
    /* 静默分支会自己构造卡片输入（ReviewCardInput）；交给制卡窗的只有回调 */
    expect(flow).not.toContain('ReviewCardInput');
    expect(flow).toContain('openCardWizard(');
  });

  it('预设方式在制卡窗里只跳过「选方式」，照样生成题面停在确认页', () => {
    expect(wizard).toContain('this.presetMode = this.mode');
    expect(wizard).toContain('void this.generateAll()');
    expect(wizard).toContain('presetModeNote(');
    /* 文案住语言包：源码断言 key，中文原文在 zh.ts。 */
    expect(read('review/card-wizard-model.ts')).toContain("tr('cwm.oneDefault'");
    expect(read('i18n/zh.ts')).toContain('已按设置里「新卡默认方式」');
  });

  it('纯逻辑层不再提供「静默判定」这种绕过口子', () => {
    expect(read('review/add-flow-model.ts')).not.toContain('silentModeOf');
  });

  it('旧的「新笔记加入提醒」开关已移除（自动加入也走流程，跳不跳方式由默认方式决定）', () => {
    expect(schema).not.toContain('reviewAutoAddNotice');
    expect(watch).not.toContain('reviewAutoAddNotice');
  });
});

describe('加入复习 · 结果话术只有一处', () => {
  it('制卡窗确认入库用统一话术', () => {
    expect(wizard).toContain('addSummaryText(res');
  });
});
