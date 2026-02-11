import { getLoopContextByNode } from "../list/loopContextByNode";
import { setLoopContextSymbol } from "../proxy/symbols";
import { raiseError } from "../raiseError";
import { getStateElementByName } from "../stateElementByName";
import { bindSymbol } from "./symbols";
const getterFn = (binding) => {
    const rootNode = binding.replaceNode.getRootNode();
    const outerStateElement = getStateElementByName(rootNode, binding.stateName);
    if (outerStateElement === null) {
        raiseError(`State element with name "${binding.stateName}" not found for binding.`);
    }
    const outerName = binding.statePathName;
    return () => {
        let value = undefined;
        const loopContext = getLoopContextByNode(binding.node);
        outerStateElement.createState("readonly", (state) => {
            state[setLoopContextSymbol](loopContext, () => {
                value = state[outerName];
            });
        });
        return value;
    };
};
const setterFn = (binding) => {
    const rootNode = binding.replaceNode.getRootNode();
    const outerStateElement = getStateElementByName(rootNode, binding.stateName);
    if (outerStateElement === null) {
        raiseError(`State element with name "${binding.stateName}" not found for binding.`);
    }
    const outerName = binding.statePathName;
    return (v) => {
        const loopContext = getLoopContextByNode(binding.node);
        outerStateElement.createState("writable", (state) => {
            state[setLoopContextSymbol](loopContext, () => {
                state[outerName] = v;
            });
        });
    };
};
class InnerState {
    constructor() {
    }
    [bindSymbol](binding) {
        const innerName = binding.propSegments.slice(1).join('.');
        Object.defineProperty(this, innerName, {
            get: getterFn(binding),
            set: setterFn(binding),
            enumerable: true,
            configurable: true,
        });
    }
}
export function createInnerState() {
    return new InnerState();
}
//# sourceMappingURL=innerState.js.map