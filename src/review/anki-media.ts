/* ============================================================
 * bz · Anki 导入的媒体配对（review/anki-media.ts，2026-11-20，纯函数）
 *
 * Anki「笔记纯文本」导出只带媒体**文件名**（<img src="x.png"> / [sound:x.mp3]），
 * 不带文件本身。导入时让用户补选图片/音频，这里按文件名（basename，忽略大小写）
 * 把它们配起来，并给出库内的落盘路径：
 *   · 撞名自动加 -1 / -2 后缀，绝不覆盖已有文件；
 *   · 一个文件被多处引用只落一份、多处共用；
 *   · 没配上的文件名单独列出，交给预览摊给用户看。
 *
 * 不碰 DOM / Obsidian：目标目录、已占用路径都由调用方传进来，方便单测。
 * ============================================================ */

/** 图片 / 音频文件名（判断只用于预览文案与提示，不做内容校验） */
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
const AUDIO_EXT = /\.(mp3|wav|ogg|m4a|aac|flac|webm)$/i;

export function isImageName(name: string): boolean {
  return IMAGE_EXT.test(String(name ?? ''));
}
export function isAudioName(name: string): boolean {
  return AUDIO_EXT.test(String(name ?? ''));
}

/** 去掉路径前缀、统一正斜杠后再取文件名（Anki 可能写 Windows 反斜杠） */
export function mediaBaseName(path: string): string {
  const s = String(path ?? '').replace(/\\/g, '/');
  return s.slice(s.lastIndexOf('/') + 1).trim();
}

/** 库内文件名不能带这些字符，统一替换成下划线 */
function safeName(name: string): string {
  return (
    mediaBaseName(name)
      .split('')
      .map((ch) => (/[\\/:*?"<>]/.test(ch) || ch.charCodeAt(0) < 32 ? '_' : ch))
      .join('') || 'media'
  );
}

/** 拆成「主干 + 扩展名」，加序号时保住扩展名 */
function splitExt(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? { stem: name.slice(0, dot), ext: name.slice(dot) } : { stem: name, ext: '' };
}

export interface AnkiMediaPlanInput {
  /** 解析层收集到的引用文件名（basename，已去重） */
  refs: string[];
  /** 用户补选的文件名（与调用方的 File 数组平行） */
  selectedNames: string[];
  /** 库内已存在的路径（用于撞名避让） */
  occupied: string[];
  /** 落盘目录（vault 相对路径，末尾不带斜杠） */
  dir: string;
}

export interface AnkiMediaWrite {
  /** selectedNames 里的下标，调用方据此取对应的 File 读内容 */
  index: number;
  /** 库内目标路径 */
  target: string;
  /** 这个文件名对应的引用名（给人看） */
  ref: string;
}

export interface AnkiMediaPlan {
  /** 引用名 → 库内路径（配对成功的） */
  matched: Map<string, string>;
  /** 没配上文件的引用名，原样返回给预览 */
  missing: string[];
  /** 实际要写盘的文件（按 index 去重，一个文件只落一份） */
  writes: AnkiMediaWrite[];
  /** 因撞名被改过名字的数量 */
  renamed: number;
}

/**
 * 按文件名配对，产出落盘计划。纯函数：不读盘、不写盘、不碰 DOM。
 */
export function planAnkiMedia(input: AnkiMediaPlanInput): AnkiMediaPlan {
  const dir = String(input.dir ?? '').replace(/\/+$/, '');
  const taken = new Set(input.occupied.map((p) => String(p).toLowerCase()));
  const byLower = new Map<string, number[]>();
  input.selectedNames.forEach((n, i) => {
    const key = mediaBaseName(n).toLowerCase();
    if (!key) return;
    const list = byLower.get(key) ?? [];
    list.push(i);
    byLower.set(key, list);
  });

  /** 每个引用名轮到的候选文件下标（同名多个文件按引用顺序分配，避免都挤到第一个） */
  const cursor = new Map<string, number>();
  /** 已分配过目标的选中文件下标 → 目标路径（同一文件被多处引用时共用一份） */
  const assigned = new Map<number, string>();
  const writes: AnkiMediaWrite[] = [];
  const matched = new Map<string, string>();
  const missing: string[] = [];
  let renamed = 0;

  const allocate = (index: number): string => {
    const used = assigned.get(index);
    if (used) return used;
    const { stem, ext } = splitExt(safeName(input.selectedNames[index] ?? 'media'));
    let candidate = `${dir}/${stem}${ext}`;
    let n = 1;
    let wasRenamed = false;
    while (taken.has(candidate.toLowerCase())) {
      candidate = `${dir}/${stem}-${n}${ext}`;
      n += 1;
      wasRenamed = true;
    }
    if (wasRenamed) renamed += 1;
    taken.add(candidate.toLowerCase());
    assigned.set(index, candidate);
    writes.push({ index, target: candidate, ref: mediaBaseName(input.selectedNames[index] ?? '') });
    return candidate;
  };

  for (const ref of input.refs) {
    const name = mediaBaseName(ref);
    const key = name.toLowerCase();
    const candidates = byLower.get(key) ?? [];
    if (!candidates.length) {
      missing.push(name);
      continue;
    }
    /* 同名文件可能有好几个（不同目录选来的）：按引用顺序轮转，前几个引用各用一份 */
    const pos = cursor.get(key) ?? 0;
    const target = allocate(candidates[pos % candidates.length]);
    cursor.set(key, pos + 1);
    matched.set(name, target);
  }

  return { matched, missing, writes, renamed };
}
