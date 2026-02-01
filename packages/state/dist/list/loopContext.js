import { raiseError } from "../raiseError";
class LoopContextStack {
    _loopContextStack = [];
    createLoopContext(elementPathInfo, listIndex, callback) {
        const lastLoopContext = this._loopContextStack[this._loopContextStack.length - 1];
        if (typeof lastLoopContext !== "undefined") {
            if (lastLoopContext.elementPathInfo.wildcardCount + 1 !== elementPathInfo.wildcardCount) {
                raiseError(`Cannot push loop context for a list whose wildcard count is not exactly one more than the current active loop context.`);
            }
            const lastWildcardParentPathInfo = elementPathInfo.wildcardParentPathInfos[elementPathInfo.wildcardParentPathInfos.length - 1];
            if (lastLoopContext.elementPathInfo !== lastWildcardParentPathInfo) {
                raiseError(`Cannot push loop context for a list whose parent wildcard path info does not match the current active loop context.`);
            }
        }
        else {
            if (elementPathInfo.wildcardCount !== 1) {
                raiseError(`Cannot push loop context for a list with wildcard positions when there is no active loop context.`);
            }
        }
        const loopContext = { elementPathInfo, listIndex };
        this._loopContextStack.push(loopContext);
        let retValue = void 0;
        try {
            retValue = callback(loopContext);
        }
        finally {
            if (retValue instanceof Promise) {
                retValue.finally(() => {
                    this._loopContextStack.pop();
                });
            }
            else {
                this._loopContextStack.pop();
            }
        }
        return retValue;
    }
}
export function createLoopContextStack() {
    return new LoopContextStack();
}
//# sourceMappingURL=loopContext.js.map