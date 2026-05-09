/**
 * `$commandTokens: ["a", "b", ...]` 配列宣言を解析し、宣言された名前群を Set で返す。
 *
 * 注入は行わず、proxy 側で `state.$command.<name>` として token を解決する設計。
 * （以前の実装は state 直下に各名前の getter を注入していたが、リアクティブ値との
 * 名前空間衝突を避け識別性を上げるため `$command` ネームスペース集約に切り替え。）
 *
 * 対応している宣言形式は **オブジェクトリテラル** のみ。
 * クラス本体に `static $commandTokens = [...]` を書く形式や、
 * クラスのプロトタイプ上の同名コマンドの検出は現状サポートしない。
 */

import { STATE_COMMAND_NAMESPACE_NAME, STATE_COMMAND_TOKENS_NAME } from "../define";
import { raiseError } from "../raiseError";
import { IState } from "../types";

export function processCommandTokensDeclaration(state: IState): Set<string> {
  const names = new Set<string>();
  const declared = (state as Record<string, unknown>)[STATE_COMMAND_TOKENS_NAME];
  if (typeof declared === "undefined") {
    return names;
  }
  if (!Array.isArray(declared)) {
    raiseError(`${STATE_COMMAND_TOKENS_NAME} must be an array of strings.`);
  }
  for (const name of declared) {
    if (typeof name !== "string" || name.length === 0) {
      raiseError(`${STATE_COMMAND_TOKENS_NAME} entries must be non-empty strings.`);
    }
    if (name === STATE_COMMAND_NAMESPACE_NAME) {
      raiseError(`${STATE_COMMAND_TOKENS_NAME} entry "${name}" conflicts with the reserved namespace name "${STATE_COMMAND_NAMESPACE_NAME}".`);
    }
    if (names.has(name)) {
      raiseError(`${STATE_COMMAND_TOKENS_NAME} entry "${name}" is duplicated.`);
    }
    names.add(name);
  }
  return names;
}
