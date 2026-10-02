/**
 * scanDeclarationValidator.ts
 *
 * `<wcs-state>` スクリプト内の `$scan` 宣言を報告する。`@wcstack/state` 4.0 は `$scan` を外した:
 * 読み込み時に `$scan was removed (use $watch or $on)` で throw する（root・マウントしたコンポーネント）。
 * ボリューム（`mount=`）は読み込みを通らず、接ぎ木を拒んで console.error で報告する（その state は木に
 * 載らない）。どれも動かないので error。時間軸の累積は `$watch`（パスの変化）か `$on`（イベントトークン）で書く。
 *
 * 3.x の `$scan` は宣言の形・`from` / `resetOn` のパス・出力名を細かく検査していたが、4.0 では宣言そのものが
 * 動かないので、宣言のキーに 1 件だけ error を出す（中身は検査しない — 直す場所は書き換えの 1 か所）。
 * ランタイムの文面は番号（#1）だけでコードを持たないので、code は 3.x からの `wcs/scan-declaration-invalid`。
 * 値が `undefined` のリテラルは宣言なし扱い（ランタイムは `target.$scan !== undefined` で判定する）。
 *
 * 宣言が静的に読めない形（class 構文の state — ボリュームの通常形）は、鏡像（コメント・文字列の中身を
 * 空白化）への正規表現で拾い、warning に留める（構造が見えず、state 以外のオブジェクトのキーにも当たりうる）。
 */

import { parseLoadedScriptBlocks } from '../language/htmlParse.js';
import { getMessages } from '../core/messages.js';
import { WcsDiagnostic, WcsDiagnosticCode } from '../core/diagnostics.js';
import { analyzeDeclarationSpans, findTopLevelDeclaration, maskCommentsAndStrings } from './stateAnalyzer.js';
import { blankComments } from './scriptCallArgs.js';

const SCAN_KEY = '$scan';
/** 宣言が読めないときのフォールバック（キー・メソッド・class フィールド。`==` / `===` は除く）。 */
const SCAN_DECLARATION = /(^|[{,;\s])\$scan(?=\s*(?:[:(]|=(?!=)))/g;
/** フォールバックで拾った宣言の値が `undefined` のリテラルか（`$scan: undefined` / `$scan = undefined`）。 */
const UNDEFINED_VALUE = /^\s*[:=]\s*undefined\s*(?:[,;}]|$)/;

/**
 * HTML 内の全 `<wcs-state>` について `$scan` 宣言を報告する。
 */
export function validateScanDeclarations(
  html: string,
  stateTagName: string = 'wcs-state',
  locale?: string,
): WcsDiagnostic[] {
  const msgs = getMessages(locale);
  const out: WcsDiagnostic[] = [];

  for (const block of parseLoadedScriptBlocks(html, stateTagName)) {
    if (!block.content.includes(SCAN_KEY)) continue;
    const message = msgs.scanRemoved(block.mountPath);
    const spans = analyzeDeclarationSpans(block.content);
    if (spans.length > 0) {
      const declaration = findTopLevelDeclaration(block.content, SCAN_KEY);
      if (declaration?.kind === 'data' && declaration.value !== undefined && blankComments(declaration.value).trim() === 'undefined') continue;
      for (const span of spans) {
        if (span.name !== SCAN_KEY) continue;
        out.push({
          code: WcsDiagnosticCode.ScanDeclarationInvalid,
          start: block.contentStart + span.start,
          end: block.contentStart + span.end,
          message,
          severity: 'error',
        });
      }
      continue;
    }
    const scan = maskCommentsAndStrings(block.content);
    SCAN_DECLARATION.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = SCAN_DECLARATION.exec(scan)) !== null) {
      const keyStart = match.index + match[1].length;
      if (UNDEFINED_VALUE.test(scan.slice(keyStart + SCAN_KEY.length))) continue;
      out.push({
        code: WcsDiagnosticCode.ScanDeclarationInvalid,
        start: block.contentStart + keyStart,
        end: block.contentStart + keyStart + SCAN_KEY.length,
        message,
        severity: 'warning',
      });
    }
  }

  return out;
}
