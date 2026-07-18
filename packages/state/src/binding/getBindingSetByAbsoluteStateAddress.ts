import { IAbsoluteStateAddress } from "../address/types";
import { devtoolsSink } from "../devtools/sink";
import { IBindingInfo } from "./types";

/**
 * 絶対アドレス → 登録 binding の台帳。
 *
 * リスト行の絶対アドレスは (absolutePathInfo, listIndex) の組ごとに一意で、
 * 登録される binding は通常 1 本しかない。アドレスごとに Set を確保すると
 * 行×binding の数だけ Set アロケーションが積み上がるため、単一値で持ち
 * 2 本目から Set に昇格する（interestedSessionsByNode と同じ前例）。
 */
const bindingsByAbsoluteStateAddress: WeakMap<IAbsoluteStateAddress, IBindingInfo | Set<IBindingInfo>> = new WeakMap();

/**
 * 参照専用の取得。未登録アドレスにエントリを生成・キャッシュしない
 * （リスト置換の drain は大量のバインディング無しアドレスを照会するため、
 * 生成すると空エントリが溜まり続ける）。
 * 戻り値は単一 binding（登録 1 本）か Set（2 本以上）のどちらか。
 * 呼び出し側は Set を変異してはならない（instanceof で分岐できるよう
 * ReadonlySet でなく Set 型で返す）。
 */
export function peekBindingsByAbsoluteStateAddress(
  absoluteStateAddress: IAbsoluteStateAddress,
): IBindingInfo | Set<IBindingInfo> | undefined {
  return bindingsByAbsoluteStateAddress.get(absoluteStateAddress);
}

export function addBindingByAbsoluteStateAddress(absoluteStateAddress: IAbsoluteStateAddress, binding: IBindingInfo): void {
  const current = bindingsByAbsoluteStateAddress.get(absoluteStateAddress);
  if (typeof current === "undefined") {
    bindingsByAbsoluteStateAddress.set(absoluteStateAddress, binding);
  } else if (current instanceof Set) {
    current.add(binding);
  } else if (current !== binding) {
    bindingsByAbsoluteStateAddress.set(absoluteStateAddress, new Set([current, binding]));
  }
  if (devtoolsSink !== null) {
    devtoolsSink({ type: "state:binding-added", absoluteAddress: absoluteStateAddress, binding });
  }
}

export function clearBindingSetByAbsoluteStateAddress(absoluteStateAddress: IAbsoluteStateAddress): void {
  bindingsByAbsoluteStateAddress.delete(absoluteStateAddress);
  if (devtoolsSink !== null) {
    devtoolsSink({ type: "state:binding-cleared", absoluteAddress: absoluteStateAddress });
  }
}

export function removeBindingByAbsoluteStateAddress(absoluteStateAddress: IAbsoluteStateAddress, binding: IBindingInfo): void {
  const current = bindingsByAbsoluteStateAddress.get(absoluteStateAddress);
  if (typeof current === "undefined") {
    return;
  }
  if (current instanceof Set) {
    current.delete(binding);
  } else if (current === binding) {
    bindingsByAbsoluteStateAddress.delete(absoluteStateAddress);
  }
  if (devtoolsSink !== null) {
    devtoolsSink({ type: "state:binding-removed", absoluteAddress: absoluteStateAddress, binding });
  }
}
