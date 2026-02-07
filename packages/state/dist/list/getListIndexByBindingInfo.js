import { calcWildcardLen } from "../address/calcWildcardLen";
import { getLoopContextByNode } from "./loopContextByNode";
const listIndexByBindingInfoByLoopContext = new WeakMap();
export function getListIndexByBindingInfo(bindingInfo) {
    const loopContext = getLoopContextByNode(bindingInfo.node);
    if (loopContext === null) {
        return null;
    }
    let listIndexByBindingInfo = listIndexByBindingInfoByLoopContext.get(loopContext);
    if (typeof listIndexByBindingInfo === "undefined") {
        listIndexByBindingInfo = new WeakMap();
        listIndexByBindingInfoByLoopContext.set(loopContext, listIndexByBindingInfo);
    }
    else {
        const listIndex = listIndexByBindingInfo.get(bindingInfo);
        if (typeof listIndex !== "undefined") {
            return listIndex;
        }
    }
    let listIndex = null;
    try {
        const wildcardLen = calcWildcardLen(loopContext.elementPathInfo, bindingInfo.statePathInfo);
        if (wildcardLen > 0) {
            listIndex = loopContext.listIndex.at(wildcardLen - 1);
        }
        return listIndex;
    }
    finally {
        listIndexByBindingInfo.set(bindingInfo, listIndex);
    }
}
//# sourceMappingURL=getListIndexByBindingInfo.js.map