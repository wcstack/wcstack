import { raiseError } from "../raiseError";
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
        const bindingWildCardParentPathSet = bindingInfo.statePathInfo?.wildcardParentPathSet;
        if (typeof bindingWildCardParentPathSet === "undefined") {
            raiseError(`BindingInfo does not have statePathInfo for list index retrieval.`);
        }
        const loopContextWildcardParentPathSet = loopContext.elementPathInfo.wildcardParentPathSet;
        const matchPath = bindingWildCardParentPathSet.intersection(loopContextWildcardParentPathSet);
        const wildcardLen = matchPath.size;
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