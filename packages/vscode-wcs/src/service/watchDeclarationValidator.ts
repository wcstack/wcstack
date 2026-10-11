/**
 * watchDeclarationValidator.ts
 *
 * `<wcs-state>` スクリプト内の `$watch` 宣言を検証する。
 *
 * `$watch` のキーは **監視対象の state パス**であり、`data-wcs` の右辺と同じ性質を持つ。
 * ところが失敗の出方が違う: バインディング側のタイプミスは「描画されない」という形で
 * 目に見えるのに対し、`$watch` 側のタイプミスは **黙って一度も発火しない**。
 * この機構の失敗モードは一貫して無発火なので、静的に拾えるかどうかがそのまま効く。
 *
 * 2 種類に分ける:
 * - **error**: ランタイム（@wcstack/state watch/processWatchDeclaration.ts）が
 *   `raiseError` で落とす形。静的に確実なので error にしてよい。
 * - **warning**: 状態定義に存在しないパス。`wcs/binding-path-missing` と同じ性質
 *   （初期値が空配列の行フィールドなど、静的に解決できない正当な形がある）なので
 *   同じ severity に揃える。CI は `--errors-only` なのでビルドは落とさない。
 *
 * 検証しないもの:
 * - ワイルドカード段数の上限（128）。実コードで到達し得ずランタイム側の防衛線で足りる。
 * - 値が関数かどうかの断定は「明らかな非関数リテラル」に限る。`isLoading: onChange`
 *   のような識別子参照は静的に解決できないため疑わない（誤検出を出さない側に倒す）。
 */

import { createTemplateChain, parseWcsStateElements, type WcsStateInfo } from '../language/htmlParse.js';
import { getMessages, type WcsMessageCatalog } from '../core/messages.js';
import { WcsDiagnostic, WcsDiagnosticCode, type WcsDiagnosticCodeValue } from '../core/diagnostics.js';
import { analyzeStatePaths, analyzeWatchEntries, findNonObjectWatch, type PathCandidate, type WatchEntryInfo } from './stateAnalyzer.js';
import { collectRecursionSpecs, hasRecursionWildcard, matchesRecursion } from './recursionPaths.js';
import { toWildcardForm } from './indexPath.js';
import {
  isReadableStateScript, isUnresolvedPath, resolveStatePathIndex, type FileReader, type StatePathIndex, type StatePathScopes,
} from './statePathResolver.js';

/** 他 state を指す区切り（@wcstack/state define.ts の STATE_NAME_SEPARATOR）。 */
const STATE_NAME_SEPARATOR = '@';

/**
 * HTML 内の全 `<wcs-state>` について `$watch` 宣言を検証する。
 *
 * A root `$watch` key may name a path under a volume (`cart.total`): it fires on writes to the grafted state. The
 * candidates of the root's volumes (an inline script, `json`, `state`, an `src=` the `fileReader` reads) are added
 * under their mount path, and nothing is said about the existence of a key under an unreadable volume
 * (isUnresolvedPath). A volume belongs to the innermost enclosing `<template>` that holds a root `<wcs-state>` (a
 * declarative shadow root, a DCC); any other volume — in the document, or in a route or layout template, which is
 * inserted into the page — belongs to the page's root (assignVolumes).
 *
 * @param fileReader - the reader for the volumes' `src=` (the one the binding checks use; without it, `src=` is not read)
 */
export function validateWatchDeclarations(
  html: string,
  stateTagName: string = 'wcs-state',
  locale?: string,
  fileReader?: FileReader,
): WcsDiagnostic[] {
  const msgs = getMessages(locale);
  const out: WcsDiagnostic[] = [];
  const elements = parseWcsStateElements(html, stateTagName);
  const hasVolumes = elements.some((element) => element.mountPath !== null);
  // Resolved once, when a root `$watch` with keys is met (the `<template>` scan only when there are volumes)
  let assignment: VolumeAssignment | null = null;
  const resolvedVolumes = new Map<number, StatePathIndex>();

  for (const element of elements) {
    // The runtime does not load a script inside `<wcs-state bind-component>` (wcs/bind-component-source — as parseLoadedScriptBlocks)
    if (element.bindComponent) continue;
    // ボリューム（`mount=`）の `$watch` は、4.0 のランタイムが中身を見る前に接ぎ木ごと拒む
    // （scopes/volume.ts の REJECTED）。scopeDeclarationValidator が `wcs/volume-declaration` で報告するので、
    // 動かない宣言の形・キーの検査は重ねない
    if (element.mountPath !== null) continue;
    for (const block of element.scriptBlocks) {
      // 値がオブジェクトでないと断定できる宣言（`$watch: "x"` / `$watch() {}` 等)。
      // ランタイムは読み込み時に raiseError するため error。entries は 0 件になる形
      // なので、下の early-continue より前に検査する。
      const nonObject = findNonObjectWatch(block.content);
      if (nonObject !== null) {
        out.push({
          code: WcsDiagnosticCode.WatchDeclarationInvalid,
          start: block.contentStart + nonObject.start,
          end: block.contentStart + nonObject.end,
          message: msgs.watchNotObject(),
          severity: 'error',
        });
      }

      const entries = analyzeWatchEntries(block.content);
      if (entries.length === 0) continue;

      // The root's own keys are unknown when its script cannot be read in full (no `export default { … }` literal,
      // or a top-level spread) — the same rule as the bindings' (statePathResolver's isReadableStateScript). An
      // empty literal is read: its keys are known not to exist.
      const own = analyzeStatePaths(block.content);
      let volumes: StatePathIndex | null = null;
      if (hasVolumes) {
        assignment ??= assignVolumes(elements, html);
        const tree = assignment.treeOf(element);
        const treeVolumes = assignment.volumes.get(tree);
        if (treeVolumes !== undefined) {
          volumes = resolvedVolumes.get(tree) ?? resolveStatePathIndex(treeVolumes, html, fileReader, false);
          resolvedVolumes.set(tree, volumes);
        }
      }
      const paths = volumes !== null && volumes.volumePaths.length > 0 ? [...own, ...volumes.volumePaths] : own;
      const pathSet = new Set(paths.map(p => p.path));
      const scopes: StatePathScopes = {
        mounts: volumes?.scopes.mounts ?? [],
        unresolvedMounts: volumes?.scopes.unresolvedMounts ?? NO_MOUNTS,
        rootUnresolved: own.length === 0 && !isReadableStateScript(block.content),
      };

      for (const entry of entries) {
        const diagnostic = validateEntry(entry, pathSet, paths, scopes, msgs);
        if (diagnostic === null) continue;
        out.push({
          code: diagnostic.code,
          start: block.contentStart + entry.start,
          end: block.contentStart + entry.end,
          message: diagnostic.message,
          severity: diagnostic.severity,
        });
      }
    }
  }

  return out;
}

const NO_MOUNTS: ReadonlySet<string> = new Set();

/** The volumes of each state tree, keyed by the tree (assignVolumes). */
interface VolumeAssignment {
  /** The tree of a root element: the start offset of its innermost enclosing `<template>`, or -1 (the page). */
  readonly treeOf: (root: WcsStateInfo) => number;
  readonly volumes: ReadonlyMap<number, WcsStateInfo[]>;
}

/**
 * Assigns each volume to the tree it grafts onto: the innermost enclosing `<template>` that holds a root
 * `<wcs-state>` (no `mount`, no `bind-component` — a declarative shadow root, a DCC), or the page (-1). A volume
 * in a route or layout template belongs to the page: the router inserts that content into the page, where the
 * volume grafts onto the page's root. (A root's tree is its innermost enclosing `<template>`, also when that is a
 * structural one inside a shadow root — an approximation.) One scan of the `<template>` tags.
 */
function assignVolumes(elements: readonly WcsStateInfo[], html: string): VolumeAssignment {
  const chainOf = createTemplateChain(html);
  const innermost = (chain: readonly number[]): number => (chain.length > 0 ? chain[chain.length - 1] : -1);
  const treeOf = (root: WcsStateInfo): number => innermost(chainOf(root.tagStart));
  const rootTrees = new Set<number>();
  for (const element of elements) {
    if (element.mountPath === null && !element.bindComponent) rootTrees.add(treeOf(element));
  }
  const volumes = new Map<number, WcsStateInfo[]>();
  for (const element of elements) {
    if (element.mountPath === null) continue;
    const chain = chainOf(element.tagStart);
    let tree = -1;
    for (let i = chain.length - 1; i >= 0; i--) {
      if (rootTrees.has(chain[i])) {
        tree = chain[i];
        break;
      }
    }
    const list = volumes.get(tree);
    if (list === undefined) volumes.set(tree, [element]);
    else list.push(element);
  }
  return { treeOf, volumes };
}

interface EntryDiagnostic {
  readonly code: WcsDiagnosticCodeValue;
  readonly message: string;
  readonly severity: 'error' | 'warning';
}

/**
 * エントリ 1 件を検証する。**最初に当たった 1 件だけ**返す
 * （同じキーに複数の理由を並べても直す順番が増えるだけなので）。
 */
function validateEntry(
  entry: WatchEntryInfo,
  pathSet: ReadonlySet<string>,
  paths: readonly PathCandidate[],
  scopes: StatePathScopes,
  msgs: WcsMessageCatalog,
): EntryDiagnostic | null {
  const { key } = entry;
  const invalid = (message: string): EntryDiagnostic =>
    ({ code: WcsDiagnosticCode.WatchDeclarationInvalid, message, severity: 'error' });

  // 空キー（`""(cur, prev) {}`）は見ない: プロパティ名の走査が空名を拾わない構造で、
  // 拾えるように広げると accessor / method の空名判定まで壊れる。ランタイムは
  // 読み込み時に raiseError で落とす ＝ 静かに失敗する形ではないので、
  // この validator の守備範囲（黙って発火しない誤り）から外れる。
  if (key.includes(STATE_NAME_SEPARATOR)) {
    // 越境 watch は設計 D8 で不採用。ランタイムは宣言時に throw する。
    return invalid(msgs.watchKeyCrossState(key));
  }
  if (key.startsWith('$')) {
    return invalid(msgs.watchKeyReserved(key));
  }
  if (key.split('.').some(segment => segment.length === 0)) {
    // "a..b" / 先頭・末尾の "." — 解決不能なアドレスになる
    return invalid(msgs.watchKeyEmptySegment(key));
  }
  if (hasRecursionWildcard(key)) {
    // `**` は $recursion 宣言・再帰 getter のキー・$getAll / $setAll のパス引数だけの記号。
    // `$watch` に渡すと PathInfo の不変条件（wcs/recursion-unsupported）で throw する。
    return {
      code: WcsDiagnosticCode.RecursionUnsupported,
      message: msgs.recursionUnsupported(key, 'watch'),
      severity: 'error',
    };
  }
  if (entry.definitelyNotFunction) {
    return invalid(msgs.watchHandlerNotFunction(key));
  }
  // 数値の添字のキー（`items.0.v`）は添字を `*` に読み替えた形でも照合する — 4.0 は添字のパスを行として読み、
  // その行の書き込みで発火する（#355。束縛の存在の照合と同じ — bindingValidator の pathExistsInCandidates）
  // Nothing is said about a key in a state the validator could not read (the root, or an unreadable volume's subtree)
  if (!isUnresolvedPath(key, scopes) && !pathSet.has(key) && !pathSet.has(toWildcardForm(key)) && !matchesRecursion(collectRecursionSpecs(paths), key, p => pathSet.has(p))) {
    return {
      code: WcsDiagnosticCode.WatchPathMissing,
      message: msgs.watchPathMissing(key),
      severity: 'warning',
    };
  }
  return null;
}
