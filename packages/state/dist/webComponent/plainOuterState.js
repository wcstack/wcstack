import { raiseError } from "../raiseError";
import { getStateElementByWebComponent } from "./stateElementByWebComponent";
class PlainOuterStateProxyHandler {
    _innerStateElement;
    constructor(webComponent, stateName) {
        this._innerStateElement = getStateElementByWebComponent(webComponent, stateName) ?? raiseError('State element not found for web component.');
    }
    get(target, prop, receiver) {
        if (typeof prop === 'string') {
            let value;
            this._innerStateElement.createState("readonly", (state) => {
                value = state[prop];
            });
            return value;
        }
        else {
            return Reflect.get(target, prop, receiver);
        }
    }
    set(target, prop, value, receiver) {
        if (typeof prop === 'string') {
            this._innerStateElement.createState("writable", (state) => {
                state[prop] = value;
            });
            return true;
        }
        else {
            return Reflect.set(target, prop, value, receiver);
        }
    }
}
export function createPlainOuterState(webComponent, stateName) {
    const handler = new PlainOuterStateProxyHandler(webComponent, stateName);
    return new Proxy({}, handler);
}
//# sourceMappingURL=plainOuterState.js.map