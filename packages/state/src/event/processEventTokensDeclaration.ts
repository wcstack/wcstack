/**
 * `$eventTokens: ["a", "b", ...]` 配列宣言を解析し、宣言された名前群を Set で返す。
 *
 * event-token は command-token の双対（element→state 方向）。要素が dispatch する
 * イベントを `eventToken.<prop>: <name>` で token に流し、state 側は `$on` マップで受ける。
 * ここで宣言された名前のみが `eventToken.X` / `$on` の有効なチャネル名になる（typo 耐性）。
 *
 * 対応している宣言形式は **オブジェクトリテラル** のみ。
 */

import { STATE_EVENT_TOKENS_NAME } from "../define";
import { raiseError } from "../raiseError";
import { IState } from "../types";

export function processEventTokensDeclaration(state: IState): Set<string> {
  const names = new Set<string>();
  const declared = (state as Record<string, unknown>)[STATE_EVENT_TOKENS_NAME];
  if (typeof declared === "undefined") {
    return names;
  }
  if (!Array.isArray(declared)) {
    raiseError(`${STATE_EVENT_TOKENS_NAME} must be an array of strings.`);
  }
  for (const name of declared) {
    if (typeof name !== "string" || name.length === 0) {
      raiseError(`${STATE_EVENT_TOKENS_NAME} entries must be non-empty strings.`);
    }
    if (names.has(name)) {
      raiseError(`${STATE_EVENT_TOKENS_NAME} entry "${name}" is duplicated.`);
    }
    names.add(name);
  }
  return names;
}
