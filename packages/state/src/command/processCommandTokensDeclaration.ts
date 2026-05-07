/**
 * `$commandTokens: ["a", "b", ...]` 配列宣言を処理し、
 * state 直下に `this.$commandToken(name)` を返す getter を注入する。
 *
 * 対応している宣言形式は **オブジェクトリテラル** のみ。
 * クラス本体に `static $commandTokens = [...]` を書く形式や、
 * クラスのプロトタイプ上の同名コマンドの検出は現状サポートしない。
 *
 * getter は `enumerable: false` で注入するため、
 * Object.keys / for-in / JSON.stringify には現れない。
 */

import { STATE_COMMAND_TOKENS_NAME } from "../define";
import { raiseError } from "../raiseError";
import { IState } from "../types";

export function processCommandTokensDeclaration(state: IState): void {
  const declared = (state as Record<string, unknown>)[STATE_COMMAND_TOKENS_NAME];
  if (typeof declared === "undefined") {
    return;
  }
  if (!Array.isArray(declared)) {
    raiseError(`${STATE_COMMAND_TOKENS_NAME} must be an array of strings.`);
  }
  for (const name of declared) {
    if (typeof name !== "string" || name.length === 0) {
      raiseError(`${STATE_COMMAND_TOKENS_NAME} entries must be non-empty strings.`);
    }
    if (name in state) {
      raiseError(`${STATE_COMMAND_TOKENS_NAME} entry "${name}" conflicts with an existing state property (own or inherited, including Object.prototype methods like "toString" / "hasOwnProperty").`);
    }
    Object.defineProperty(state, name, {
      get(this: IState): unknown {
        return this.$commandToken(name);
      },
      configurable: true,
      enumerable: false,
    });
  }
}
