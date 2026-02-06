import { getLoopContextByNode } from "./loopContextByNode";
const listIndexByBindingInfoByLoopContext = new WeakMap();
const cacheCalcWildcardIndex = new WeakMap();
function calcWildcardIndex(pathInfo, targetPathInfo) {
    let path1;
    let path2;
    if (pathInfo.id < targetPathInfo.id) {
        path1 = pathInfo;
        path2 = targetPathInfo;
    }
    else {
        path1 = targetPathInfo;
        path2 = pathInfo;
    }
    let cacheByPath2 = cacheCalcWildcardIndex.get(path1);
    if (typeof cacheByPath2 === "undefined") {
        cacheByPath2 = new WeakMap();
        cacheCalcWildcardIndex.set(path1, cacheByPath2);
    }
    else {
        const cached = cacheByPath2.get(path2);
        if (typeof cached !== "undefined") {
            return cached;
        }
    }
    const matchPath = path1.wildcardParentPathSet.intersection(path2.wildcardParentPathSet);
    const retValue = matchPath.size - 1;
    cacheByPath2.set(path2, retValue);
    return retValue;
}
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
        const wildcardIndex = calcWildcardIndex(loopContext.elementPathInfo, bindingInfo.statePathInfo);
        if (wildcardIndex >= 0) {
            listIndex = loopContext.listIndex.at(wildcardIndex) || null;
        }
        return listIndex;
    }
    finally {
        listIndexByBindingInfo.set(bindingInfo, listIndex);
    }
}
//# sourceMappingURL=getListIndexByBindingInfo.js.map