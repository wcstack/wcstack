
// WebComponent専用のキャッシュ
// outerState.tsからのアクセスで、これを返す

import { IAbsoluteStateAddress } from "../address/types";

const lastValueByAbsoluteStateAddress: WeakMap<IAbsoluteStateAddress, any> = new WeakMap();

export function setLastValueByAbsoluteStateAddress(absoluteStateAddress: IAbsoluteStateAddress, value: any): void {
  lastValueByAbsoluteStateAddress.set(absoluteStateAddress, value);
}

export function getLastValueByAbsoluteStateAddress(absoluteStateAddress: IAbsoluteStateAddress): any {
  return lastValueByAbsoluteStateAddress.get(absoluteStateAddress);
}
