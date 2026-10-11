/**
 * forContext.ts
 *
 * HTML 内の指定位置が <template data-wcs="for:"> の内側にあるかを判定する。
 */

import { parseBindTextsForElement, splitBindTexts } from '@wcstack/state/parser';
import { WcsDiagnosticCode } from '../core/diagnostics.js';
import { indexOfOutsideQuotes } from '../core/parser/quoteAware.js';
import { asciiLowerCase, extractAttribute, parseAttributeNames, RAW_TEXT_ELEMENTS } from '../language/htmlParse.js';

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

/** How a canonical parser error names its code (`[@wcstack/state] [wcs/binding-syntax] #121 "…"`). */
const BINDING_SYNTAX_MARKER = `[${WcsDiagnosticCode.BindingSyntax}]`;

/**
 * Whether the canonical parser refuses a `for:` binding with `[wcs/binding-syntax]`: an output filter
 * (`for: items|take(2)` — #121), an unclosed quote, an empty filter, a modifier on `for`. bindingSyntaxValidator
 * reports it, and that error is the only diagnostic for it: the runtime refuses the binding as a whole (and with it
 * the template, whose rows never exist), so the lint stacks no checks on the binding or on its rows — as it stacks
 * no existence check on a path the parser refuses with #120. The parser's other refusals (`@state`, `**`) keep
 * their own reporting and are not counted here.
 */
export function isForBindingRefused(bindText: string): boolean {
  try {
    parseBindTextsForElement(bindText);
    return false;
  } catch (e) {
    return (e as Error).message.includes(BINDING_SYNTAX_MARKER);
  }
}

/**
 * The for path a row shorthand at offset expands against (`.name` → `<for path>.*.name`): the innermost enclosing
 * for's raw path, as getInnermostForPath. null outside a for, and inside a for the canonical parser refuses
 * (isForBindingRefused) at any depth: the runtime refuses that template, so its rows never exist, and expanding
 * against the raw text would name `items|take(2).*.name` in a false `wcs/binding-path-missing`. The same single
 * scan of the document as getInnermostForPath.
 */
export function getRowShorthandForPath(html: string, offset: number, bindAttrName: string = 'data-wcs'): string | null {
  const chain = getEnclosingForPaths(html, offset, bindAttrName);
  if (chain.length === 0 || chain.some((raw) => isForBindingRefused(`for: ${raw}`))) return null;
  return chain[chain.length - 1];
}

/** offset を囲む for テンプレート 1 枚（生 for パス + テンプレート同一性のアンカー）。 */
export interface IEnclosingFor {
  /**
   * for 属性値の最初の式の生テキスト（`@state` / フィルタが付き得る）。末尾の空の式
   * （`for: items;` の `;` から後ろ — ランタイムは空の式を数えない）は含まない。
   */
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
      enclosing.push({ path: firstExpressionOf(match[1]), anchor: match.index });
    }
  }

  return enclosing;
}

/**
 * for 属性値（`for:` の後ろ）の最初の式。`for: items;` のように末尾に `;` を書いても構造ディレクティブ
 * （空の式は数えない — 正本パーサの splitBindTexts の後で空を落とす）なので、引用符の外の最初の `;` で切る。
 * 切らないと `items;` が for のリストのパスとして合成され、行の `items.*.name` を別のリストの `*` と
 * 取り違え（`wcs/wildcard-rank` #1403）、省略パス（`.name` → `items;.*.name`）も偽の
 * `wcs/binding-path-missing` になる。
 */
function firstExpressionOf(raw: string): string {
  const semicolon = indexOfOutsideQuotes(raw, ';');
  return (semicolon === -1 ? raw : raw.slice(0, semicolon)).trim();
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

// ------------------------------------------------------------------ 要素の置かれた文脈（1 回の走査）

/** 子を持たない要素（終了タグが無い）。 */
const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);
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

/**
 * 構造ディレクティブの無い `<template>` 1 つ。中に**自前の** `<wcs-state>`（`mount` の無いもの）があるか
 * どうかは、その `<wcs-state>` に来るまで分からないので、走査しながら書き込む。
 */
interface ITemplateScope {
  hasOwnState: boolean;
  /** The `id` attribute (a layout template a `<wcs-layout layout="id">` names? — decided at the end of the scan). */
  readonly id: string | null;
  /** Inside a `<wcs-router>` (a route template: the router inserts its content and hands it to the binder). */
  readonly underRouter: boolean;
}

/** The router element (`<wcs-router>` — the `<template>` in it holds the routes). The router's default tag name. */
const ROUTER_TAG = 'wcs-router';
/** The layout element (`<wcs-layout layout="id">` reads the `<template>` of that id). The router's default tag name. */
const LAYOUT_TAG = 'wcs-layout';

/**
 * Whether the state binds the content of a top-level non-structural `<template>`: a route template (inside
 * `<wcs-router>` — the router hands the content it inserts to the binder) or a layout template a
 * `<wcs-layout layout="id">` names (the light-DOM outlet hands what it places to the binder; a layout with
 * `enable-shadow-root` puts the template into the outlet's shadow root, which the page's state does not bind).
 * Anything else (a `<template id="row-tpl">` that only app code clones, a declarative shadow root) is not bound.
 * Assumes the router's defaults: the tag names `wcs-router` / `wcs-layout` and `enableShadowRoot: false`
 * (`config.tagNames` / `config.enableShadowRoot` are not visible here), and that a `<wcs-layout>` with both
 * `src` and `layout` still names the template (the router reads `src`).
 */
function stateBindsTemplate(scope: ITemplateScope, layoutIds: ReadonlySet<string>): boolean {
  return scope.underRouter || (scope.id !== null && layoutIds.has(scope.id));
}

interface IOpenElement {
  readonly name: string;
  /** 構造ディレクティブ（for / if / elseif / else）を持つ `<template>`。 */
  readonly structural: boolean;
  /** 構造ディレクティブの無い `<template>`（それ以外は null）。 */
  readonly scope: ITemplateScope | null;
  /**
   * この要素の子孫は束縛として読まれない: 中身を置き換える束縛を持つ要素と、別の `<template>` の中に置いた
   * 構造でない `<template>`（行・枝・router の route が中身を差し込んでも、入れ子の template は inert のまま —
   * アプリの JS が複製する雛形 `<template id="row-tpl">` など）。文書の直下の `<template>`（router の route
   * そのもの・コンポーネントの雛形）は塞がない — 差し込まれた先で束縛される。
   */
  readonly blocks: boolean;
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

/** 要素（の開始タグの中の束縛属性）が置かれた文脈。 */
export interface IElementContext {
  /**
   * 束縛として読まれる（raw text 要素の中身でも、中身を置き換える束縛を持つ要素の子孫でも、別の `<template>`
   * の中に入れ子にした構造でない `<template>` の中でもない）。Inside a top-level non-structural `<template>`, only
   * when a state binds its content: one with its own `<wcs-state>` (a declarative shadow root, a DCC —
   * ownStateTemplate), a route template or a layout template (stateBindsTemplate). The content of a
   * `<template id="tpl">` that only app code clones is not bound.
   */
  readonly bound: boolean;
  /**
   * for / if / elseif / else テンプレートの行や枝の中で、束縛として読まれる。要素を置き換える束縛
   * （`outerHTML:` / `outerText:`）はここで 4.0 が初期化で拒む（#203 — 行や枝はノードを位置で持つ）。
   * 自前の `<wcs-state>` を持つ template の中は数えない。Only where `bound` holds (inside a top-level template, a route
   * or layout template — not one that only app code clones).
   */
  readonly rowOrBranch: boolean;
  /**
   * 自前の `<wcs-state>` を持つ `<template>`（宣言的 shadow root・DCC・コンポーネントの雛形）の中。そこの
   * 束縛は文書の root の state ではなく、その template の state に付く。router の route の `<template>` は
   * 自前の state を持たないので、文書の一部として扱う。
   */
  readonly ownStateTemplate: boolean;
}

/** 走査の途中で決めた判定（自前の state の有無は、囲む template の走査が終わってから決まる）。 */
interface IPendingContext {
  readonly bound: boolean;
  readonly structural: boolean;
  readonly scopes: readonly ITemplateScope[];
}

/**
 * offsets（要素の開始タグの中 — 束縛属性の値の位置）ごとに、その要素が置かれた文脈を返す。
 * 文書のタグを**1 回だけ**走査し、開いている要素の積み上げで判定する（offset の数によらず走査は 1 回 —
 * 束縛ごとに文書を数え直さない）。template の中に自前の `<wcs-state>` があるかは offset より後ろで分かる
 * ことがあるので、文書の終わりまで走査してから決める。
 *
 * ランタイムの走査（`dom/plan.ts` の walkBindings）と同じく、次の中は束縛として読まれない:
 *   - 別の `<template>` の中に入れ子にした構造でない `<template>`（中身は inert のまま）
 *   - 中身を置き換える束縛（`textContent:` / `innerHTML:` / `innerText:` / `text:` / `html:` /
 *     `outerHTML:` / `outerText:`）を持つ要素の子孫
 *   - raw text 要素（`<script>` / `<style>` / `<textarea>` / `<title>` / `<noscript>` / `<iframe>` …）の中身
 * 文書の直下の構造でない `<template>`（router の route）は、差し込まれた先で束縛されるので塞がない。
 * `bound` (what `wcs/delegated-current-target` checks) and `rowOrBranch` (#203) count the content of such a template
 * only when a state binds it (its own `<wcs-state>`, a route template, a layout template — stateBindsTemplate).
 *
 * HTML のパーサに合わせて、終了タグの省略（`<li>…<li>`・`<p>…<div>`・表の行とセルなど）は開始タグで
 * 暗に閉じ、`/>` は void 要素と svg / math の中だけで閉じたとみなす（HTML では void でない要素の `/>` は
 * 無視される）。
 * 既知の限界: 暗に閉じる規則は「直前に開いた要素」だけを見る近似（HTML の scope の規則のすべてではない）。
 */
export function analyzeElementContexts(
  html: string,
  offsets: readonly number[],
  bindAttrName: string = 'data-wcs',
  stateTagName: string = 'wcs-state',
): Map<number, IElementContext> {
  const out = new Map<number, IElementContext>();
  const pending = [...new Set(offsets)].sort((a, b) => a - b);
  if (pending.length === 0) return out;
  const judged: [number, IPendingContext][] = [];
  // The template ids a `<wcs-layout layout="id">` without `enable-shadow-root` names. A layout can come before or
  // after its template, so this is collected over the whole scan and used at the end
  const layoutIds = new Set<string>();
  let next = 0;
  const NOT_BOUND: IPendingContext = { bound: false, structural: false, scopes: [] };
  const stack: IOpenElement[] = [];
  const judge = (): IPendingContext => ({
    bound: !stack.some((e) => e.blocks),
    structural: stack.some((e) => e.structural),
    scopes: stack.flatMap((e) => (e.scope === null ? [] : [e.scope])),
  });
  const stateTag = asciiLowerCase(stateTagName);
  const escaped = bindAttrName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 引用符の無い値（`data-wcs=for:items`）も HTML では属性値（空白・`>` まで）
  const bindAttr = new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`, 'i');
  const tag = /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let lower: string | null = null;
  let match: RegExpExecArray | null;
  while ((match = tag.exec(html)) !== null) {
    const end = match.index + match[0].length;
    // offset を含む（または越えた）タグに来た: 積み上がっているのが祖先。要素自身も終了タグの省略で
    // 前の要素を閉じる（`<p …>t<div outerHTML>`・`<option>…<option outerHTML>`）ので、閉じてから判定する
    if (next < pending.length && end > pending[next]) {
      const isStart = match[2] !== undefined && match[1] !== '/';
      if (isStart && match.index < pending[next]) closeImplied(stack, asciiLowerCase(match[2]));
      while (next < pending.length && pending[next] < end) judged.push([pending[next++], judge()]);
    }
    if (match[2] === undefined) continue; // コメント
    const name = asciiLowerCase(match[2]);
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
    if (name === stateTag && !parseAttributeNames(attrs).has('mount')) {
      // 自前の `<wcs-state>`: 最も内側の構造でない template（宣言的 shadow root・DCC・雛形）の state。
      // 構造テンプレート（for / if の行や枝）を越えて上へは探さない — route の中の `if:` の枝に置いた
      // `<wcs-state>` で route 全体を「自前の state」とみなすと、route の検査がまとめて黙る
      for (let i = stack.length - 1; i >= 0 && !stack[i].structural; i--) {
        const scope = stack[i].scope;
        if (scope !== null) {
          scope.hasOwnState = true;
          break;
        }
      }
    }
    if (name === LAYOUT_TAG) {
      const layout = extractAttribute(attrs, 'layout');
      if (layout !== null && !parseAttributeNames(attrs).has('enable-shadow-root')) layoutIds.add(layout);
    }
    const foreign = name === 'svg' || name === 'math' || stack.some((e) => e.name === 'svg' || e.name === 'math');
    if (VOID_ELEMENTS.has(name) || (foreign && /\/\s*$/.test(attrs))) continue;
    if (RAW_TEXT_ELEMENTS.has(name)) {
      // `<plaintext>` は終了タグを持たない（文書の終わりまで文字）
      const close = name === 'plaintext' ? -1 : (lower ??= asciiLowerCase(html)).indexOf(`</${name}`, end);
      const stop = close === -1 ? html.length : close;
      // 中身の中の offset: ブラウザでは文字であって束縛ではない
      while (next < pending.length && pending[next] < stop) judged.push([pending[next++], NOT_BOUND]);
      if (close === -1) break;
      tag.lastIndex = close;
      continue;
    }
    const match3 = bindAttr.exec(attrs);
    const value = match3 === null ? null : match3[1] ?? match3[2] ?? match3[3];
    const names = value === null ? [] : propertyNamesOf(value);
    // 構造ディレクティブは単独の束縛（`for: items`）。修飾子付き（`for#x:`）は正本パーサが拒む形なので数えない
    const structural = name === 'template' && names.length === 1 && STRUCTURAL_DIRECTIVES.has(names[0])
      && !value!.slice(0, Math.max(0, indexOfOutsideQuotes(value!, ':'))).includes('#');
    const plainTemplate = name === 'template' && !structural;
    const blocks = (plainTemplate && stack.some((e) => e.name === 'template'))
      || (name !== 'template' && names.some((n) => CONTENT_PROPERTIES.has(n)));
    const scope: ITemplateScope | null = plainTemplate
      ? { hasOwnState: false, id: extractAttribute(attrs, 'id'), underRouter: stack.some((e) => e.name === ROUTER_TAG) }
      : null;
    stack.push({ name, structural, scope, blocks });
  }
  // 閉じていない文書の末尾
  while (next < pending.length) judged.push([pending[next++], judge()]);
  for (const [offset, context] of judged) {
    const ownStateTemplate = context.scopes.some((scope) => scope.hasOwnState);
    // Where the walker reads bindings, an enclosing non-structural template is a top-level one (a nested one blocks).
    // Its content is bound only when a state binds it (its own <wcs-state>, a route template, a layout template)
    const bound = context.bound
      && context.scopes.every((scope) => scope.hasOwnState || stateBindsTemplate(scope, layoutIds));
    out.set(offset, {
      bound,
      rowOrBranch: bound && context.structural && !ownStateTemplate,
      ownStateTemplate,
    });
  }
  return out;
}

/**
 * offset（要素の開始タグの中 — 束縛属性の値の位置）の要素が、**行か枝の計画の中で**束縛として読まれるか
 * （analyzeElementContexts の `rowOrBranch`。offset 1 つだけを判定する — 束縛ごとに呼ぶときは
 * analyzeElementContexts にまとめて渡すこと）。
 */
export function isRowOrBranchContent(html: string, offset: number, bindAttrName: string = 'data-wcs'): boolean {
  return analyzeElementContexts(html, [offset], bindAttrName).get(offset)?.rowOrBranch === true;
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
