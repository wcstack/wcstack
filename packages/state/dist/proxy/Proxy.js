import { getPathInfo } from "../address/PathInfo";
import { getListIndexesByList, setListIndexesByList } from "../list/listIndexesByList";
import { createListIndexes } from "../list/createListIndexes";
import { applyChange } from "../apply/applyChange";
class StateHandler {
    _bindingInfosByPath;
    _listPaths;
    _stackListIndex = [];
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
        if (parent == null) {
            console.warn(`[@wcstack/state] Cannot access property "${pathInfo.path}" - parent is null or undefined.`);
            return undefined;
        }
        const lastSegment = curPathInfo.segments[curPathInfo.segments.length - 1];
        if (lastSegment === '*') {
            const wildcardCount = curPathInfo.wildcardPositions.length;
            if (wildcardCount === 0 || wildcardCount > this._stackListIndex.length) {
                console.warn(`[@wcstack/state] Cannot get value for path "${pathInfo.path}" - invalid wildcard depth.`);
                return undefined;
            }
            const listIndex = this._stackListIndex[wildcardCount - 1];
            if (listIndex === null) {
                console.warn(`[@wcstack/state] Cannot get value for path "${pathInfo.path}" because list index is null.`);
                return undefined;
            }
            return Reflect.get(parent, listIndex.index);
        }
        else if (lastSegment in parent) {
            return Reflect.get(parent, lastSegment);
        }
        else {
            console.warn(`[@wcstack/state] Property "${pathInfo.path}" does not exist on state.`);
            return undefined;
        }
    }
    $stack(listIndex, callback, receiver) {
        this._stackListIndex.push(listIndex);
        try {
            return Reflect.apply(callback, receiver, []);
        }
        finally {
            this._stackListIndex.pop();
        }
    }
    get(target, prop, receiver) {
        let value;
        try {
            if (typeof prop === "string") {
                if (prop === "$stack") {
                    return (listIndex, callback) => {
                        return this.$stack(listIndex, callback, receiver);
                    };
                }
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
                if (this._listPaths.has(prop) && value != null) {
                    if (getListIndexesByList(value) === null) {
                        const parentListIndex = this._stackListIndex.length > 0
                            ? this._stackListIndex[this._stackListIndex.length - 1]
                            : null;
                        const listIndexes = createListIndexes(value, parentListIndex);
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
                if (parent == null) {
                    console.warn(`[@wcstack/state] Cannot set property "${pathInfo.path}" - parent is null or undefined.`);
                    return false;
                }
                const lastSegment = pathInfo.segments[pathInfo.segments.length - 1];
                result = Reflect.set(parent, lastSegment, value);
            }
            else {
                result = Reflect.set(target, prop, value, receiver);
            }
            if (this._bindingInfosByPath.has(String(prop))) {
                const bindingInfos = this._bindingInfosByPath.get(String(prop)) || [];
                for (const bindingInfo of bindingInfos) {
                    applyChange(bindingInfo, value);
                }
            }
        }
        else {
            result = Reflect.set(target, prop, value, receiver);
        }
        if (typeof prop === "string") {
            if (this._listPaths.has(prop) && value != null) {
                const parentListIndex = this._stackListIndex.length > 0
                    ? this._stackListIndex[this._stackListIndex.length - 1]
                    : null;
                const listIndexes = createListIndexes(value, parentListIndex);
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