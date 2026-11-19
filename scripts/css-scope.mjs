// scripts/css-scope.mjs — 把样式源收进插件自己的容器，避免影响宿主与其它插件
//
// Obsidian 把所有插件的 styles.css 注入同一张样式表，选择器写裸了就是全局污染：
// 裸 `button { padding: 0 }` 会把整个 Obsidian 界面（含其它插件）的按钮抹平。
//
// 本模块在构建期做一层「作用域化」：
//   1. 每条有视觉效果的选择器前面加 [data-bzrv]（自有 UI 根节点都挂这个属性）；
//   2. 只声明 --bzrv-* 变量的块（:root / .theme-dark / .theme-light）原样保留——
//      变量名已带私有前缀，宿主读不到，不构成污染；
//   3. @keyframes / @font-face 内部不改名不改选择器；
//   4. 已经写成 [data-bzrv] … 或 #bzrv-… 的选择器跳过，不重复套。
//
// 产物仍是单文件 styles.css，由 build-css.mjs 在拼接后调用。

const ANCHOR = '[data-bzrv]';

/**
 * 作用域后缀：挂在选择器**最后一段**上。
 *
 * 为什么不是 `[data-bzrv] .foo` 这种祖先前缀：弹层根节点（#bzrv-popup 等）自己
 * 就是 `[data-bzrv]`，它是 body 的直接子元素、没有带锚点的祖先。祖先前缀会让
 * 「根元素自己的类」全部失效——真机上表现为面板背景透明、整块样式掉光。
 *
 * `:is([data-bzrv], [data-bzrv] *)` 表示「自己带锚点，或某个祖先带锚点」，
 * 两种情况都覆盖，且规则条数不变。
 */
const SCOPE_SUFFIX = ':is([data-bzrv], [data-bzrv] *)';

/** 找选择器最后一段的起点（顶层空格 / > / + / ~ 之后） */
function lastCompoundStart(sel) {
  let depth = 0;
  let cut = -1;
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (depth === 0 && (c === ' ' || c === '>' || c === '+' || c === '~')) cut = i;
  }
  return cut;
}

/** 找最后一段里第一个伪类的位置（跳过属性选择器与括号内部） */
function firstPseudoIndex(tail) {
  let depth = 0;
  for (let i = 0; i < tail.length; i++) {
    const c = tail[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ':' && depth === 0) return i;
  }
  return -1;
}

/** 给一条选择器加上容器后缀（放在最后一段、伪类之前） */
function applyScope(sel) {
  const cut = lastCompoundStart(sel);
  const head = sel.slice(0, cut + 1);
  const tail = sel.slice(cut + 1);
  if (!tail) return `${sel}${SCOPE_SUFFIX}`;
  const p = firstPseudoIndex(tail);
  const scoped = p < 0 ? `${tail}${SCOPE_SUFFIX}` : `${tail.slice(0, p)}${SCOPE_SUFFIX}${tail.slice(p)}`;
  return head + scoped;
}

/** 跳过字符串字面量（"…" 或 '…'，含转义），返回新的索引 */
function skipString(css, i) {
  const q = css[i];
  i++;
  while (i < css.length) {
    const c = css[i];
    if (c === '\\') { i += 2; continue; }
    if (c === q) return i + 1;
    i++;
  }
  return i;
}

/** 跳过注释，返回注释结束后的索引（不是注释起点则原样返回） */
function skipComment(css, i) {
  if (css[i] === '/' && css[i + 1] === '*') {
    const end = css.indexOf('*/', i + 2);
    return end === -1 ? css.length : end + 2;
  }
  return i;
}

/** 去掉注释后判断块内是否只有 --xxx: … 声明 */
function isVarOnly(body) {
  const stripped = body.replace(/\/\*[\s\S]*?\*\//g, '');
  const decls = stripped.split(';').map((d) => d.trim()).filter(Boolean);
  if (!decls.length) return false;
  return decls.every((d) => /^--[A-Za-z0-9_-]+\s*:/.test(d));
}

/** 按顶层逗号切选择器（跳过括号与字符串里的逗号） */
function splitSelectors(prelude) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < prelude.length; i++) {
    const c = prelude[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === '\\') { cur += c + (prelude[i + 1] ?? ''); i++; continue; }
    if (c === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

/** 给单条选择器加容器作用域；不需要加的返回 null（表示原样保留） */
function scopeOne(sel) {
  const s = sel.trim();
  if (!s) return null;
  if (s.includes(ANCHOR)) return null;            // 已经自己管好了（含 :is 后缀）
  if (/^#bzrv-/.test(s)) return null;             // 自有 ID 根/子树，全局唯一
  if (/^(from|to|\d+%)$/.test(s)) return null;    // keyframes 帧（兜底，正常走不到）
  return applyScope(s);
}

function scopePrelude(prelude) {
  return splitSelectors(prelude)
    .map((p) => {
      const scoped = scopeOne(p);
      if (scoped === null) return p;          // 原样，连空白一起
      const lead = /^\s*/.exec(p)[0];
      const trail = /\s*$/.exec(p)[0];
      return `${lead}${scoped}${trail}`;
    })
    .join(',');
}

/**
 * 作用域化一份 CSS。
 * @param {string} css
 * @returns {string}
 */
export function scopeCss(css) {
  const out = [];
  const n = css.length;
  let i = 0;

  while (i < n) {
    // 注释与空白原样收集
    if (css[i] === '/' && css[i + 1] === '*') {
      const end = skipComment(css, i);
      out.push(css.slice(i, end));
      i = end;
      continue;
    }
    if (/\s/.test(css[i])) {
      let j = i;
      while (j < n && /\s/.test(css[j])) j++;
      out.push(css.slice(i, j));
      i = j;
      continue;
    }

    // 读 prelude：到 { ; } 为止
    let j = i;
    while (j < n && css[j] !== '{' && css[j] !== ';' && css[j] !== '}') {
      if (css[j] === '/' && css[j + 1] === '*') { j = skipComment(css, j); continue; }
      if (css[j] === '"' || css[j] === "'") { j = skipString(css, j); continue; }
      j++;
    }

    if (j >= n) { out.push(css.slice(i)); break; }

    if (css[j] === ';' || css[j] === '}') {
      out.push(css.slice(i, j + 1));
      i = j + 1;
      continue;
    }

    // css[j] === '{'：找配对右花括号
    const prelude = css.slice(i, j);
    const bodyStart = j + 1;
    let depth = 1;
    let k = bodyStart;
    while (k < n && depth > 0) {
      if (css[k] === '/' && css[k + 1] === '*') { k = skipComment(css, k); continue; }
      if (css[k] === '"' || css[k] === "'") { k = skipString(css, k); continue; }
      if (css[k] === '{') depth++;
      else if (css[k] === '}') { depth--; if (depth === 0) break; }
      k++;
    }
    const body = css.slice(bodyStart, k);
    i = k + 1;

    const trimmed = prelude.trim();

    if (trimmed.startsWith('@')) {
      const at = trimmed.slice(1).split(/\s/)[0].toLowerCase();
      if (at.includes('keyframes') || at === 'font-face' || at === 'page') {
        out.push(`${prelude}{${body}}`);       // 内部不作用域化
      } else {
        out.push(`${prelude}{${scopeCss(body)}}`); // @media / @supports / @layer
      }
      continue;
    }

    if (isVarOnly(body)) {
      out.push(`${prelude}{${body}}`);          // 纯变量块：私有命名空间，保留全局
      continue;
    }

    out.push(`${scopePrelude(prelude)}{${body}}`);
  }

  return out.join('');
}

/** 校验：产物里不应存在「裸」的元素/类选择器（只允许 [data-bzrv] 与 #bzrv- 开头的规则） */
export function findUnscopedSelectors(css) {
  const bad = [];
  const src = css;
  const n = src.length;
  let i = 0;

  while (i < n) {
    if (src[i] === '/' && src[i + 1] === '*') { i = skipComment(src, i); continue; }
    if (/\s/.test(src[i])) { i++; continue; }

    let j = i;
    while (j < n && src[j] !== '{' && src[j] !== ';' && src[j] !== '}') {
      if (src[j] === '/' && src[j + 1] === '*') { j = skipComment(src, j); continue; }
      if (src[j] === '"' || src[j] === "'") { j = skipString(src, j); continue; }
      j++;
    }
    if (j >= n) break;
    if (src[j] !== '{') { i = j + 1; continue; }

    const prelude = src.slice(i, j);
    let depth = 1;
    let k = j + 1;
    while (k < n && depth > 0) {
      if (src[k] === '/' && src[k + 1] === '*') { k = skipComment(src, k); continue; }
      if (src[k] === '"' || src[k] === "'") { k = skipString(src, k); continue; }
      if (src[k] === '{') depth++;
      else if (src[k] === '}') { depth--; if (depth === 0) break; }
      k++;
    }
    const body = src.slice(j + 1, k);
    const trimmed = prelude.trim();

    if (trimmed.startsWith('@')) {
      const at = trimmed.slice(1).split(/\s/)[0].toLowerCase();
      if (!at.includes('keyframes') && at !== 'font-face' && at !== 'page') {
        bad.push(...findUnscopedSelectors(body)); // @media / @supports 递归
      }
      i = k + 1;
      continue;
    }

    if (!isVarOnly(body)) {
      for (const sel of splitSelectors(prelude)) {
        const s = sel.trim();
        if (!s) continue;
        if (s.includes(ANCHOR) || /^#bzrv-/.test(s)) continue;
        bad.push(s);
      }
    }
    i = k + 1;
  }

  return bad;
}
