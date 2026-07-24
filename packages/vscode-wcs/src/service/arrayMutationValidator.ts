/**
 * arrayMutationValidator.ts
 *
 * <wcs-state> スクリプト内の「配列への破壊的操作」を検出する。
 * 設計・検証の正本: docs/array-mutation-diagnostic-design.md
 *
 * @wcstack/state のリアクティビティはプロパティ代入（Proxy set トラップ）でのみ
 * 発火するため、破壊的メソッド呼び出し・インデックス代入（複合代入・
 * インクリメント/デクリメント含む）は DOM に反映されない。同一参照の
 * 自己再代入でも要素の追加・削除は反映されない（設計 doc §3 V2/V4/V8/V9 実証）。
 *
 * 2 コードを持つため、単一カテゴリ validator の「集約時 code 付与」ではなく
 * bindingValidator と同じく code 付き WcsDiagnostic[] を返す:
 *   wcs/array-mutation     — this.<path>.push(...) 等 9 メソッドの呼び出し
 *   wcs/array-index-assign — this.<path>[i] = / += / ++ 等（bracket-only チェーン）
 *
 * 境界: チェーンにドットアクセスを含む代入（this.items[0].name = x）は
 * wcs/nested-assign の担当であり、ここでは発火しない（相補・二重報告なし）。
 * quoted キー（this.obj["key"]）と添字内のネスト bracket は対象外（設計 doc §6）。
 */

import { parseWcsScriptBlocks } from '../language/htmlParse.js';
import { getMessages, type WcsMessageCatalog } from '../core/messages.js';
import { WcsDiagnostic, WcsDiagnosticCode } from '../core/diagnostics.js';
import {
  ASSIGN_TAIL,
  BRACKETS_ONLY,
  CHAIN,
  PRE_INCDEC,
  ROOT_BRACKET,
  ROOT_DOT,
  chainToDotted,
  isApiRoot,
} from './scriptPatterns.js';

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
  fill: (a) => `${a} = ${a}.map(...)`,
  copyWithin: (a) => `${a} = ${a}.map(...)`,
};

/** メソッド呼び出しの tail（`(` は lookahead に置き、range をメソッド名末尾で終える）。 */
const METHOD_TAIL = String.raw`\s*\??\.\s*(${DESTRUCTIVE_METHODS})(?=\s*\()`;

// 呼び出し形（wcs/array-mutation）: ドットルート / bracket ルート
const DOT_ROOT_CALL = new RegExp(`${ROOT_DOT}(${CHAIN})${METHOD_TAIL}`, 'g');
const BRACKET_ROOT_CALL = new RegExp(`${ROOT_BRACKET}(${CHAIN})${METHOD_TAIL}`, 'g');
// 代入形（wcs/array-index-assign）: `=` / 複合代入 / 後置 `++` `--`、および前置形
const DOT_INDEX_ASSIGN = new RegExp(`${ROOT_DOT}(${BRACKETS_ONLY})${ASSIGN_TAIL}`, 'g');
const BRACKET_INDEX_ASSIGN = new RegExp(`${ROOT_BRACKET}(${BRACKETS_ONLY})${ASSIGN_TAIL}`, 'g');
const PRE_DOT_INDEX = new RegExp(`${PRE_INCDEC}${ROOT_DOT}(${BRACKETS_ONLY})`, 'g');
const PRE_BRACKET_INDEX = new RegExp(`${PRE_INCDEC}${ROOT_BRACKET}(${BRACKETS_ONLY})`, 'g');

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
  for (const regex of [DOT_ROOT_CALL, BRACKET_ROOT_CALL]) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(script)) !== null) {
      const [full, root, chain, method] = match;
      if (isApiRoot(root)) continue;
      const statePath = root + chainToDotted(chain);
      const start = baseOffset + match.index;
      out.push({
        code: WcsDiagnosticCode.ArrayMutation,
        start,
        end: start + full.length,
        message: msgs.arrayMutation(method, ALTERNATIVES[method](toAccessor(statePath))),
        severity: 'warning',
        statePath,
      });
    }
  }
}

/** インデックス代入・複合代入・インクリメント/デクリメント（wcs/array-index-assign）の検出。 */
function findIndexAssigns(script: string, baseOffset: number, msgs: WcsMessageCatalog, out: WcsDiagnostic[]): void {
  for (const regex of [DOT_INDEX_ASSIGN, BRACKET_INDEX_ASSIGN, PRE_DOT_INDEX, PRE_BRACKET_INDEX]) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(script)) !== null) {
      const [full, root, chain] = match;
      if (isApiRoot(root)) continue;
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
}
