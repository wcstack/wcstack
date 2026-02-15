import { applyChange } from "../apply/applyChange";
import { clearAbsoluteStateAddressByBinding, getAbsoluteStateAddressByBinding } from "../binding/getAbsoluteStateAddressByBinding";
import { addBindingByAbsoluteStateAddress, removeBindingByAbsoluteStateAddress } from "../binding/getBindingSetByAbsoluteStateAddress";
import { clearStateAddressByBindingInfo } from "../binding/getStateAddressByBindingInfo";
import { getBindingsByContent } from "../bindings/bindingsByContent";
import { bindLoopContextToContent, unbindLoopContextToContent } from "../bindings/bindLoopContextToContent";
export function activateContent(content, loopContext, context) {
    bindLoopContextToContent(content, loopContext);
    const bindings = getBindingsByContent(content);
    for (const binding of bindings) {
        const absoluteStateAddress = getAbsoluteStateAddressByBinding(binding);
        addBindingByAbsoluteStateAddress(absoluteStateAddress, binding);
        applyChange(binding, context);
    }
}
export function deactivateContent(content) {
    const bindings = getBindingsByContent(content);
    for (const binding of bindings) {
        const absoluteStateAddress = getAbsoluteStateAddressByBinding(binding);
        removeBindingByAbsoluteStateAddress(absoluteStateAddress, binding);
        clearAbsoluteStateAddressByBinding(binding);
        clearStateAddressByBindingInfo(binding);
    }
    unbindLoopContextToContent(content);
}
//# sourceMappingURL=activateContent.js.map