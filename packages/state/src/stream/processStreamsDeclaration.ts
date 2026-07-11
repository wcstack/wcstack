/**
 * stream/processStreamsDeclaration.ts
 *
 * `$streams: { <name>: { args?, source, fold?, initial? } }` 宣言マップを解析し、
 * IStreamEntry を構築して streamRegistry に一括登録する
 * （docs/state-streams-design.md §1-1 / §1-2 / §1-3）。
 *
 * - バリデーション（§1-2）: 違反は raiseError。
 *   - 名前はフラットなプロパティ名のみ（空文字 / `.`（DELIMITER）/ `*`（WILDCARD）/ 先頭 `$` を禁止）。
 *   - getter / setter として宣言済みのパスとの衝突を禁止（getterPaths / setterPaths を検査）。
 *   - `source` は関数必須。`fold` は（あれば）関数。`fold` があるのに `initial` が無ければエラー
 *     （reduce は initial 必須。`initial` の有無は in 演算子で判定）。`args` は（あれば）関数。
 * - fold 省略時は latest（`(_acc, chunk) => chunk`）を注入する（§0 決定レコード）。
 * - 値プロパティ実体化（§1-3）: `state[name]` が未定義なら `initial`
 *   （fold 無しなら undefined）でデータプロパティとして初期化する。
 *   ユーザーが同名プロパティを先に宣言していた場合は上書きしない
 *   （起動時の initial リセットは streamRuntime 側の責務）。
 *
 * 呼び出しは stateElement.getterPaths / setterPaths の確定後であること
 * （State の `_state` セッターが getStateInfo の反映より後に呼ぶことで保証する）。
 */

import type { IStateElement } from "../components/types";
import { DELIMITER, STATE_STREAMS_NAME, WILDCARD } from "../define";
import { raiseError } from "../raiseError";
import type { IState } from "../types";
import { setStreamEntries } from "./streamRegistry";
import type { IStreamDefinition, IStreamEntry, StreamFold, StreamSource } from "./types";

/** fold 省略時に注入される既定 fold（latest = 最新チャンクで置換） */
const latestFold: StreamFold = (_acc, chunk) => chunk;

export function processStreamsDeclaration(stateElement: IStateElement, state: IState): void {
  const declared = (state as Record<string, unknown>)[STATE_STREAMS_NAME];
  if (typeof declared === "undefined") {
    return;
  }
  if (typeof declared !== "object" || declared === null) {
    raiseError(`${STATE_STREAMS_NAME} must be an object mapping stream names to stream definitions.`);
  }
  const entries = new Map<string, IStreamEntry>();
  for (const [name, def] of Object.entries(declared as Record<string, unknown>)) {
    if (name.length === 0) {
      raiseError(`${STATE_STREAMS_NAME} entry name must be a non-empty string.`);
    }
    if (name.includes(DELIMITER)) {
      raiseError(`${STATE_STREAMS_NAME} entry "${name}" must be a flat property name ("${DELIMITER}" is not allowed).`);
    }
    if (name.includes(WILDCARD)) {
      raiseError(`${STATE_STREAMS_NAME} entry "${name}" must be a flat property name ("${WILDCARD}" is not allowed).`);
    }
    if (name.startsWith("$")) {
      raiseError(`${STATE_STREAMS_NAME} entry "${name}" must not start with "$" (reserved namespace).`);
    }
    if (stateElement.getterPaths.has(name)) {
      raiseError(`${STATE_STREAMS_NAME} entry "${name}" conflicts with a getter declared on the state.`);
    }
    if (stateElement.setterPaths.has(name)) {
      raiseError(`${STATE_STREAMS_NAME} entry "${name}" conflicts with a setter declared on the state.`);
    }
    if (typeof def !== "object" || def === null) {
      raiseError(`${STATE_STREAMS_NAME} entry "${name}" must be an object ({ args?, source, fold?, initial? }).`);
    }
    const definition = def as Record<string, unknown>;
    if (typeof definition.source !== "function") {
      raiseError(`${STATE_STREAMS_NAME} entry "${name}" source must be a function.`);
    }
    const hasFold = typeof definition.fold !== "undefined";
    if (hasFold && typeof definition.fold !== "function") {
      raiseError(`${STATE_STREAMS_NAME} entry "${name}" fold must be a function.`);
    }
    if (hasFold && !("initial" in definition)) {
      raiseError(`${STATE_STREAMS_NAME} entry "${name}" requires "initial" when fold is specified (reduce needs a seed value).`);
    }
    const hasArgs = typeof definition.args !== "undefined";
    if (hasArgs && typeof definition.args !== "function") {
      raiseError(`${STATE_STREAMS_NAME} entry "${name}" args must be a function.`);
    }
    const entry: IStreamEntry = {
      name,
      definition: {
        args: (definition.args as IStreamDefinition["args"] | undefined) ?? null,
        source: definition.source as StreamSource,
        fold: (definition.fold as StreamFold | undefined) ?? latestFold,
        initial: definition.initial,
      },
      status: "idle",
      error: null,
      controller: null,
      depAddresses: new Set(),
    };
    // 値プロパティ実体化（§1-3）: ユーザーが同名プロパティを先に宣言していたら上書きしない
    if (!(name in state)) {
      state[name] = entry.definition.initial;
    }
    entries.set(name, entry);
  }
  setStreamEntries(stateElement, entries);
}
