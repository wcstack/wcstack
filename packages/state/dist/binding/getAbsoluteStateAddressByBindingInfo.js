import { createAbsoluteStateAddress } from "../address/AbsoluteStateAddress";
import { getListIndexByBindingInfo } from "../list/getListIndexByBindingInfo";
const absoluteStateAddressByBindingInfo = new WeakMap();
export function getAbsoluteStateAddressByBindingInfo(bindingInfo) {
    let absoluteStateAddress = null;
    absoluteStateAddress = absoluteStateAddressByBindingInfo.get(bindingInfo) || null;
    if (absoluteStateAddress !== null) {
        return absoluteStateAddress;
    }
    const listIndex = getListIndexByBindingInfo(bindingInfo);
    absoluteStateAddress =
        createAbsoluteStateAddress(bindingInfo.stateAbsolutePathInfo, listIndex);
    absoluteStateAddressByBindingInfo.set(bindingInfo, absoluteStateAddress);
    return absoluteStateAddress;
}
export function clearAbsoluteStateAddressByBindingInfo(bindingInfo) {
    absoluteStateAddressByBindingInfo.delete(bindingInfo);
}
//# sourceMappingURL=getAbsoluteStateAddressByBindingInfo.js.map