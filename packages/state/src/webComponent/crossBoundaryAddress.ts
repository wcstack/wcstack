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

interface ICrossBoundaryEntry {
  readonly stateElement: IStateElement;
  readonly address: IStateAddress;
}

const stack: ICrossBoundaryEntry[] = [];

export function pushCrossBoundaryAddress(stateElement: IStateElement, address: IStateAddress): void {
  stack.push({ stateElement, address });
}

export function popCrossBoundaryAddress(): void {
  stack.pop();
}

/**
 * 越境直前のアドレスを取り出す。スタック最上位が「この state 要素の、このパスの
 * 読み書き」であるときだけ返す。ネストしたコンポーネントでは最内の越境が
 * 最上位になるため、同一性の照合だけで取り違えを防げる。
 */
export function getCrossBoundaryAddress(stateElement: IStateElement, path: string): IStateAddress | null {
  const entry = stack[stack.length - 1];
  if (typeof entry === "undefined") {
    return null;
  }
  if (entry.stateElement !== stateElement || entry.address.pathInfo.path !== path) {
    return null;
  }
  return entry.address;
}
