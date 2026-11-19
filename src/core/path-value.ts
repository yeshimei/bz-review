/**
 * path 行的值换算与变更判定（纯函数、零 obsidian 运行期依赖，单测直接跑）。
 *
 * 由 core/settings-schema.ts 的 path 行复用：写盘口把清单换算成绑定值，
 * 异步否决回退时判断最终清单是否改写了已落盘值（不同则回写 binding + 落盘）。
 * 抽出来是为了让「取消迁移后 data.json 仍停在新目录」这类回退 bug 可被单测覆盖。
 */

/** 把最终清单换算成绑定值：single 取首项并去首尾斜杠，multi 原样数组副本。 */
export function pathListToValue(multi: boolean, list: readonly string[]): string | string[] {
  return multi ? [...list] : String(list[0] ?? '').trim().replace(/^\/+|\/+$/g, '');
}

/** 最终值是否与已写入值不同（不同即「否决/改写」，必须把绑定值与落盘一起回退）。 */
export function pathValueChanged(multi: boolean, written: string | string[], final: string | string[]): boolean {
  if (multi) {
    const a = Array.isArray(written) ? written : [];
    const b = Array.isArray(final) ? final : [];
    return a.length !== b.length || a.some((v, i) => v !== b[i]);
  }
  return String(written ?? '') !== String(final ?? '');
}
