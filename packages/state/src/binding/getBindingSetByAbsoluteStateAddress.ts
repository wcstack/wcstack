import { IAbsoluteStateAddress } from "../address/types";
import { IBindingInfo } from "./types";

const bindingSetByAbsoluteStateAddress: WeakMap<IAbsoluteStateAddress, Set<IBindingInfo>> = new WeakMap();

export function getBindingSetByAbsoluteStateAddress(absoluteStateAddress: IAbsoluteStateAddress): Set<IBindingInfo> {
  let bindingSet: Set<IBindingInfo> | null = null;
  bindingSet = bindingSetByAbsoluteStateAddress.get(absoluteStateAddress) || null;
  if (bindingSet === null) {
    bindingSet = new Set();
    bindingSetByAbsoluteStateAddress.set(absoluteStateAddress, bindingSet);
  }
  return bindingSet;
}

/**
 * 参照専用の取得。get-or-create と違い、未登録アドレスに空 Set を
 * 生成・キャッシュしない（リスト置換の drain は大量のバインディング無し
 * アドレスを照会するため、生成すると空 Set が溜まり続ける）。
 */
export function peekBindingSetByAbsoluteStateAddress(absoluteStateAddress: IAbsoluteStateAddress): ReadonlySet<IBindingInfo> | undefined {
  return bindingSetByAbsoluteStateAddress.get(absoluteStateAddress);
}

export function addBindingByAbsoluteStateAddress(absoluteStateAddress: IAbsoluteStateAddress, binding: IBindingInfo): void {
  const bindingSet = getBindingSetByAbsoluteStateAddress(absoluteStateAddress);
  bindingSet.add(binding);
}

export function clearBindingSetByAbsoluteStateAddress(absoluteStateAddress: IAbsoluteStateAddress): void {
  bindingSetByAbsoluteStateAddress.delete(absoluteStateAddress);
}

export function removeBindingByAbsoluteStateAddress(absoluteStateAddress: IAbsoluteStateAddress, binding: IBindingInfo): void {
  // get-or-create を通すと未登録アドレスに空 Set を生成してしまうため素の get で参照する
  const bindingSet = bindingSetByAbsoluteStateAddress.get(absoluteStateAddress);
  if (bindingSet !== undefined) {
    bindingSet.delete(binding);
  }
}