import { createStateAddress } from "../address/StateAddress";
import { getListIndexByBindingInfo } from "../list/getListIndexByBindingInfo";
import { raiseError } from "../raiseError";
const stateAddressByBindingInfo = new WeakMap();
export function getStateAddressByBindingInfo(bindingInfo) {
    let stateAddress = null;
    stateAddress = stateAddressByBindingInfo.get(bindingInfo) || null;
    if (stateAddress !== null) {
        return stateAddress;
    }
    if (bindingInfo.statePathInfo.wildcardCount > 0) {
        const listIndex = getListIndexByBindingInfo(bindingInfo);
        if (listIndex === null) {
            raiseError(`Cannot resolve state address for binding with wildcard statePathName "${bindingInfo.statePathName}" because list index is null.`);
        }
        stateAddress = createStateAddress(bindingInfo.statePathInfo, listIndex);
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