import { getCustomTagName } from "./getCustomTagName";
import { raiseError } from "./raiseError";
const bindTypeSet = new Set(["props", "states", "attr", ""]);
function _assignParams(element, params, bindType) {
    for (const [key, value] of Object.entries(params)) {
        switch (bindType) {
            case "props":
                element.props = {
                    ...element.props,
                    [key]: value
                };
                break;
            case "states":
                element.states = {
                    ...element.states,
                    [key]: value
                };
                break;
            case "attr":
                element.setAttribute(key, value);
                break;
            case "":
                element[key] = value;
                break;
        }
    }
}
export function assignParams(element, params) {
    if (!element.hasAttribute('data-bind')) {
        raiseError(`${element.tagName} has no 'data-bind' attribute.`);
    }
    const bindTypeText = element.getAttribute('data-bind') || '';
    if (!bindTypeSet.has(bindTypeText)) {
        raiseError(`${element.tagName} has invalid 'data-bind' attribute: ${bindTypeText}`);
    }
    const bindType = bindTypeText;
    const customTagName = getCustomTagName(element);
    if (customTagName && customElements.get(customTagName) === undefined) {
        customElements.whenDefined(customTagName).then(() => {
            if (element.isConnected) {
                // 要素が削除されていない場合のみ割り当てを行う
                _assignParams(element, params, bindType);
            }
        }).catch(() => {
            raiseError(`Failed to define custom element: ${customTagName}`);
        });
    }
    else {
        _assignParams(element, params, bindType);
    }
}
//# sourceMappingURL=assignParams.js.map