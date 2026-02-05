import { applyChange } from "../apply/applyChange";
import { clearAbsoluteStateAddressByBindingInfo, getAbsoluteStateAddressByBindingInfo } from "../binding/getAbsoluteStateAddressByBindingInfo";
import { addBindingInfoByAbsoluteStateAddress, removeBindingInfoByAbsoluteStateAddress } from "../binding/getBindingInfosByAbsoluteStateAddress";
import { clearStateAddressByBindingInfo } from "../binding/getStateAddressByBindingInfo";
import { getBindingsByContent } from "../bindings/bindingsByContent";
import { bindLoopContextToContent, unbindLoopContextToContent } from "../bindings/bindLoopContextToContent";
export function activateContent(content, loopContext, state, stateName) {
    bindLoopContextToContent(content, loopContext);
    const bindings = getBindingsByContent(content);
    for (const binding of bindings) {
        const absoluteStateAddress = getAbsoluteStateAddressByBindingInfo(binding);
        addBindingInfoByAbsoluteStateAddress(absoluteStateAddress, binding);
        applyChange(binding, state, stateName);
    }
}
export function deactivateContent(content) {
    const bindings = getBindingsByContent(content);
    for (const binding of bindings) {
        const absoluteStateAddress = getAbsoluteStateAddressByBindingInfo(binding);
        removeBindingInfoByAbsoluteStateAddress(absoluteStateAddress, binding);
        clearAbsoluteStateAddressByBindingInfo(binding);
        clearStateAddressByBindingInfo(binding);
    }
    unbindLoopContextToContent(content);
}
//# sourceMappingURL=activateContent.js.map