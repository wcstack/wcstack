import { getLoopContextByNode } from "../list/loopContextByNode";
import { raiseError } from "../raiseError";
import { getStateElementByName } from "../stateElementByName";
import { applyChange } from "./applyChange";
export function applyChangeFromBindings(bindingInfos) {
    for (const bindingInfo of bindingInfos) {
        const stateElement = getStateElementByName(bindingInfo.stateName);
        if (stateElement === null) {
            raiseError(`State element with name "${bindingInfo.stateName}" not found for binding.`);
        }
        stateElement.createState("readonly", (state) => {
            const loopContext = getLoopContextByNode(bindingInfo.node);
            const newValue = state.$$setLoopContext(loopContext, () => {
                return state[bindingInfo.statePathName];
            });
            applyChange(bindingInfo, newValue);
        });
    }
}
//# sourceMappingURL=applyChangeFromBindings.js.map