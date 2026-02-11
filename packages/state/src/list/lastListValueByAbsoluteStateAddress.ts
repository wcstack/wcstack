import { IAbsoluteStateAddress } from "../address/types";

const lastListValueByAbsoluteStateAddress: WeakMap<IAbsoluteStateAddress, readonly unknown[]> = new WeakMap();

export function getLastListValueByAbsoluteStateAddress(address: IAbsoluteStateAddress): readonly unknown[] {
  return lastListValueByAbsoluteStateAddress.get(address) ?? [];
}

export function setLastListValueByAbsoluteStateAddress(address: IAbsoluteStateAddress, value: readonly unknown[]): void {
  lastListValueByAbsoluteStateAddress.set(address, value);
}

export function clearLastListValueByAbsoluteStateAddress(address: IAbsoluteStateAddress): void {
  lastListValueByAbsoluteStateAddress.delete(address);
}

export function hasLastListValueByAbsoluteStateAddress(address: IAbsoluteStateAddress): boolean {
  return lastListValueByAbsoluteStateAddress.has(address);
}
