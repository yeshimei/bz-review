/**
 * 开机直达弹窗（开发工作流，ADR-0276）。
 *
 * 测试库里放一个 `<数据目录>/debug-open.json`（内容 `{"command":"review-open"}`），
 * 插件启动 layout-ready 后自动执行该命令——改某个弹窗/面板时重启即见，不用翻菜单。
 * 文件不存在 / JSON 坏 / 命令不存在：一律静默跳过（生产库里没人会放这个文件，
 * 零行为差；解析失败也只在 console 留一行，不弹通知不吵用户）。
 *
 * 这是纯开发辅助：不算验证（AGENTS.md 门禁口径不变），也不进设置面板。
 */
import type { App } from 'obsidian';

/** vault.adapter 的最小形状（只读这两个方法，老宿主可能没有） */
interface DebugOpenAdapter {
  exists?: (p: string) => Promise<boolean>;
  read?: (p: string) => Promise<string>;
}

/** 读 debug-open.json 并执行其中的命令；任何一步走不通都静默。 */
export function devAutoOpen(app: App, storageDir: string): void {
  try {
    const adapter = (app.vault as { adapter?: DebugOpenAdapter }).adapter;
    // 不提取 .bind()：bind 在可选链上会把返回类型退成 any，改为 call 保留方法签名与 this
    const read = adapter?.read;
    if (!read) return;
    const exists = adapter?.exists;
    const file = `${storageDir.replace(/\/+$/, '')}/debug-open.json`;
    void (async () => {
      try {
        if (exists && !(await exists.call(adapter, file))) return;
        const content: unknown = await read.call(adapter, file);
        const raw = JSON.parse(typeof content === 'string' ? content : '') as { command?: unknown };
        const command = typeof raw.command === 'string' ? raw.command.trim() : '';
        if (!command) return;
        // 稍候一拍：直达的目标面板可能依赖布局/数据初始化
        window.setTimeout(() => {
          try {
            (app as unknown as { commands: { executeCommandById: (id: string) => boolean } }).commands.executeCommandById(command);
          } catch (e) {
            console.warn('[bz] debug-open 执行失败：', command, e);
          }
        }, 600);
      } catch (e) {
        console.warn('[bz] debug-open.json 解析失败：', e);
      }
    })();
  } catch {
    /* 拿不到 adapter 就当没有这回事 */
  }
}
