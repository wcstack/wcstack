import { createStateAddress } from "../address/StateAddress";
import { getLoopContextByNode } from "../list/loopContextByNode";
import { raiseError } from "../raiseError";
const stateAddressByBindingInfo = new WeakMap();
export function getStateAddressByBindingInfo(bindingInfo) {
    let stateAddress = null;
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
    }
    else {
        stateAddress = createStateAddress(bindingInfo.statePathInfo, null);
    }
    stateAddressByBindingInfo.set(bindingInfo, stateAddress);
    return stateAddress;
}
// call for change loopContext
export function clearStateAddressByBindingInfo(bindingInfo) {
    stateAddressByBindingInfo.delete(bindingInfo);
}
//# sourceMappingURL=getStateAddressByBindingInfo.js.map