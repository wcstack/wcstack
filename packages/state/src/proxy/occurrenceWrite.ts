/**
 * occurrenceWrite.ts
 *
 * 要素（wc-bindable の出力・双方向バインドの要素）から届いた値を state へ書き込む 1 write に、
 * その出どころを伝える one-shot トークン。
 *
 * 1. occurrence（wc-bindable の `semantics: "event"`）は same-value guard（`config.sameValueGuard`・
 *    既定 ON）を 1 回分だけ飛ばす。
 *    same-value guard は primitive が `Object.is` 同値なら set / enqueue / 依存伝播 / DOM 適用 /
 *    `$updatedCallback` をまるごとスキップする。current value（state）にとっては正しい最適化だが、
 *    occurrence（同じ payload でも「もう一度起きた」ことに意味がある）へ適用すると発生を取りこぼす。
 *    どちらであるかは producer の declaration が `semantics` で宣言する
 *    （docs/architecture-hardening/12-wc-bindable-observable-inventory.md）。
 * 2. 要素から来た書き込みはどれも、リストの要素（`for` の行そのもの — `status: .`）へ書いても入れ替え
 *    （#4 の同一性モデル）として扱わない。要素が自分の行へ出す値は「その行の値の更新」で、別の行との
 *    入れ替えではない。入れ替えとして扱うと、同じ値から進む行が別の行と入れ替わり、以後の出力が別の行に
 *    届いた（#337）。
 *
 * one-shot にしている理由:
 * フラグを書き込みの呼び出しスタック全体へ張ると、その内側で走る `$updatedCallback` や
 * 依存伝播が行う無関係な書き込みまで巻き込む。`setByAddress` が最初のガード評価で
 * トークンを消費するため、影響は目的の 1 write に閉じる。
 */

import type { IStateElement } from "../components/types";
import type { ILoopContext } from "../list/types";
import { setLoopContextSymbol } from "./symbols";

let pending = 0;

/**
 * 要素から届いた値を、その要素の行の文脈で state へ書く（双方向バインドの commit と初期同期）。
 * `occurrence` なら同値ガードも飛ばす。書き込みが setByAddress へ届かなくても、トークンはここで破棄する。
 */
export function commitElementValue(
  stateElement: IStateElement,
  loopContext: ILoopContext | null,
  statePathName: string,
  value: unknown,
  occurrence = false,
): void {
  pending = occurrence ? 2 : 1;
  try {
    stateElement.createState("writable", (state) => {
      state[setLoopContextSymbol](loopContext, () => {
        state[statePathName] = value;
      });
    });
  } finally {
    pending = 0;
  }
}

/**
 * ガード評価側が呼ぶ。0 = 要素から来ていない、1 = 要素から来た、2 = 要素から来た occurrence。
 * トークンは呼んだ時点で消費される。
 */
export function consumeElementWrite(): number {
  const consumed = pending;
  pending = 0;
  return consumed;
}
