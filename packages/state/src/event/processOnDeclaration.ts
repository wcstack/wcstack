/**
 * `$on: { <name>: (state, event, ...listIndexes) => {...} }` マップを解析し、
 * 各ハンドラを対応する event-token に subscribe する（state 側の受信配線）。
 *
 * - `$on` のキーは `$eventTokens` で宣言済みでなければならない（typo 耐性）。
 * - 各値は関数でなければならない。
 * - 引数規約は `(state, event, ...listIndexes)`。`this` 束縛は行わず引数で state を渡すため
 *   アロー関数で書ける（command-token の emit 規約と対称）。
 *
 * `$eventTokens` で宣言されたが `$on` に対応が無い token は subscriber ゼロ（emit は no-op）。
 */

import { IStateElement } from "../components/types";
import { STATE_ON_NAME } from "../define";
import { raiseError } from "../raiseError";
import { IState } from "../types";
import { TokenSubscriber } from "../token/Token";
import { getOrCreateEventToken } from "./eventTokenRegistry";

export function processOnDeclaration(
  stateElement: IStateElement,
  state: IState,
  eventTokenNames: ReadonlySet<string>,
): void {
  const declared = (state as Record<string, unknown>)[STATE_ON_NAME];
  if (typeof declared === "undefined") {
    return;
  }
  if (typeof declared !== "object" || declared === null) {
    raiseError(`${STATE_ON_NAME} must be an object mapping event-token names to handler functions.`);
  }
  for (const [name, handler] of Object.entries(declared as Record<string, unknown>)) {
    if (!eventTokenNames.has(name)) {
      raiseError(`${STATE_ON_NAME} entry "${name}" is not declared in $eventTokens.`);
    }
    if (typeof handler !== "function") {
      raiseError(`${STATE_ON_NAME} entry "${name}" must be a function.`);
    }
    const token = getOrCreateEventToken(stateElement, name);
    token.subscribe(handler as TokenSubscriber);
  }
}
