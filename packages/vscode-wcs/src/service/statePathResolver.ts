/**
 * statePathResolver.ts
 *
 * HTML 内の <wcs-state> 要素から状態パスを解決する共通ロジック。
 * 複数の初期化方法（state 属性, src 属性, json 属性, インナースクリプト）に対応。
 *
 * 解決優先順位（wcs-state ランタイムと同一）:
 *   state → src (.json / .js / .ts) → json → inner <script type="module">
 *
 * A volume's (`mount=`) candidates go on the tree under its mount path. Where the validator could not read a
 * state's source, `StatePathScopes` records it, and the checks that report a missing path stay silent there
 * (`isUnresolvedPath`).
 */

import { createTemplateTester, parseWcsStateElements, findScriptJsonById, type WcsStateInfo } from '../language/htmlParse.js';
import {
  analyzeStatePaths, analyzeJsonPaths, hasDefaultExportObject, hasTopLevelSpread, type PathCandidate,
} from './stateAnalyzer.js';

/**
 * 外部ファイルの内容を読み取るコールバック。
 * src 属性の解決に使用する。undefined を返した場合、そのファイルはスキップされる。
 */
export type FileReader = (relativePath: string) => string | undefined;

/**
 * The parts of the tree the candidate set cannot vouch for: the states whose source the validator could not read.
 *
 * A state is unreadable when no source of it could be read and parsed — an `src=` the reader cannot read (no
 * reader on the IDE path, a URL, a leading-`/` path, a missing file), a script whose `export default { … }` is not
 * a plain object literal (`export default make()`, a top-level spread), or an element with no source at all (it
 * waits for `setInitialState()`). An empty state that was read (`json='{}'`, `export default {}`) is readable: its
 * paths are known not to exist. Under the mount path of an unreadable volume the runtime reads what was grafted,
 * so a path the candidates lack cannot be called missing there; the same holds outside every volume when the page's
 * root state cannot be read.
 */
export interface StatePathScopes {
  /** The mount paths of the volumes considered (readable or not). */
  readonly mounts: readonly string[];
  /** The mount paths of the volumes whose state could not be read. */
  readonly unresolvedMounts: ReadonlySet<string>;
  /**
   * The page's root state could not be read: the document has a root `<wcs-state>` (no `mount`, no
   * `bind-component`, not inside a `<template>`) and none of them could be read.
   */
  readonly rootUnresolved: boolean;
}

/** The document's state path candidates, and the parts they cannot vouch for. */
export interface StatePathIndex {
  /**
   * Every candidate (the root states', and the volumes' under their mount path, with the synthesized mount points).
   * The same as `getStatePathsFromHtml`.
   */
  readonly paths: PathCandidate[];
  /** The volumes' candidates only (under their mount path, with the synthesized mount points). */
  readonly volumePaths: PathCandidate[];
  readonly scopes: StatePathScopes;
  /** The scanned `<wcs-state>` elements (for callers that need them too — the document is not scanned again). */
  readonly elements: readonly WcsStateInfo[];
}

/**
 * Whether `path` belongs to a state the validator could not read (report nothing about its existence).
 *
 * The owner is the volume with the longest mount path that prefixes `path` (`cart.items.*.qty` → `cart`), or the
 * root when no volume does. An unreadable owner makes the path unknown. An ancestor of an unreadable volume's mount
 * path (`shop` of `shop.cart`) is unknown too: it exists once that volume grafts.
 */
export function isUnresolvedPath(path: string, scopes: StatePathScopes): boolean {
  let owner: string | null = null;
  for (const mount of scopes.mounts) {
    if ((path === mount || path.startsWith(`${mount}.`)) && (owner === null || mount.length > owner.length)) owner = mount;
  }
  if (owner !== null) return scopes.unresolvedMounts.has(owner);
  if (scopes.rootUnresolved) return true;
  for (const mount of scopes.unresolvedMounts) {
    if (mount.startsWith(`${path}.`)) return true;
  }
  return false;
}

/**
 * HTML 全体から <wcs-state> 要素を解析し、全ての状態パス候補を収集する。
 *
 * 各 <wcs-state> について、以下の優先順位で最初にマッチした初期化方法を使用:
 *   1. state 属性 — 同一 HTML 内の <script type="application/json" id="..."> を参照
 *   2. src 属性 — 外部ファイルを読み込み（.json / .js / .ts）
 *      - .js の場合、同名の .ts ファイルが存在すればそちらを優先
 *   3. json 属性 — インライン JSON 文字列
 *   4. inner <script type="module"> — JavaScript モジュール（既存の解析）
 *
 * @param html - HTML 全文
 * @param stateTagName - 状態タグ名（デフォルト: 'wcs-state'）
 * @param fileReader - 外部ファイル読み取り用コールバック（省略時は src 属性をスキップ）
 */
export function getStatePathsFromHtml(
  html: string,
  stateTagName: string = 'wcs-state',
  fileReader?: FileReader,
): PathCandidate[] {
  return getStatePathIndex(html, stateTagName, fileReader).paths;
}

/**
 * `getStatePathsFromHtml`'s candidates with the parts they cannot vouch for (`StatePathScopes`). The checks that
 * report a missing path (bindings, mustache, comment bindings, `$watch` keys) stay silent there
 * (`isUnresolvedPath`). The document's `<wcs-state>` elements are scanned once.
 */
export function getStatePathIndex(
  html: string,
  stateTagName: string = 'wcs-state',
  fileReader?: FileReader,
): StatePathIndex {
  return resolveStatePathIndex(parseWcsStateElements(html, stateTagName), html, fileReader, true);
}

/**
 * Builds the candidates and the scopes from scanned `<wcs-state>` elements (for a caller that uses the scan for
 * more — the document is not scanned again). `includeRoots: false` resolves the volumes only (for a caller that
 * has the root's candidates itself — `$watch`): `paths` then holds the volumes' candidates and
 * `scopes.rootUnresolved` is false.
 */
export function resolveStatePathIndex(
  elements: readonly WcsStateInfo[],
  html: string,
  fileReader: FileReader | undefined,
  includeRoots: boolean,
): StatePathIndex {
  const paths: PathCandidate[] = [];
  const volumePaths: PathCandidate[] = [];
  const mounts: string[] = [];
  const unresolvedMounts = new Set<string>();
  // The root elements that take part in the page-root decision (not `bind-component`: its state is the host's)
  const roots: { readonly element: WcsStateInfo; readonly readable: boolean }[] = [];
  // 合成したマウントポイントは兄弟ボリューム間で重複しうる（`shop.cart` と `shop.user` は
  // どちらも `shop` を合成する）ので、文書全体で 1 回だけ載せる
  const mountPoints = new Set<string>();

  for (const element of elements) {
    if (element.mountPath === null) {
      if (!includeRoots) continue;
      const resolved = resolveElementPathsRaw(element, html, fileReader);
      if (!element.bindComponent) roots.push({ element, readable: resolved.readable });
      paths.push(...resolved.paths);
      continue;
    }
    const resolved = resolveElementPathsRaw(element, html, fileReader);
    const grafted = graftVolumePaths(element.mountPath, resolved, mountPoints);
    // An empty mount= is refused by the runtime (mountAttrValidator reports it): it owns no paths
    if (element.mountPath !== '') {
      mounts.push(element.mountPath);
      if (!resolved.readable) unresolvedMounts.add(element.mountPath);
    }
    paths.push(...grafted);
    volumePaths.push(...grafted);
  }

  return {
    paths,
    volumePaths,
    scopes: { mounts, unresolvedMounts, rootUnresolved: isPageRootUnresolved(roots, html) },
    elements,
  };
}

/**
 * Whether the page's root state could not be read: the document has root elements outside every `<template>` and
 * none of them could be read. A `<wcs-state>` inside a `<template>` (a declarative shadow root, a DCC) is the root of
 * another tree and does not count. A document with no page root (a component file) is not "unreadable": its
 * bindings are checked against the candidates as before. The `<template>` scan runs only when a root is unreadable.
 */
function isPageRootUnresolved(
  roots: readonly { readonly element: WcsStateInfo; readonly readable: boolean }[],
  html: string,
): boolean {
  if (roots.every((root) => root.readable)) return false;
  const insideTemplate = createTemplateTester(html);
  const pageRoots = roots.filter((root) => !insideTemplate(root.element.tagStart));
  return pageRoots.length > 0 && pageRoots.every((root) => !root.readable);
}

/**
 * Puts one volume's candidates on the tree under its mount path.
 */
function graftVolumePaths(
  mountPath: string,
  resolved: ElementPaths,
  mountPoints: Set<string>,
): PathCandidate[] {
  // Only what 4.0 grafts goes on the tree (state-next's scopes/volume.ts `graft`):
  // - data, getters / setters and methods, at `<mount>.<key>`. A method is grafted as a function whose `this` is
  //   the mount path, so it can be an event handler (`onclick: cart.add`); it keeps the validation-only `method`
  //   kind, which the completion offers for event bindings. 3.x did not graft methods, hence the old drop.
  // - not the `$` namespace (`$command.*`, `$streamStatus.*`, …): a volume's `$stream` refuses the graft, and its
  //   `$commandTokens` / `$eventTokens` / `$on` are ignored with a console.warn (wcs/volume-declaration). Event
  //   tokens are dropped for the same reason.
  const prefix = mountPath + '.';
  const out: PathCandidate[] = [];
  for (const p of resolved.paths) {
    if (p.path.startsWith('$')) continue;
    if (p.kind === 'eventToken') continue;
    out.push({ ...p, path: prefix + p.path });
  }
  // マウントパス**そのもの**もツリー上のオブジェクトとして存在する。以前は接頭辞付きの
  // 子パスしか積んでいなかったので、`state: cart`（コンポーネントの根をマウントする正規の
  // 書き方 — state の README 参照）や `textContent: cart` が `wcs/binding-path-missing` に
  // 誤報されていた。ネストしたマウント（`a.b`）では途中の `a` も同じ理由で載せる。
  // Only for a volume whose state was read (an empty one too: the graft writes `{}` at the mount path). An
  // unreadable volume adds nothing — it goes to StatePathScopes.unresolvedMounts and its subtree stays silent.
  if (resolved.readable) {
    const segments = mountPath.split('.');
    for (let i = 1; i <= segments.length; i++) {
      const path = segments.slice(0, i).join('.');
      // 兄弟ボリューム（`mount="shop.cart"` と `mount="shop.user"`）は共通の接頭辞 `shop` を
      // それぞれ合成するので、重複させるとパス補完に同じ項目が 2 つ並ぶ
      if (mountPoints.has(path)) continue;
      mountPoints.add(path);
      out.push({ path, kind: 'data', typeHint: 'object' });
    }
  }
  return out;
}

/** What one `<wcs-state>` yields: its candidates, and whether one of its sources was read (see StatePathScopes). */
interface ElementPaths {
  readonly paths: PathCandidate[];
  readonly readable: boolean;
}

const UNREADABLE: ElementPaths = { paths: [], readable: false };

/** A JSON text that parses to an object (an empty one too). */
function isJsonObject(text: string): boolean {
  try {
    const data: unknown = JSON.parse(text);
    return typeof data === 'object' && data !== null && !Array.isArray(data);
  } catch {
    return false;
  }
}

/** A script whose state the analyzer reads in full: an `export default { … }` literal without a top-level spread. */
export function isReadableStateScript(script: string): boolean {
  return hasDefaultExportObject(script) && !hasTopLevelSpread(script);
}

function fromJson(text: string): ElementPaths {
  const paths = analyzeJsonPaths(text);
  // the parse is repeated only for a state with no paths (rare)
  return { paths, readable: paths.length > 0 || isJsonObject(text) };
}

function fromScript(script: string): ElementPaths {
  const paths = analyzeStatePaths(script);
  return { paths, readable: paths.length > 0 || isReadableStateScript(script) };
}

function resolveElementPathsRaw(
  element: WcsStateInfo,
  html: string,
  fileReader?: FileReader,
): ElementPaths {
  // A source that yields no paths falls through to the next one, as before; one that was read is remembered
  let readable = false;

  // 1. state 属性: <script type="application/json" id="..."> を参照
  if (element.stateAttr) {
    const jsonContent = findScriptJsonById(html, element.stateAttr);
    if (jsonContent) {
      const resolved = fromJson(jsonContent);
      if (resolved.paths.length > 0) return resolved;
      readable ||= resolved.readable;
    }
  }

  // 2. src 属性: 外部ファイル（.json / .js / .ts）
  if (element.srcAttr && fileReader) {
    const resolved = resolveSrcAttribute(element.srcAttr, fileReader);
    if (resolved.paths.length > 0) return resolved;
    readable ||= resolved.readable;
  }

  // 3. json 属性: インライン JSON
  if (element.jsonAttr) {
    const resolved = fromJson(element.jsonAttr);
    if (resolved.paths.length > 0) return resolved;
    readable ||= resolved.readable;
  }

  // 4. inner <script type="module">: 既存の解析
  if (element.scriptBlocks.length > 0) {
    const paths = element.scriptBlocks.flatMap(block => analyzeStatePaths(block.content));
    return {
      paths,
      readable: paths.length > 0 || readable || element.scriptBlocks.some((block) => isReadableStateScript(block.content)),
    };
  }

  return readable ? { paths: [], readable } : UNREADABLE;
}

/**
 * The script of a state loaded with `src=` (`.js` reads the same-named `.ts` first), or undefined when it cannot be
 * read or is not a script (`.json`).
 */
export function readStateScript(srcPath: string, fileReader: FileReader): string | undefined {
  if (srcPath.endsWith('.js')) {
    // .ts ファイルが存在すればそちらを優先
    return fileReader(srcPath.replace(/\.js$/, '.ts')) || fileReader(srcPath) || undefined;
  }
  if (srcPath.endsWith('.ts')) return fileReader(srcPath) || undefined;
  return undefined;
}

/**
 * src 属性の値からパスを解決する。
 *
 * - .json → JSON パース
 * - .js   → 同名の .ts があればそちらを優先、なければ .js を解析
 * - .ts   → TypeScript/JavaScript として解析（export default {} を検出）
 */
function resolveSrcAttribute(
  srcPath: string,
  fileReader: FileReader,
): ElementPaths {
  if (srcPath.endsWith('.json')) {
    const content = fileReader(srcPath);
    return content ? fromJson(content) : UNREADABLE;
  }
  const script = readStateScript(srcPath, fileReader);
  return script !== undefined ? fromScript(script) : UNREADABLE;
}
