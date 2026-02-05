import { IAbsoluteStateAddress } from "../address/types";
import { IBindingInfo } from "./types";

const bindingInfosByAbsoluteStateAddress: WeakMap<IAbsoluteStateAddress, IBindingInfo[]> = new WeakMap();

export function getBindingInfosByAbsoluteStateAddress(absoluteStateAddress: IAbsoluteStateAddress): IBindingInfo[] {
  let bindingInfos: IBindingInfo[] | null = null;
  bindingInfos = bindingInfosByAbsoluteStateAddress.get(absoluteStateAddress) || null;
  if (bindingInfos === null) {
    bindingInfos = [];
    bindingInfosByAbsoluteStateAddress.set(absoluteStateAddress, bindingInfos);
  }
  return bindingInfos;
}

export function addBindingInfoByAbsoluteStateAddress(absoluteStateAddress: IAbsoluteStateAddress, bindingInfo: IBindingInfo): void {
  const bindingInfos = getBindingInfosByAbsoluteStateAddress(absoluteStateAddress);
  bindingInfos.push(bindingInfo);
}

export function clearBindingInfosByAbsoluteStateAddress(absoluteStateAddress: IAbsoluteStateAddress): void {
  bindingInfosByAbsoluteStateAddress.delete(absoluteStateAddress);
}

export function removeBindingInfoByAbsoluteStateAddress(absoluteStateAddress: IAbsoluteStateAddress, bindingInfo: IBindingInfo): void {
  const bindingInfos = getBindingInfosByAbsoluteStateAddress(absoluteStateAddress);
  const index = bindingInfos.indexOf(bindingInfo);
  if (index !== -1) {
    bindingInfos.splice(index, 1);
  }
}