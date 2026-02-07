import { getStateAddressByBindingInfo } from "../binding/getStateAddressByBindingInfo";
import { INDEX_BY_INDEX_NAME } from "../define";
import { getIndexValueByLoopContext } from "../list/getIndexValueByLoopContext";
import { getLoopContextByNode } from "../list/loopContextByNode";
import { raiseError } from "../raiseError";
export function getValue(state, binding) {
    const stateAddress = getStateAddressByBindingInfo(binding);
    if (stateAddress.pathInfo.path in INDEX_BY_INDEX_NAME) {
        const loopContext = getLoopContextByNode(binding.node);
        if (loopContext === null) {
            raiseError(`ListIndex not found for binding: ${binding.statePathName}`);
        }
        return getIndexValueByLoopContext(loopContext, stateAddress.pathInfo.path);
    }
    else {
        return state.$$getByAddress(stateAddress);
    }
}
//# sourceMappingURL=getValue.js.map