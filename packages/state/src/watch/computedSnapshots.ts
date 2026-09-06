/**
 * watch/computedSnapshots.ts
 *
 * watch 対象の computed（getter）の「前回評価値」台帳
 * （docs/state-watch-hook-design.md §5）。
 *
 * getter は `setByAddress` を通らないので、スカラ書き込み用の旧値台帳
 * （watch/prevValues.ts）には載らない。`prev` を渡すには前回の評価値を
 * **バッチを跨いで**保持する必要があり、こちらは drain ごとにクリアしない。
 *
 * 寿命は stateElement 単位（WeakMap）。`_state` 再 set では宣言ごと作り直すため
 * 破棄する。切断では破棄しない —— 再接続時の初回評価が上書きするので、
 * 残っていても害がなく、registry を保持する扱いとも揃う。
 */

import type { IAbsoluteStateAddress } from "../address/types";
import type { IStateElement } from "../components/types";

const snapshotsByStateElement: WeakMap<IStateElement, Map<IAbsoluteStateAddress, unknown>> = new WeakMap();

export function getComputedSnapshot(
  stateElement: IStateElement,
  absAddress: IAbsoluteStateAddress,
): unknown {
  return snapshotsByStateElement.get(stateElement)?.get(absAddress);
}

export function setComputedSnapshot(
  stateElement: IStateElement,
  absAddress: IAbsoluteStateAddress,
  value: unknown,
): void {
  let snapshots = snapshotsByStateElement.get(stateElement);
  if (typeof snapshots === "undefined") {
    snapshots = new Map<IAbsoluteStateAddress, unknown>();
    snapshotsByStateElement.set(stateElement, snapshots);
  }
  snapshots.set(absAddress, value);
}

/** `_state` 再 set で宣言ごと作り直すときに破棄する */
export function clearComputedSnapshots(stateElement: IStateElement): void {
  snapshotsByStateElement.delete(stateElement);
}

export const __private__ = {
  snapshotsByStateElement,
};
