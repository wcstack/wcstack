import { getAbsolutePathInfo } from "../address/AbsolutePathInfo";
import { createAbsoluteStateAddress } from "../address/AbsoluteStateAddress";
import { getPathInfo } from "../address/PathInfo";
import { raiseError } from "../raiseError";
import { getStateElementByName } from "../stateElementByName";
import { getLastValueByAbsoluteStateAddress } from "./lastValueByAbsoluteStateAddress";
import { getInnerAbsolutePathInfo } from "./MappingRule";
import { getStateElementByWebComponent } from "./stateElementByWebComponent";
class OuterStateProxyHandler {
    _webComponent;
    _innerStateElement;
    constructor(webComponent) {
        this._webComponent = webComponent;
        this._innerStateElement = getStateElementByWebComponent(webComponent) ?? raiseError('State element not found for web component.');
    }
    get(target, prop, receiver) {
        if (typeof prop === 'string') {
            const [path, stateName = 'default'] = prop.split('@');
            const outerPathInfo = getPathInfo(path);
            const rootNode = this._webComponent.getRootNode();
            const outerStateElement = getStateElementByName(rootNode, stateName);
            if (outerStateElement === null) {
                raiseError(`State element with name "${stateName}" not found for web component.`);
            }
            const outerAbsPathInfo = getAbsolutePathInfo(outerStateElement, outerPathInfo);
            const innerAbsPathInfo = getInnerAbsolutePathInfo(this._webComponent, outerAbsPathInfo);
            if (innerAbsPathInfo === null) {
                raiseError(`Inner path info not found for outer path "${outerPathInfo.path}" on web component.`);
            }
            // 内部StateElementは直下に必ず存在するので、ループコンテキストを考慮しなくてよい
            const absStateAddress = createAbsoluteStateAddress(innerAbsPathInfo, null);
            return getLastValueByAbsoluteStateAddress(absStateAddress);
        }
        else {
            return Reflect.get(target, prop, receiver);
        }
    }
    set(target, prop, value, receiver) {
        if (typeof prop === 'string') {
            const [path, stateName = 'default'] = prop.split('@');
            const outerPathInfo = getPathInfo(path);
            const rootNode = this._webComponent.getRootNode();
            const outerStateElement = getStateElementByName(rootNode, stateName);
            if (outerStateElement === null) {
                raiseError(`State element with name "${stateName}" not found for web component.`);
            }
            const outerAbsPathInfo = getAbsolutePathInfo(outerStateElement, outerPathInfo);
            const innerAbsPathInfo = getInnerAbsolutePathInfo(this._webComponent, outerAbsPathInfo);
            if (innerAbsPathInfo === null) {
                raiseError(`Inner path info not found for outer path "${outerPathInfo.path}" on web component.`);
            }
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
export function createOuterState(webComponent) {
    const handler = new OuterStateProxyHandler(webComponent);
    return new Proxy({}, handler);
}
//# sourceMappingURL=outerState.js.map