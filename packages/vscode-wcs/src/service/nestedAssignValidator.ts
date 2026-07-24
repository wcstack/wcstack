/**
 * nestedAssignValidator.ts
 *
 * <wcs-state> スクリプト内のネストされたプロパティ代入を検出する。
 *
 * Proxy はトップレベルの set のみ検出できるため、
 * `this.user.profile.name = "Bob"` のようなチェーン代入は
 * リアクティブ更新がトリガーされない。複合代入（`+=` `??=` 等）と
 * インクリメント/デクリメント（`++` / `--`、前置・後置）も同様。
 * 正しくは `this["user.profile.name"]` へのドットパス代入を使う。
 *
 * 境界: bracket-only チェーンの代入（this.items[0] = x）は
 * wcs/array-index-assign（arrayMutationValidator）の担当であり、
 * ここではドットセグメントを含むチェーンのみ発火する（相補・二重報告なし）。
 * 正規表現部品は scriptPatterns.ts で共有する（規範: 設計 doc §5）。
 */

import { parseWcsScriptBlocks } from '../language/htmlParse.js';
import { getMessages, type WcsMessageCatalog } from '../core/messages.js';
import {
  ASSIGN_TAIL,
  CHAIN_ONE_PLUS,
  PRE_INCDEC,
  ROOT_DOT,
  chainToDotted,
  hasDotSegment,
  isApiRoot,
} from './scriptPatterns.js';

export interface NestedAssignDiagnostic {
  start: number;
  end: number;
  message: string;
  severity: 'warning';
}

// 後置形: this.user.name = / += / ++ 等。前置形: ++this.user.count。
const NESTED_ASSIGN = new RegExp(`${ROOT_DOT}(${CHAIN_ONE_PLUS})${ASSIGN_TAIL}`, 'g');
const PRE_NESTED_INCDEC = new RegExp(`${PRE_INCDEC}${ROOT_DOT}(${CHAIN_ONE_PLUS})`, 'g');

/**
 * HTML 内の <wcs-state> スクリプトからネスト代入パターンを検出する。
 *
 * 検出パターン:
 *   this.prop.sub = value / += value / ++
 *   this.prop[expr].sub = value
 *   ++this.prop.sub
 *
 * 除外パターン:
 *   this.prop = value        （トップレベル — OK）
 *   this["prop.sub"] = value （ドットパス — OK）
 *   this.prop[0] = value     （bracket-only — wcs/array-index-assign の担当）
 *   this.$api(...)           （API 名前空間 — OK）
 */
export function validateNestedAssigns(html: string, stateTagName: string = 'wcs-state', locale?: string): NestedAssignDiagnostic[] {
  const msgs = getMessages(locale);
  const blocks = parseWcsScriptBlocks(html, stateTagName);
  const diagnostics: NestedAssignDiagnostic[] = [];

  for (const block of blocks) {
    findNestedAssigns(block.content, block.contentStart, msgs, diagnostics);
  }

  return diagnostics;
}

/**
 * スクリプト内容からネスト代入パターンを検出する。
 */
function findNestedAssigns(script: string, baseOffset: number, msgs: WcsMessageCatalog, out: NestedAssignDiagnostic[]): void {
  for (const regex of [NESTED_ASSIGN, PRE_NESTED_INCDEC]) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(script)) !== null) {
      const [full, topProp, chainPart] = match;
      // `$` 始まりのルートは API 名前空間（$streams 等）なのでスキップ
      if (isApiRoot(topProp)) continue;
      // ドットセグメントの無い bracket-only チェーンは array-index-assign の担当
      if (!hasDotSegment(chainPart)) continue;
      const suggestedPath = topProp + chainToDotted(chainPart);
      const start = baseOffset + match.index;
      out.push({
        start,
        end: start + full.length,
        message: msgs.nestedAssign(suggestedPath),
        severity: 'warning',
      });
    }
  }
}
