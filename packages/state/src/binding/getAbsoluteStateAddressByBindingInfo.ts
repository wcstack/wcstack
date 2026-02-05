import { createAbsoluteStateAddress } from "../address/AbsoluteStateAddress";
import { IAbsoluteStateAddress } from "../address/types";
import { getStateAddressByBindingInfo } from "./getStateAddressByBindingInfo";
import { IBindingInfo } from "./types";

const absoluteStateAddressByBindingInfo: WeakMap<IBindingInfo, IAbsoluteStateAddress> = new WeakMap();

export function getAbsoluteStateAddressByBindingInfo(bindingInfo: IBindingInfo) {
  let absoluteStateAddress: IAbsoluteStateAddress | null = null;
  absoluteStateAddress = absoluteStateAddressByBindingInfo.get(bindingInfo) || null;
  if (absoluteStateAddress !== null) {
    return absoluteStateAddress;
  }
  const stateAddress = getStateAddressByBindingInfo(bindingInfo);
  absoluteStateAddress = createAbsoluteStateAddress(bindingInfo.stateName, stateAddress);
  absoluteStateAddressByBindingInfo.set(bindingInfo, absoluteStateAddress);
  return absoluteStateAddress;
}

export function clearAbsoluteStateAddressByBindingInfo(bindingInfo: IBindingInfo) {
  absoluteStateAddressByBindingInfo.delete(bindingInfo);
}