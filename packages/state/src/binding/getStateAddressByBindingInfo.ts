import { createStateAddress } from "../address/StateAddress";
import { IStateAddress } from "../address/types";
import { getLoopContextByNode } from "../list/loopContextByNode";
import { raiseError } from "../raiseError";
import { IBindingInfo } from "../types";

const stateAddressByBindingInfo: WeakMap<IBindingInfo, IStateAddress> = new WeakMap();

export function getStateAddressByBindingInfo(bindingInfo: IBindingInfo) {
  let stateAddress: IStateAddress | null = null;
  stateAddress = stateAddressByBindingInfo.get(bindingInfo) || null;
  if (stateAddress !== null) {
    return stateAddress;
  }
  if (bindingInfo.statePathInfo === null) {
    raiseError(`State path info is null for binding with statePathName "${bindingInfo.statePathName}".`);
  }
  if (bindingInfo.statePathInfo.wildcardCount > 0) {
    const loopContext = getLoopContextByNode(bindingInfo.node);
    if (loopContext === null) {
      raiseError(`Cannot resolve state address for binding with wildcard statePathName "${bindingInfo.statePathName}" because loop context is null.`);
    }
    stateAddress = createStateAddress(bindingInfo.statePathInfo, loopContext.listIndex);
  } else {
    stateAddress = createStateAddress(bindingInfo.statePathInfo, null);
  }
  stateAddressByBindingInfo.set(bindingInfo, stateAddress);
  return stateAddress;
}
