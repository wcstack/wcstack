import { applyChangeToNode } from "./applyChangeToNode";
import { getPathInfo } from "./address/PathInfo";
import { getListIndexesByList, setListIndexesByList } from "./list/listIndexesByList";
import { createListIndexes } from "./list/createListIndexes";
class StateHandler {
    _bindingInfosByPath;
    _listPaths;
    constructor(bindingInfosByPath, listPaths) {
        this._bindingInfosByPath = bindingInfosByPath;
        this._listPaths = listPaths;
    }
    _getNestValue(target, pathInfo, receiver) {
        let curPathInfo = pathInfo;
        if (curPathInfo.path in target) {
            return Reflect.get(target, curPathInfo.path, receiver);
        }
        const parentPathInfo = curPathInfo.parentPathInfo;
        if (parentPathInfo === null) {
            return undefined;
        }
        const parent = this._getNestValue(target, parentPathInfo, receiver);
        const lastSegment = curPathInfo.segments[curPathInfo.segments.length - 1];
        if (lastSegment in parent) {
            return Reflect.get(parent, lastSegment, receiver);
        }
        else {
            console.warn(`[@wcstack/state] Property "${pathInfo.path}" does not exist on state.`);
            return undefined;
        }
    }
    get(target, prop, receiver) {
        let value;
        try {
            if (typeof prop === "string") {
                const pathInfo = getPathInfo(prop);
                if (pathInfo.segments.length > 1) {
                    return (value = this._getNestValue(target, pathInfo, receiver));
                }
            }
            if (prop in target) {
                return (value = Reflect.get(target, prop, receiver));
            }
            else {
                console.warn(`[@wcstack/state] Property "${String(prop)}" does not exist on state.`);
                return undefined;
            }
        }
        finally {
            if (typeof prop === "string") {
                if (this._listPaths.has(prop)) {
                    if (getListIndexesByList(value) === null) {
                        // ToDo: parentListIndexをスタックから取得するように修正する
                        const listIndexes = createListIndexes(value ?? [], null);
                        setListIndexesByList(value, listIndexes);
                    }
                }
            }
        }
    }
    set(target, prop, value, receiver) {
        let result = false;
        if (typeof prop === "string") {
            const pathInfo = getPathInfo(prop);
            if (pathInfo.segments.length > 1) {
                if (pathInfo.parentPathInfo === null) {
                    return false;
                }
                const parent = this._getNestValue(target, pathInfo.parentPathInfo, receiver);
                const lastSegment = pathInfo.segments[pathInfo.segments.length - 1];
                result = Reflect.set(parent, lastSegment, value, receiver);
            }
            else {
                result = Reflect.set(target, prop, value, receiver);
            }
            if (this._bindingInfosByPath.has(String(prop))) {
                const bindingInfos = this._bindingInfosByPath.get(String(prop)) || [];
                for (const bindingInfo of bindingInfos) {
                    applyChangeToNode(bindingInfo.node, bindingInfo.propSegments, value);
                }
            }
        }
        else {
            result = Reflect.set(target, prop, value, receiver);
        }
        if (typeof prop === "string") {
            if (this._listPaths.has(prop)) {
                // ToDo: parentListIndexをスタックから取得するように修正する
                const listIndexes = createListIndexes(value ?? [], null);
                setListIndexesByList(value, listIndexes);
            }
        }
        return result;
    }
}
export function createStateProxy(state, bindingInfosByPath, listPaths) {
    return new Proxy(state, new StateHandler(bindingInfosByPath, listPaths));
}
//# sourceMappingURL=Proxy.js.map