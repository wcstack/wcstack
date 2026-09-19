import { IStateElement } from "../components/types";
import { IListIndex } from "../list/types";
import { createAbsoluteStateAddress } from "./AbsoluteStateAddress";
import { getTreePath } from "./TreePath";
import { IAbsoluteStateAddress, IPathInfo, IStateAddress } from "./types";

/**
 * ツリー非依存のアドレスを、`stateElement`（どのツリーか）まで確定した絶対アドレスへ持ち上げる。
 *
 * 恒久台帳（cache / bindings / baseline / updater の queue）はモジュール単一でツリーをまたぐので、
 * キーは必ずこちらを使う — `IStateAddress` をそのままキーにすると、同じパス形状や同じ配列を持つ
 * 2 つの `<wcs-state>` が混線する（__tests__/addressLedgerKeyGuard.test.ts が番人）。
 *
 * 持ち上げは選択の余地が無い決定的な変換で、以前は各呼び出し元が 2 行で手書きしていた。
 * ここに集めて、intern の関数（getTreePath / createAbsoluteStateAddress）を src/address/ の外から
 * 直接呼ばせない（__tests__/addressImportBoundary.test.ts が番人）。2 本の型を 1 本に畳む統合
 * （docs/state-address-unification-design.md）は、素のパスの読みを退行させることが実測で分かり、
 * 閉じた（同 §12）— この持ち上げは残る。
 */
export function liftAddress(stateElement: IStateElement, address: IStateAddress): IAbsoluteStateAddress {
  return createAbsoluteStateAddress(getTreePath(stateElement, address.pathInfo), address.listIndex);
}

/** `IStateAddress` を経ずに、構成要素から直接絶対アドレスを作る。 */
export function absoluteAddressOf(
  stateElement: IStateElement,
  pathInfo: IPathInfo,
  listIndex: IListIndex | null,
): IAbsoluteStateAddress {
  return createAbsoluteStateAddress(getTreePath(stateElement, pathInfo), listIndex);
}
