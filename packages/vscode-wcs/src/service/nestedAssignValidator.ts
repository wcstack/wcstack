/**
 * nestedAssignValidator.ts
 *
 * <wcs-state> スクリプト内のネストされたプロパティ代入を検出する。
 *
 * Proxy はトップレベルの set のみ検出できるため、
 * `this.user.profile.name = "Bob"` のようなチェーン代入は
 * リアクティブ更新がトリガーされない。
 * 正しくは `this["user.profile.name"] = "Bob"` を使う。
 */

import { parseWcsScriptBlocks } from '../language/htmlParse.js';

export interface NestedAssignDiagnostic {
  start: number;
  end: number;
  message: string;
  severity: 'warning';
}

/**
 * HTML 内の <wcs-state> スクリプトからネスト代入パターンを検出する。
 *
 * 検出パターン:
 *   this.prop.sub = value
 *   this.prop.sub.deep = value
 *   this.prop[index].sub = value
 *
 * 除外パターン:
 *   this.prop = value        （トップレベル — OK）
 *   this["prop.sub"] = value （ドットパス — OK）
 *   this.$api(...)           （API 呼び出し — OK）
 */
export function validateNestedAssigns(html: string, stateTagName: string = 'wcs-state'): NestedAssignDiagnostic[] {
  const blocks = parseWcsScriptBlocks(html, stateTagName);
  const diagnostics: NestedAssignDiagnostic[] = [];

  for (const block of blocks) {
    const blockDiags = findNestedAssigns(block.content, block.contentStart);
    diagnostics.push(...blockDiags);
  }

  return diagnostics;
}

/**
 * スクリプト内容からネスト代入パターンを検出する。
 */
function findNestedAssigns(script: string, baseOffset: number): NestedAssignDiagnostic[] {
  const diagnostics: NestedAssignDiagnostic[] = [];

  // this.X.Y...= を検出する正規表現
  // this.prop.sub = value のパターン（2段以上のドットアクセス + 代入）
  // ただし this["..."] = は除外（ブラケットアクセスは OK）
  // ==, ===, !=, !== は代入ではないので除外
  const regex = /\bthis\.(\w+)((?:\.\w+|\[\w+\])+)\s*=[^=]/g;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(script)) !== null) {
    const fullMatch = match[0];
    const topProp = match[1];
    const chainPart = match[2];

    // $ で始まるプロパティは API（$getAll 等）なのでスキップ
    if (topProp.startsWith('$')) continue;

    // チェーン部分にドットアクセスが含まれているか確認
    // （[index] のみの場合は配列アクセスなのでスキップ可能だが、
    //  .prop が1つでもあればネスト代入）
    if (!/\.\w+/.test(chainPart)) continue;

    const assignStart = baseOffset + match.index;
    const assignEnd = assignStart + fullMatch.length - 1; // -1 for the char after =

    // ドットパスの推奨形式を生成
    const dotPath = topProp + chainPart.replace(/\[(\w+)\]/g, '.$1').replace(/^\./,'');
    const suggestedPath = topProp + chainPart.replace(/\[(\w+)\]/g, '.$1');

    diagnostics.push({
      start: assignStart,
      end: assignEnd,
      message: `ネストされたプロパティへの代入はリアクティブ更新をトリガーしません。this["${suggestedPath}"] を使用してください。`,
      severity: 'warning',
    });
  }

  return diagnostics;
}
