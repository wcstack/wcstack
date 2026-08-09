/**
 * webComponent/crossBoundaryAddress.ts
 *
 * mapped な `bind-component` の state は innerState proxy を target に持つ。
 * そこへの読み書きは `Reflect.get/set(target, path)` で行われるため、Proxy の
 * トラップに渡るのは**パス文字列だけ**で、解決済みの listIndex が落ちる。
 *
 * 子スコープが `for:` でマップ先の配列を回している場合、行バインディングが読む
 * `items.*.name` は親スコープの `rows.*.name` に翻訳されるが、どの行かは listIndex
 * にしか無い。ループ文脈はコンポーネント要素（親スコープ側）にぶら下がっており、
 * 子スコープのループはコンポーネントの内側なので `getLoopContextByNode` では引けない
 * （docs/architecture-hardening/15-state-component-mechanism-consistency.md §1.8）。
 *
 * そこで越境直前のアドレスを動的スコープで受け渡す。push/pop するのは
 * `hasMappedComponentState` が真の state 要素の読み書きだけで、通常の state の
 * ホットパス（getByAddress / setByAddress）には一切載らない。
 */

import { IStateAddress } from "../address/types";
import { IStateElement } from "../components/types";

// 行ごとの読み書きで通るため、エントリオブジェクトを割り当てずに 2 本の並行配列で持つ
// （リスト描画は「行数 × 行内バインディング数」回ここを通る）。
const stateElementStack: (IStateElement | undefined)[] = [];
const addressStack: (IStateAddress | undefined)[] = [];
let depth = 0;

export function pushCrossBoundaryAddress(stateElement: IStateElement, address: IStateAddress): void {
  stateElementStack[depth] = stateElement;
  addressStack[depth] = address;
  depth++;
}

export function popCrossBoundaryAddress(): void {
  depth--;
  // 参照を残さない（state 要素・listIndex を保持し続けないため）
  stateElementStack[depth] = undefined;
  addressStack[depth] = undefined;
}

/**
 * 越境直前のアドレスを取り出す。スタック最上位が「この state 要素の、このパスの
 * 読み書き」であるときだけ返す。ネストしたコンポーネントでは最内の越境が
 * 最上位になるため、同一性の照合だけで取り違えを防げる。
 */
export function getCrossBoundaryAddress(stateElement: IStateElement, path: string): IStateAddress | null {
  if (depth === 0) {
    return null;
  }
  const top = depth - 1;
  const address = addressStack[top];
  if (stateElementStack[top] !== stateElement || address?.pathInfo.path !== path) {
    return null;
  }
  return address;
}
