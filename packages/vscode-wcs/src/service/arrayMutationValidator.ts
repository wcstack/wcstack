/**
 * arrayMutationValidator.ts
 *
 * <wcs-state> スクリプト内の「配列への破壊的操作」を検出する。
 * 設計・検証の正本: docs/array-mutation-diagnostic-design.md
 *
 * @wcstack/state のリアクティビティはプロパティ代入（Proxy set トラップ）でのみ
 * 発火するため、破壊的メソッド呼び出しとインデックス代入は DOM に反映されない。
 * 同一参照の自己再代入でも要素の追加・削除は反映されない（設計 doc §3 V2/V4 実証）。
 *
 * 2 コードを持つため、単一カテゴリ validator の「集約時 code 付与」ではなく
 * bindingValidator と同じく code 付き WcsDiagnostic[] を返す:
 *   wcs/array-mutation     — this.<path>.push(...) 等 9 メソッドの呼び出し
 *   wcs/array-index-assign — this.<path>[i] = value（bracket-only チェーン代入）
 *
 * 境界: チェーンにドットアクセスを含む代入（this.items[0].name = x）は
 * wcs/nested-assign の担当であり、ここでは発火しない（相補・二重報告なし）。
 */

import { parseWcsScriptBlocks } from '../language/htmlParse.js';
import { getMessages, type WcsMessageCatalog } from '../core/messages.js';
import { WcsDiagnostic, WcsDiagnosticCode } from '../core/diagnostics.js';

/** 破壊的メソッド 9 種（ES 標準の in-place mutating methods）。 */
const DESTRUCTIVE_METHODS = 'push|pop|shift|unshift|splice|sort|reverse|fill|copyWithin';

/** メソッド別の非破壊代替（メッセージ提示用）。acc は検出パスのアクセサ表記。 */
const ALTERNATIVES: Record<string, (acc: string) => string> = {
  push: (a) => `${a} = ${a}.concat(item)`,
  unshift: (a) => `${a} = [item, ...${a}]`,
  pop: (a) => `${a} = ${a}.slice(0, -1)`,
  shift: (a) => `${a} = ${a}.slice(1)`,
  splice: (a) => `${a} = ${a}.toSpliced(...)`,
  sort: (a) => `${a} = ${a}.toSorted(...)`,
  reverse: (a) => `${a} = ${a}.toReversed()`,
  fill: (a) => `${a} = ${a}.with(...)`,
  copyWithin: (a) => `${a} = ${a}.map(...)`,
};

// ドットルート形: this.items.push( / this.a.b[0].sort( 等。
// 末尾の `(` は lookahead に置き、range をメソッド名末尾で終える。
const DOT_ROOT_CALL = new RegExp(
  String.raw`\bthis\.(\w+)((?:\.\w+|\[\w+\])*)\.(${DESTRUCTIVE_METHODS})(?=\s*\()`,
  'g',
);

// bracket ルート形: this["items"].push( / this["items.*.tags"].push( 等。
const BRACKET_ROOT_CALL = new RegExp(
  String.raw`\bthis\[\s*["']([^"']+)["']\s*\]((?:\.\w+|\[\w+\])*)\.(${DESTRUCTIVE_METHODS})(?=\s*\()`,
  'g',
);

// インデックス代入形: this.items[0] = / this.items[i][1] = 等（bracket-only チェーン限定）。
// `==` 等の比較は lookahead で除外。ドット含みチェーンは wcs/nested-assign の担当。
const INDEX_ASSIGN = new RegExp(
  String.raw`\bthis\.(\w+)((?:\[\w+\])+)\s*=(?!=)`,
  'g',
);

/**
 * チェーン部分（`.foo` / `[0]` / `[i]` の連なり）をドットパス表記へ変換する。
 * 数値添字はそのままセグメントに、識別子添字は動的添字として `<name>` で表す。
 */
function chainToDotted(chain: string): string {
  return chain.replace(/\[(\w+)\]/g, (_, key: string) => /^\d+$/.test(key) ? `.${key}` : `.<${key}>`);
}

/** メッセージ例示用のアクセサ表記。単一セグメントの識別子のみドット形、それ以外は bracket 形。 */
function toAccessor(path: string): string {
  return /^[A-Za-z_]\w*$/.test(path) ? `this.${path}` : `this["${path}"]`;
}

/**
 * HTML 内の <wcs-state> スクリプトから配列への破壊的操作を検出する。
 */
export function validateArrayMutations(html: string, stateTagName: string = 'wcs-state', locale?: string): WcsDiagnostic[] {
  const msgs = getMessages(locale);
  const blocks = parseWcsScriptBlocks(html, stateTagName);
  const diagnostics: WcsDiagnostic[] = [];

  for (const block of blocks) {
    findDestructiveCalls(block.content, block.contentStart, msgs, diagnostics);
    findIndexAssigns(block.content, block.contentStart, msgs, diagnostics);
  }

  return diagnostics;
}

/** 破壊的メソッド呼び出し（wcs/array-mutation）の検出。 */
function findDestructiveCalls(script: string, baseOffset: number, msgs: WcsMessageCatalog, out: WcsDiagnostic[]): void {
  let match: RegExpExecArray | null;

  DOT_ROOT_CALL.lastIndex = 0;
  while ((match = DOT_ROOT_CALL.exec(script)) !== null) {
    const [full, root, chain, method] = match;
    pushMutationDiagnostic(out, msgs, baseOffset + match.index, full.length, root + chainToDotted(chain), method);
  }

  BRACKET_ROOT_CALL.lastIndex = 0;
  while ((match = BRACKET_ROOT_CALL.exec(script)) !== null) {
    const [full, rootPath, chain, method] = match;
    // `$` 始まりの quoted パス（$streams 等の API 名前空間）はスキップ
    // （ドットルート形は \w+ が `$` を含まないため構造的に対象外）。
    if (rootPath.startsWith('$')) continue;
    pushMutationDiagnostic(out, msgs, baseOffset + match.index, full.length, rootPath + chainToDotted(chain), method);
  }
}

function pushMutationDiagnostic(out: WcsDiagnostic[], msgs: WcsMessageCatalog, start: number, length: number, statePath: string, method: string): void {
  out.push({
    code: WcsDiagnosticCode.ArrayMutation,
    start,
    end: start + length,
    message: msgs.arrayMutation(method, ALTERNATIVES[method](toAccessor(statePath))),
    severity: 'warning',
    statePath,
  });
}

/** インデックス代入（wcs/array-index-assign）の検出。 */
function findIndexAssigns(script: string, baseOffset: number, msgs: WcsMessageCatalog, out: WcsDiagnostic[]): void {
  let match: RegExpExecArray | null;

  INDEX_ASSIGN.lastIndex = 0;
  while ((match = INDEX_ASSIGN.exec(script)) !== null) {
    const [full, root, chain] = match;
    const suggestedPath = root + chainToDotted(chain);
    const start = baseOffset + match.index;
    out.push({
      code: WcsDiagnosticCode.ArrayIndexAssign,
      start,
      end: start + full.length,
      message: msgs.arrayIndexAssign(suggestedPath),
      severity: 'warning',
      statePath: suggestedPath,
    });
  }
}
