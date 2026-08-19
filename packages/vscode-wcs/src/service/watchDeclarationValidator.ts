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

import { parseWcsScriptBlocks } from '../language/htmlParse.js';
import { getMessages, type WcsMessageCatalog } from '../core/messages.js';
import { WcsDiagnostic, WcsDiagnosticCode, type WcsDiagnosticCodeValue } from '../core/diagnostics.js';
import { analyzeStatePaths, analyzeWatchEntries, type WatchEntryInfo } from './stateAnalyzer.js';

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

  for (const block of parseWcsScriptBlocks(html, stateTagName)) {
    const entries = analyzeWatchEntries(block.content);
    if (entries.length === 0) continue;

    // パス候補が 1 つも取れない（解析できないスクリプト）なら存在検証は行わない。
    // `$streamStatus` の照合が候補ゼロでスキップするのと同じ誤警告回避。
    const paths = analyzeStatePaths(block.content, block.stateName);
    const pathSet = new Set(paths.map(p => p.path));

    for (const entry of entries) {
      const diagnostic = validateEntry(entry, pathSet, msgs);
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
  if (entry.definitelyNotFunction) {
    return invalid(msgs.watchHandlerNotFunction(key));
  }
  if (pathSet.size > 0 && !pathSet.has(key)) {
    return {
      code: WcsDiagnosticCode.WatchPathMissing,
      message: msgs.watchPathMissing(key),
      severity: 'warning',
    };
  }
  return null;
}
