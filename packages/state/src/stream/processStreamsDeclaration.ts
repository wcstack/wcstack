/**
 * stream/processStreamsDeclaration.ts
 *
 * `$streams: { <name>: { args?, source, fold?, initial? } }` 宣言マップを解析し、
 * IStreamEntry を構築して streamRegistry に一括登録する
 * （docs/state-streams-design.md §1-1 / §1-2 / §1-3）。
 *
 * - バリデーション（§1-2）: 違反は raiseError。
 *   - 名前はフラットなプロパティ名のみ（空文字 / `.`（DELIMITER）/ `*`（WILDCARD）/ 先頭 `$` を禁止）。
 *   - Object.prototype の継承名（`__proto__` / `constructor` / `toString` 等）を禁止
 *     （own key でなくても `in` 判定が真になり、実体化 skip ＋ 起動時 Reflect.set の
 *      継承 setter 化 — `__proto__` は prototype 差し替え — を引き起こすため）。
 *   - getter / setter として宣言済みのパスとの衝突を禁止（getterPaths / setterPaths を検査）。
 *   - `source` は関数必須。`fold` は（あれば）関数。`fold` があるのに `initial` が無ければエラー
 *     （reduce は initial 必須。`initial` の有無は in 演算子で判定）。`args` は（あれば）関数。
 * - fold 省略時は latest（`(_acc, chunk) => chunk`）を注入する（§0 決定レコード）。
 * - 値プロパティ実体化（§1-3）: `state[name]` が未定義なら `initial`
 *   （fold 無しなら undefined）でデータプロパティとして初期化する。
 *   ユーザーが同名プロパティを先に宣言していた場合は上書きしない
 *   （起動時の initial リセットは streamRuntime 側の責務）。
 * - 通知 dedup 台帳の prune（§4-3）: 新宣言に存在しない名前の lastNotified エントリを
 *   削除する（台帳は stateElement 寿命 — 再 set 跨ぎ dedup が必要なのは同名のみ）。
 *
 * 呼び出しは stateElement.getterPaths / setterPaths の確定後であること
 * （State の `_state` セッターが getStateInfo の反映より後に呼ぶことで保証する）。
 */

import type { IStateElement } from "../components/types";
import { DELIMITER, STATE_STREAMS_NAME, WILDCARD } from "../define";
import { raiseError } from "../raiseError";
import type { IState } from "../types";
import { pruneLastNotified } from "./lastNotified";
import { setStreamEntries } from "./streamRegistry";
import type { IStreamDefinition, IStreamEntry, StreamFold, StreamSource } from "./types";

/** fold 省略時に注入される既定 fold（latest = 最新チャンクで置換） */
const latestFold: StreamFold = (_acc, chunk) => chunk;

/** `$streams` 無し宣言の prune 用（旧宣言の全名前が残骸になる） */
const NO_STREAM_NAMES: ReadonlySet<string> = new Set<string>();

export function processStreamsDeclaration(stateElement: IStateElement, state: IState): void {
  const declared = (state as Record<string, unknown>)[STATE_STREAMS_NAME];
  if (typeof declared === "undefined") {
    // $streams 無しの再 set でも旧宣言の名前は通知 dedup 台帳の残骸になるため prune する
    pruneLastNotified(stateElement, NO_STREAM_NAMES);
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
    // Object.prototype の継承名（__proto__ / constructor / toString 等）は一律拒否する。
    // own key でないのに `name in state` が真になるため実体化（§1-3）が skip され、
    // 起動時の initial リセット（Reflect.set）が継承 setter に化ける
    // （特に __proto__ は state の prototype を差し替える）ため、名前検査の防衛線で落とす（§1-2）。
    if (name in Object.prototype) {
      raiseError(`${STATE_STREAMS_NAME} entry "${name}" must not be a property name inherited from Object.prototype (e.g. "__proto__", "constructor").`);
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
  // 新宣言に存在しない名前の通知 dedup 台帳エントリを prune する
  // （同名は保持 = §4-3 の再 set 跨ぎ dedup 契約を維持。stream/lastNotified.ts 参照）
  pruneLastNotified(stateElement, new Set(entries.keys()));
}
