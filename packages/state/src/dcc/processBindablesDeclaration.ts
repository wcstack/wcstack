/**
 * `$bindables: ["a", "b", ...]` 配列宣言を解析し、宣言された名前群を配列で返す。
 *
 * 検証の強度は `$commandTokens` / `$eventTokens` と揃える
 * （docs/architecture-hardening/15-state-component-mechanism-consistency.md §1.5 / §2.3）。
 * 従来は `Array.isArray(...) ? ... : []` だけで、
 *
 *   - 非配列を無言で空扱いにする
 *   - 重複名をそのまま `createWcBindable` に流す
 *   - `$` 始まりの名前を通す
 *
 * という 3 つの穴があった。特に重複は害が大きい: `readNamedList`（protocol/wcBindableReader.ts）は
 * 重複名を見つけると `null` を返すため、`readBindableDeclaration()` が宣言全体を棄却し、
 * 双方向バインド・spread・initialSync の bindable 判定が**警告なしで**丸ごと死ぬ。
 * 自前のファクトリが自前の reader に棄却される状態なので、生成前に落とす。
 *
 * `$` 始まりは `isInternalProperty` により DCC prototype にアクセサが生えないため、
 * 宣言だけが生きて要素側が expando を掴む。宣言時に落とす。
 *
 * なお「state に実在しない名前」は現時点では検証しない。`$streams` が生成する値プロパティは
 * インスタンス側の `bindProperty` で後から実体化され、`defineDCC` の時点では素の state
 * オブジェクト上に存在しないため、存在検査を入れると正当な組み合わせまで落としうる。
 * §2.3 の残件として doc 側に残す。
 */

import { STATE_BINDABLES_NAME } from "../define";
import { raiseError } from "../raiseError";
import { IState } from "../types";

export function processBindablesDeclaration(state: IState): string[] {
  const declared = (state as Record<string, unknown>)[STATE_BINDABLES_NAME];
  if (typeof declared === "undefined") {
    return [];
  }
  if (!Array.isArray(declared)) {
    raiseError(`${STATE_BINDABLES_NAME} must be an array of strings.`);
  }
  const names: string[] = [];
  const seen = new Set<string>();
  for (const name of declared) {
    if (typeof name !== "string" || name.length === 0) {
      raiseError(`${STATE_BINDABLES_NAME} entries must be non-empty strings.`);
    }
    if (name.startsWith("$")) {
      raiseError(`${STATE_BINDABLES_NAME} entry "${name}" must not start with "$" (internal properties are not exposed on the component).`);
    }
    if (seen.has(name)) {
      raiseError(`${STATE_BINDABLES_NAME} entry "${name}" is duplicated.`);
    }
    seen.add(name);
    names.push(name);
  }
  return names;
}
