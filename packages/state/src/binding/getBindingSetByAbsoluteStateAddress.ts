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

export function addBindingByAbsoluteStateAddress(absoluteStateAddress: IAbsoluteStateAddress, binding: IBindingInfo): void {
  const bindingSet = getBindingSetByAbsoluteStateAddress(absoluteStateAddress);
  bindingSet.add(binding);
}

export function clearBindingSetByAbsoluteStateAddress(absoluteStateAddress: IAbsoluteStateAddress): void {
  bindingSetByAbsoluteStateAddress.delete(absoluteStateAddress);
}

export function removeBindingByAbsoluteStateAddress(absoluteStateAddress: IAbsoluteStateAddress, binding: IBindingInfo): void {
  const bindingSet = getBindingSetByAbsoluteStateAddress(absoluteStateAddress);
  bindingSet.delete(binding);
}