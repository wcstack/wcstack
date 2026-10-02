/**
 * forContext.ts
 *
 * HTML 内の指定位置が <template data-wcs="for:"> の内側にあるかを判定する。
 */

import { splitBindTexts } from '@wcstack/state/parser';
import { indexOfOutsideQuotes } from '../core/parser/quoteAware.js';
import { asciiLowerCase } from '../language/htmlParse.js';

/**
 * 指定オフセットが <template data-wcs="for: ..."> の内側にあるかを判定する。
 *
 * @param html - HTML 全文
 * @param offset - チェックする位置（0始まり）
 * @param bindAttrName - バインド属性名（デフォルト: "data-wcs"）
 * @returns for テンプレート内であれば true
 */
export function isInsideForTemplate(html: string, offset: number, bindAttrName: string = 'data-wcs'): boolean {
  // <template data-wcs="for: ..."> の開始タグと </template> を追跡
  // ネストに対応するためスタックを使用
  const escaped = bindAttrName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const openRegex = new RegExp(
    `<template[^>]*${escaped}\\s*=\\s*["']\\s*for\\s*:`,
    'gi',
  );
  const closeRegex = /<\/template\s*>/gi;

  // 全ての for テンプレート開始位置を収集
  const opens: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = openRegex.exec(html)) !== null) {
    if (match.index >= offset) break;
    opens.push(match.index);
  }

  if (opens.length === 0) return false;

  // 各 for テンプレート開始に対して、対応する </template> を探す
  // スタックベースでネスト対応
  for (const openPos of opens) {
    const depth = getForTemplateDepthAt(html, openPos, offset, bindAttrName);
    if (depth > 0) return true;
  }

  return false;
}

/**
 * 指定オフセットを囲む最も内側の `for` テンプレートのパスを返す。
 * for テンプレート外の場合は null。
 *
 * @example
 * `<template data-wcs="for: users">` 内なら `"users"` を返す。
 * `<template data-wcs="for: .products">` 内（親 for: categories）なら `".products"` を返す。
 */
export function getInnermostForPath(html: string, offset: number, bindAttrName: string = 'data-wcs'): string | null {
  const chain = getEnclosingForPaths(html, offset, bindAttrName);
  return chain.length === 0 ? null : chain[chain.length - 1];
}

/** offset を囲む for テンプレート 1 枚（生 for パス + テンプレート同一性のアンカー）。 */
export interface IEnclosingFor {
  /** for 属性値の生テキスト（`@state` / フィルタが付き得る）。 */
  readonly path: string;
  /** 開始タグ `<template` の開始オフセット。テンプレート実体の同一性キー
   *  （`$1`〜`$9` のようにループ実体で参照先が決まる要素のスコープ判定に使う）。 */
  readonly anchor: number;
}

/**
 * 指定オフセットを囲む**全ての** for テンプレートの生 for パス文字列を、
 * 外側 → 内側の順で返す。囲まれていなければ空配列。
 *
 * ランタイム（collectStructuralFragments）はネストした for を再帰的に合成する
 * （内側テンプレート自身の for 属性を外側の for パスで先に展開してから降りる）
 * ため、相対 for（`for: .products`）の静的解決には外側チェーン全体が要る。
 * 値は属性値の生テキスト — `@state` やフィルタが付き得るので、パス部分が
 * 必要な消費側は正本パーサ（statePathName）を通すこと。
 */
export function getEnclosingForPaths(html: string, offset: number, bindAttrName: string = 'data-wcs'): string[] {
  return getEnclosingFors(html, offset, bindAttrName).map((entry) => entry.path);
}

/**
 * getEnclosingForPaths のアンカー付き版。外側 → 内側の順。
 * `$N` の参照先はチェーン N 枚目（外側から）のテンプレート**実体**で決まるため、
 * パス文字列でなくアンカーで同一性を判定する消費者向け。
 */
export function getEnclosingFors(html: string, offset: number, bindAttrName: string = 'data-wcs'): IEnclosingFor[] {
  const escaped = bindAttrName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const openRegex = new RegExp(
    `<template[^>]*${escaped}\\s*=\\s*["']\\s*for\\s*:\\s*([^"']+?)\\s*["']`,
    'gi',
  );

  // 開始位置の昇順で走査するので、囲んでいるものはそのまま外側 → 内側の順に並ぶ
  const enclosing: IEnclosingFor[] = [];
  let match: RegExpExecArray | null;
  while ((match = openRegex.exec(html)) !== null) {
    if (match.index >= offset) break;

    // このテンプレートが offset を囲んでいるか確認
    const tagEnd = html.indexOf('>', match.index);
    if (tagEnd === -1 || tagEnd >= offset) continue;

    const depth = getForTemplateDepthAt(html, match.index, offset, bindAttrName);
    if (depth > 0) {
      enclosing.push({ path: match[1].trim(), anchor: match.index });
    }
  }

  return enclosing;
}

/** パスに含まれるワイルドカードセグメント（`*`）の本数。 */
export function countWildcardSegments(path: string): number {
  let count = 0;
  for (const segment of path.split('.')) {
    if (segment === '*') count++;
  }
  return count;
}

/** for 属性の生テキストから state パス部分だけを取り出す（`@state` / フィルタを落とす）。 */
function forPathOf(raw: string): string {
  let path = raw.trim();
  // 区切りは引用符の外だけ（拡張内の区切り走査は例外なく quoteAware 経由にする）。
  // `for` の右辺のパスに引用符は現れないので現状の挙動は変わらないが、素の走査を
  // 残すと同型の欠陥が入り込む余地になる
  const pipe = indexOfOutsideQuotes(path, '|');
  if (pipe !== -1) path = path.slice(0, pipe).trim();
  const at = path.indexOf('@');
  if (at !== -1) path = path.slice(0, at).trim();
  return path;
}

/**
 * 囲む for が描くリストのパス（getResolvedForListPath の結果）が与える段数 ＝ そのスコープで
 * **ワイルドカードを解決できる段数**。
 *
 * 段数は「囲む for の枚数」ではない。for のパス自身が階数を持つ入れ子
 * （`for: matrix` の中の `for: matrix.*`）があるため、合成したリストのパスの `*` の本数 + 1
 * （ループ自身が 1 段増やす）が答え。
 */
export function rankOfForList(resolvedListPath: string): number {
  return countWildcardSegments(resolvedListPath) + 1;
}

/**
 * offset を囲む最も内側の for テンプレートが描くリストのパスを、相対 for を外側から合成した形で返す
 * （`for: groups` の中の `for: .items` → `groups.*.items`）。囲まれていなければ null。
 * 合成はランタイム（structural/expandShorthandPaths.ts）と同じ: 相対 for は外側の行パス `<prev>.*` に
 * 連結し、絶対 for はそのまま置き換える。
 */
export function getResolvedForListPath(html: string, offset: number, bindAttrName: string = 'data-wcs'): string | null {
  const chain = getEnclosingForPaths(html, offset, bindAttrName);
  if (chain.length === 0) return null;
  let resolved = '';
  for (const raw of chain) {
    const path = forPathOf(raw);
    if (path === '.') {
      resolved = `${resolved}.*`;
    } else if (path.startsWith('.')) {
      resolved = `${resolved}.*.${path.slice(1)}`;
    } else {
      resolved = path;
    }
  }
  return resolved;
}

/**
 * 段ごとのリスト（外側 → 内側）。段 k（1 始まり）の `*` が回るリスト ＝ 囲む for のリスト。
 * 最も内側の段は for のリストそのもの、それより外の段はそのパスの k 番目の `*` の手前
 * （`groups.*.items` → [`groups`, `groups.*.items`]。ランタイムの `Pattern.lists`）。
 */
export function listsPerLevel(resolvedListPath: string): string[] {
  return [...wildcardPrefixes(resolvedListPath), resolvedListPath];
}

/** パスの各 `*` の手前（その `*` が回るリスト）を外側から順に返す（`a.*.b.*.c` → [`a`, `a.*.b`]）。 */
export function wildcardPrefixes(path: string): string[] {
  const segments = path.split('.');
  const out: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    if (segments[i] === '*') out.push(segments.slice(0, i).join('.'));
  }
  return out;
}

/**
 * 束縛のパスの各 `*` が、その段で囲む for のリストの行か（4.0 の F32・`[wcs/wildcard-rank]` #1403）。
 * 最初に食い違った段の「パスの `*` が回るリスト」と「その段の for のリスト」を返す。食い違いが無い・
 * 判定できない（囲む for が無い・段数が足りない — それは #1401 の担当）なら null。
 */
export function findOtherListWildcard(path: string, resolvedListPath: string): { over: string; loop: string } | null {
  if (resolvedListPath.startsWith('.')) return null;
  const loops = listsPerLevel(resolvedListPath);
  const overs = wildcardPrefixes(path);
  if (overs.length > loops.length) return null;
  for (let k = 0; k < overs.length; k++) {
    if (overs[k] !== loops[k]) return { over: overs[k], loop: loops[k] };
  }
  return null;
}

/** 子を持たない要素（終了タグが無い）。 */
const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);
/** 中身が文字になる要素（中のタグをタグとして読まない）。 */
const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'textarea', 'title']);
/** 要素の中身を値で置き換える束縛（`setsContent` — ランタイムはその要素の子を束縛として読まない）。 */
const CONTENT_PROPERTIES = new Set(['textContent', 'innerText', 'innerHTML', 'text', 'html', 'outerHTML', 'outerText']);
const STRUCTURAL_DIRECTIVES = new Set(['for', 'if', 'elseif', 'else']);
/** `<p>` を暗に閉じる開始タグ（HTML の「button scope にある p を閉じる」— 直前に開いた `<p>` だけを見る近似）。 */
const P_CLOSERS = new Set([
  'address', 'article', 'aside', 'blockquote', 'details', 'dialog', 'div', 'dl', 'fieldset', 'figcaption', 'figure',
  'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'main', 'menu', 'nav', 'ol', 'p',
  'pre', 'section', 'table', 'ul',
]);
/** 開始タグが暗に閉じる、開いたままの要素（終了タグの省略。`<li>…<li>`・`<td>…<td>` など）。 */
const IMPLIED_CLOSE: Record<string, ReadonlySet<string>> = {
  li: new Set(['p', 'li']),
  dt: new Set(['p', 'dt', 'dd']),
  dd: new Set(['p', 'dt', 'dd']),
  option: new Set(['option']),
  optgroup: new Set(['option', 'optgroup']),
  tr: new Set(['td', 'th', 'tr']),
  td: new Set(['td', 'th']),
  th: new Set(['td', 'th']),
  thead: new Set(['td', 'th', 'tr', 'thead', 'tbody', 'tfoot']),
  tbody: new Set(['td', 'th', 'tr', 'thead', 'tbody', 'tfoot']),
  tfoot: new Set(['td', 'th', 'tr', 'thead', 'tbody', 'tfoot']),
};

/** 開始タグの属性テキストから、束縛属性の値を取り出す（無ければ null）。 */
function bindAttrValueOf(attrs: string, bindAttrName: string): string | null {
  const escaped = bindAttrName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 引用符の無い値（`data-wcs=for:items`）も HTML では属性値（空白・`>` まで）
  const match = new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`, 'i').exec(attrs);
  return match === null ? null : match[1] ?? match[2] ?? match[3];
}

/** 束縛属性の値の各式の左辺の名前（修飾子・入力フィルタ・明示のプロパティ形の `.` を外した形）。 */
function propertyNamesOf(value: string): string[] {
  // 空の式（末尾の `;` — `for: items;`）はランタイムと同じく数えない
  return splitBindTexts(value).filter((expr) => expr.trim().length > 0).map((expr) => {
    const colon = indexOfOutsideQuotes(expr, ':');
    const left = (colon === -1 ? expr : expr.slice(0, colon)).trim();
    const name = left.split(/[|#]/)[0].trim();
    return name.startsWith('.') ? name.slice(1) : name;
  });
}

/** 開始タグ `name` が暗に閉じる、開いたままの要素（直前に開いたもの）を積み上げから外す。 */
function closeImplied(stack: { name: string }[], name: string): void {
  const implied = IMPLIED_CLOSE[name];
  if (implied !== undefined) {
    while (stack.length > 0 && implied.has(stack[stack.length - 1].name)) stack.pop();
  } else if (P_CLOSERS.has(name) && stack.length > 0 && stack[stack.length - 1].name === 'p') {
    stack.pop();
  }
}

/**
 * offset（要素の開始タグの中 — 束縛属性の値の位置）の要素が、**行か枝の計画の中で**束縛として読まれるか。
 * 要素を置き換える束縛（`outerHTML:` / `outerText:`）は、そこでは 4.0 が初期化で拒む（#203 — 行や枝は
 * ノードを位置で持つ）。ランタイムの走査（`dom/plan.ts` の walkBindings）と同じく、次のときは読まれない:
 *   - 構造ディレクティブの無い `<template>` の中（中身は inert のまま）
 *   - 中身を置き換える束縛（`textContent:` / `innerHTML:` / `innerText:` / `text:` / `html:` /
 *     `outerHTML:` / `outerText:`）を持つ要素の子孫、`<noscript>` / `<iframe>` の中
 * 文書の頭から offset までのタグを 1 回だけ走査して、開いている要素の積み上げで判定する（`outerHTML:` を
 * 書いたときだけ呼ばれる）。HTML のパーサに合わせて、終了タグの省略（`<li>…<li>`・`<p>…<div>`・表の行とセル
 * など）は開始タグで暗に閉じ、`/>` は void 要素と svg / math の中だけで閉じたとみなす（HTML では void でない
 * 要素の `/>` は無視される）。offset が `<textarea>` / `<title>` / `<script>` / `<style>` の中なら束縛ではない。
 * 既知の限界: 暗に閉じる規則は「直前に開いた要素」だけを見る近似（HTML の scope の規則のすべてではない）。
 */
export function isRowOrBranchContent(html: string, offset: number, bindAttrName: string = 'data-wcs'): boolean {
  const tag = /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  const stack: { name: string; structural: boolean; blocks: boolean }[] = [];
  let lower: string | null = null;
  let match: RegExpExecArray | null;
  while ((match = tag.exec(html)) !== null) {
    const end = match.index + match[0].length;
    // 要素自身の開始タグ（offset を含む）に来たら終わり — 積み上がっているのが祖先。ただしその要素自身も
    // 終了タグの省略で前の要素を閉じる（`<p …>t<div outerHTML>`・`<option>…<option outerHTML>`）ので、
    // 抜ける前に閉じてから判定する
    if (end > offset) {
      if (match[2] !== undefined && match[1] !== '/' && match.index < offset) closeImplied(stack, match[2].toLowerCase());
      break;
    }
    if (match[2] === undefined) continue; // コメント
    const name = match[2].toLowerCase();
    if (match[1] === '/') {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].name === name) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const attrs = match[3];
    // 終了タグの省略: この開始タグが暗に閉じる、開いたままの要素を外す
    closeImplied(stack, name);
    const foreign = name === 'svg' || name === 'math' || stack.some((e) => e.name === 'svg' || e.name === 'math');
    if (VOID_ELEMENTS.has(name) || (foreign && /\/\s*$/.test(attrs))) continue;
    if (RAW_TEXT_ELEMENTS.has(name)) {
      const close = (lower ??= asciiLowerCase(html)).indexOf(`</${name}`, end);
      // offset が中身の中: ブラウザでは文字であって束縛ではない
      if (close === -1 || close > offset) return false;
      tag.lastIndex = close;
      continue;
    }
    const value = bindAttrValueOf(attrs, bindAttrName);
    const names = value === null ? [] : propertyNamesOf(value);
    // 構造ディレクティブは単独の束縛（`for: items`）。修飾子付き（`for#x:`）は正本パーサが拒む形なので数えない
    const structural = name === 'template' && names.length === 1 && STRUCTURAL_DIRECTIVES.has(names[0])
      && !value!.slice(0, Math.max(0, indexOfOutsideQuotes(value!, ':'))).includes('#');
    const blocks = (name === 'template' && !structural)
      || name === 'noscript' || name === 'iframe'
      || (name !== 'template' && names.some((n) => CONTENT_PROPERTIES.has(n)));
    stack.push({ name, structural, blocks });
  }
  return stack.some((e) => e.structural) && !stack.some((e) => e.blocks);
}

/**
 * 指定位置での for テンプレートのネスト深度を計算する。
 * openPos から offset の間で template タグのネストを追跡。
 */
function getForTemplateDepthAt(
  html: string,
  openPos: number,
  offset: number,
  bindAttrName: string,
): number {
  // openPos の <template> タグの終了位置 ('>') を探す
  const tagEnd = html.indexOf('>', openPos);
  if (tagEnd === -1 || tagEnd >= offset) return 0;

  let depth = 1;
  let pos = tagEnd + 1;

  const templateOpenRegex = /<template[\s>]/gi;
  const templateCloseRegex = /<\/template\s*>/gi;

  while (pos < offset && depth > 0) {
    templateOpenRegex.lastIndex = pos;
    templateCloseRegex.lastIndex = pos;

    const nextOpen = templateOpenRegex.exec(html);
    const nextClose = templateCloseRegex.exec(html);

    const openIdx = nextOpen && nextOpen.index < offset ? nextOpen.index : Infinity;
    const closeIdx = nextClose && nextClose.index < offset ? nextClose.index : Infinity;

    if (openIdx === Infinity && closeIdx === Infinity) break;

    if (openIdx < closeIdx) {
      depth++;
      pos = openIdx + 1;
    } else {
      depth--;
      if (depth === 0 && closeIdx < offset) {
        // この for テンプレートは offset の前に閉じた
        return 0;
      }
      pos = closeIdx + (nextClose ? nextClose[0].length : 1);
    }
  }

  return depth;
}
