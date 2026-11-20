# Anki 导入媒体与遮挡解锁 —— 真机验证报告

日期：2026-11-21。验证方式：真实 Obsidian 进程（`obsidian-visual-test`），桌面 1024×800 与移动端 390×844@3x 各跑一遍。插件从最新 master `fad6fb3` 分叉的 worktree 构建，部署到测试库 `E:/Obsidian/bz review` 后验证。

## 这次解决什么

上一批 Anki 导入只认「笔记纯文本」：图片/音频只留 `[图片：文件名]` 占位、图片遮挡卡整行跳过。根因是 Anki 的纯文本导出**只带媒体文件名、不带文件本身**（Anki 官方文档确认：只有整包 .apkg/.colpkg 才含媒体）。本次按用户采纳的方案解开这两条限制——不碰 .apkg，只把纯文本链路补完整：

1. 导入解析时把每张卡引用的媒体文件名收集下来，遮挡卡不再跳过。
2. 若这份导出引用了媒体，弹窗询问是否补选文件；多选后按文件名配对、落进库内 `anki-media` 目录、撞名自动改名。
3. 配上媒体的卡指向真实库内路径、转成媒体卡；遮挡卡按「图片 + 文字」导入，遮挡区域留给用户后续在卡片管理器补。
4. 预览弹窗把「进多少/跳过什么/媒体配上几处缺几处/遮挡几张/改名几个」摊开，确认后才写盘。

## 验证项与截图

### 1. 补选媒体确认弹窗（桌面）
解析到 1 个媒体引用 `diagram.png` 后弹出询问，说明「纯文本不带文件、可多选补进来、跳过则保留占位」，两个按钮清晰。

![补选媒体确认弹窗](../../obs-test-runs/runs/bz-ankimedia/shots/04-03-media-prompt.png)

### 2. 补选后预览 —— 媒体配对结果（桌面）
选入同名图片后，预览显示「媒体引用 1 处、1 个文件：已配上 1 处，缺 0 处」。

![媒体配对预览](../../obs-test-runs/runs/bz-ankimedia/shots/06-06-preview.png)

### 3. 遮挡卡预览 —— 计数与撞名改名（桌面）
导入 Image Occlusion 笔记：预览显示「遮挡 1」「图片遮挡卡 1 张：按图片 + 文字导入，遮挡区域待你手动补」「1 个媒体文件撞名，已自动改名保存」。

![遮挡卡与撞名预览](../../obs-test-runs/runs/bz-ankimedia/shots/09-09-occl-preview.png)

### 4. 落库数据核对（真机 eval）
确认导入后的 `review.json`：
- 媒体卡：`mode: media`，`media.images = [CONFIG/REVIEW/anki-media/diagram.png]`；
- 遮挡卡：`mode: occlusion`，`occlusion.image = CONFIG/REVIEW/anki-media/diagram-1.png`（撞名已改名）、`regions: []`（待补），正文含答案文字；
- 媒体目录里 `diagram.png` 与 `diagram-1.png` 两份都在，原文件未被覆盖；
- 两个路径都能被 Obsidian 解析成 `app://` 资源 URL，复习界面可直接显示。

（以上为 eval 读取的真实落库值，截图见第 2、3 项的预览与下方复习面板。）

### 5. 复习面板（桌面）
两张卡都进了复习队列，面板正常渲染，无报错。

![复习面板](../../obs-test-runs/runs/bz-ankimedia/shots/11-11-review-panel.png)

### 6. 补选媒体确认弹窗（移动端 390×844@3x）
切移动端重跑：文案完整、按钮够大、无横向溢出、无底部遮挡。

![移动端补选弹窗](../../obs-test-runs/runs/bz-ankimedia/shots/16-16-mobile-prompt2.png)

## 单测与门禁

- 新增 `tests/anki-media.test.ts`（7 项）：文件名识别、按名配对、撞名 -1/-2 改名、多处引用共用一份、缺文件单列、非法字符替换。
- 更新 `tests/anki-cards.test.ts`：媒体文件名收集、非 HTML 行 `[sound:]` 收集、遮挡卡按图片+文字导入（不再跳过）。
- `npm run typecheck`：通过。
- `npm run lint`：TypeScript 0 error / 0 warning，CSS 干净，悬停气泡属性检查通过。
- `npm test`：618 通过；2 个失败为 **master 基线自带**的 `tests/overdue-round-gate.test.ts`（「开始本轮」门控），已在主仓基线复现确认，与本次改动无关，未纳入本次修复。

## 已知边界（照实说）

- 仍只认 Anki「笔记纯文本」导出；`.apkg` / `.colpkg` 不支持（需回 Anki 重导出，这是采纳方案里明确不做的）。
- 遮挡卡的遮罩区域无法从纯文本还原（Anki 用私有 SVG 坐标），按「图片 + 文字」导入后需在卡片管理器里手动补区域。
- 补选媒体按**文件名**配对；Anki 若导出时改过媒体文件名、和用户手上的文件对不上，会列进「缺 N 处」保留占位文字。
- 媒体存库内 `anki-media` 目录、跟着数据目录走；缺文件的卡可重新导入一次再补选（同 key 已存在的卡会被跳过，届时是先删旧卡再导，或手工在卡片管理器补路径）。

## 改动文件

- `src/review/anki-cards.ts`：解析层收集媒体文件名、遮挡卡改为导入而非跳过、统计字段。
- `src/review/anki-media.ts`（新）：纯函数配对/撞名改名/路径规划。
- `src/review/anki-import.ts`：补选媒体 → 配对落盘 → 改写卡片 → 预览确认的完整链路。
- `src/review/settings-schema.ts`：导入按钮说明补上媒体与遮挡的新行为。
- `tests/anki-media.test.ts`（新）、`tests/anki-cards.test.ts`：单测。
