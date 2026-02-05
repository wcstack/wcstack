import { createAbsoluteStateAddress } from "../address/AbsoluteStateAddress";
import { getStateAddressByBindingInfo } from "./getStateAddressByBindingInfo";
const absoluteStateAddressByBindingInfo = new WeakMap();
export function getAbsoluteStateAddressByBindingInfo(bindingInfo) {
    let absoluteStateAddress = null;
    absoluteStateAddress = absoluteStateAddressByBindingInfo.get(bindingInfo) || null;
    if (absoluteStateAddress !== null) {
        return absoluteStateAddress;
    }
    const stateAddress = getStateAddressByBindingInfo(bindingInfo);
    absoluteStateAddress = createAbsoluteStateAddress(bindingInfo.stateName, stateAddress);
    absoluteStateAddressByBindingInfo.set(bindingInfo, absoluteStateAddress);
    return absoluteStateAddress;
}
export function clearAbsoluteStateAddressByBindingInfo(bindingInfo) {
    absoluteStateAddressByBindingInfo.delete(bindingInfo);
}
//# sourceMappingURL=getAbsoluteStateAddressByBindingInfo.js.map