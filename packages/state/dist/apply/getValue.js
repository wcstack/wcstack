import { getStateAddressByBindingInfo } from "../binding/getStateAddressByBindingInfo";
export function getValue(state, bindingInfo) {
    const stateAddress = getStateAddressByBindingInfo(bindingInfo);
    return state.$$getByAddress(stateAddress);
}
//# sourceMappingURL=getValue.js.map