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

import { parseLoadedScriptBlocks } from '../language/htmlParse.js';
import { getMessages, type WcsMessageCatalog } from '../core/messages.js';
import { WcsDiagnostic, WcsDiagnosticCode, type WcsDiagnosticCodeValue } from '../core/diagnostics.js';
import { analyzeStatePaths, analyzeWatchEntries, findNonObjectWatch, type PathCandidate, type WatchEntryInfo } from './stateAnalyzer.js';
import { collectRecursionSpecs, hasRecursionWildcard, matchesRecursion } from './recursionPaths.js';
import { toWildcardForm } from './indexPath.js';

/** 他 state を指す区切り（@wcstack/state define.ts の STATE_NAME_SEPARATOR）。 */
const STATE_NAME_SEPARATOR = '@';

/**
 * HTML 内の全 `<wcs-state>` について `$watch` 宣言を検証する。
 */
export function validateWatchDeclarations(
  html: string,
  stateTagName: string = 'wcs-state',
  locale?: string,
): WcsDiagnostic[] {
  const msgs = getMessages(locale);
  const out: WcsDiagnostic[] = [];

  for (const block of parseLoadedScriptBlocks(html, stateTagName)) {
    // ボリューム（`mount=`）の `$watch` は、4.0 のランタイムが中身を見る前に接ぎ木ごと拒む
    // （scopes/volume.ts の REJECTED）。scopeDeclarationValidator が `wcs/volume-declaration` で報告するので、
    // 動かない宣言の形・キーの検査は重ねない
    if (block.mountPath !== null) continue;
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

    // パス候補が 1 つも取れない（解析できないスクリプト）なら存在検証は行わない。
    // `$streamStatus` の照合が候補ゼロでスキップするのと同じ誤警告回避。
    const paths = analyzeStatePaths(block.content);
    const pathSet = new Set(paths.map(p => p.path));

    for (const entry of entries) {
      const diagnostic = validateEntry(entry, pathSet, paths, msgs);
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

  return out;
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
  if (pathSet.size > 0 && !pathSet.has(key) && !pathSet.has(toWildcardForm(key)) && !matchesRecursion(collectRecursionSpecs(paths), key, p => pathSet.has(p))) {
    return {
      code: WcsDiagnosticCode.WatchPathMissing,
      message: msgs.watchPathMissing(key),
      severity: 'warning',
    };
  }
  return null;
}
