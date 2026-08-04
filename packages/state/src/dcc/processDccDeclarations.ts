/**
 * DCC の `$bindables` / `$commands` 宣言を解析・検証する。
 *
 * 検証の強度は `$commandTokens` / `$eventTokens` と揃える
 * （docs/architecture-hardening/15-state-component-mechanism-consistency.md §1.5 / §2.3 / §1.6）。
 * 従来 `$bindables` は `Array.isArray(...) ? ... : []` だけで、
 *
 *   - 非配列を無言で空扱いにする
 *   - 重複名をそのまま `createWcBindable` に流す
 *   - `$` 始まりの名前を通す
 *   - state に存在しない名前を通す
 *
 * という 4 つの穴があった。特に重複は害が大きい: `readNamedList`（protocol/wcBindableReader.ts）は
 * 重複名を見つけると `null` を返すため、`readBindableDeclaration()` が宣言全体を棄却し、
 * 双方向バインド・spread・initialSync の bindable 判定が**警告なしで**丸ごと死ぬ。
 * 自前のファクトリが自前の reader に棄却される状態なので、生成前に落とす。
 */

import { STATE_BINDABLES_NAME, STATE_COMMANDS_NAME, STATE_STREAMS_NAME } from "../define";
import { getAllPropertyDescriptors } from "../getAllPropertyDescriptors";
import { raiseError } from "../raiseError";
import { IState } from "../types";

function readNameList(state: IState, declarationName: string): string[] | null {
  const declared = (state as Record<string, unknown>)[declarationName];
  if (typeof declared === "undefined") {
    return null;
  }
  if (!Array.isArray(declared)) {
    raiseError(`${declarationName} must be an array of strings.`);
  }
  const names: string[] = [];
  const seen = new Set<string>();
  for (const name of declared) {
    if (typeof name !== "string" || name.length === 0) {
      raiseError(`${declarationName} entries must be non-empty strings.`);
    }
    if (name.startsWith("$")) {
      raiseError(`${declarationName} entry "${name}" must not start with "$" (internal properties are not exposed on the component).`);
    }
    if (seen.has(name)) {
      raiseError(`${declarationName} entry "${name}" is duplicated.`);
    }
    seen.add(name);
    names.push(name);
  }
  return names;
}

/**
 * `$streams` が宣言している名前。値プロパティはインスタンス側の実体化まで state 上に
 * 現れないため、存在検査ではここも「実在する名前」として扱う（§2.3）。
 * 宣言そのものの妥当性検査は processStreamsDeclaration の責務なので、ここでは
 * キーの取り出しだけを行い、形が違えば黙って空集合を返す。
 */
function getStreamNames(state: IState): Set<string> {
  const declared = (state as Record<string, unknown>)[STATE_STREAMS_NAME];
  if (typeof declared !== "object" || declared === null) {
    return new Set<string>();
  }
  return new Set(Object.keys(declared));
}

export interface IDccDeclarations {
  /** 観測可能プロパティ。DCC prototype には getter/setter が生える */
  readonly bindables: string[];
  /** 起動可能メソッド。DCC prototype にはメソッドが生える */
  readonly commands: string[];
  /** `$streams` 由来でアクセサを追加生成すべき名前（state 上に descriptor が無いもの） */
  readonly streamBackedBindables: string[];
}

export function processDccDeclarations(state: IState): IDccDeclarations {
  const bindables = readNameList(state, STATE_BINDABLES_NAME) ?? [];
  const commands = readNameList(state, STATE_COMMANDS_NAME) ?? [];

  const descriptors = getAllPropertyDescriptors(state);
  const streamNames = getStreamNames(state);
  const streamBackedBindables: string[] = [];

  for (const name of bindables) {
    const descriptor = descriptors[name];
    if (typeof descriptor === "undefined") {
      // `$streams` 由来なら実体化後に現れるので通す。アクセサはこちらで補う。
      if (streamNames.has(name)) {
        streamBackedBindables.push(name);
        continue;
      }
      raiseError(`${STATE_BINDABLES_NAME} entry "${name}" is not declared on the state.`);
    }
    if (typeof descriptor.value === "function") {
      raiseError(`${STATE_BINDABLES_NAME} entry "${name}" is a method. Declare it in ${STATE_COMMANDS_NAME} instead.`);
    }
  }

  for (const name of commands) {
    const descriptor = descriptors[name];
    if (typeof descriptor === "undefined") {
      raiseError(`${STATE_COMMANDS_NAME} entry "${name}" is not declared on the state.`);
    }
    if (typeof descriptor.value !== "function") {
      raiseError(`${STATE_COMMANDS_NAME} entry "${name}" is not a method. Declare it in ${STATE_BINDABLES_NAME} instead.`);
    }
  }

  return { bindables, commands, streamBackedBindables };
}
