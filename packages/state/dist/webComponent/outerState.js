import { getAbsolutePathInfo } from "../address/AbsolutePathInfo";
import { createAbsoluteStateAddress } from "../address/AbsoluteStateAddress";
import { getPathInfo } from "../address/PathInfo";
import { raiseError } from "../raiseError";
import { getLastValueByAbsoluteStateAddress } from "./lastValueByAbsoluteStateAddress";
import { getStateElementByWebComponent } from "./stateElementByWebComponent";
class OuterStateProxyHandler {
    _webComponent;
    _innerStateElement;
    constructor(webComponent, stateName) {
        this._webComponent = webComponent;
        this._innerStateElement = getStateElementByWebComponent(webComponent, stateName) ?? raiseError('State element not found for web component.');
    }
    get(target, prop, receiver) {
        if (typeof prop === 'string') {
            const innerPathInfo = getPathInfo(prop);
            const innerAbsPathInfo = getAbsolutePathInfo(this._innerStateElement, innerPathInfo);
            const absStateAddress = createAbsoluteStateAddress(innerAbsPathInfo, null);
            return getLastValueByAbsoluteStateAddress(absStateAddress);
        }
        else {
            return Reflect.get(target, prop, receiver);
        }
    }
    set(target, prop, value, receiver) {
        if (typeof prop === 'string') {
            const innerPathInfo = getPathInfo(prop);
            const innerAbsPathInfo = getAbsolutePathInfo(this._innerStateElement, innerPathInfo);
            this._innerStateElement.createState("readonly", (state) => {
                state.$postUpdate(innerAbsPathInfo.pathInfo.path);
            });
            return true;
        }
        else {
            return Reflect.set(target, prop, value, receiver);
        }
    }
}
export function createOuterState(webComponent, stateName) {
    const handler = new OuterStateProxyHandler(webComponent, stateName);
    return new Proxy({}, handler);
}
//# sourceMappingURL=outerState.js.map