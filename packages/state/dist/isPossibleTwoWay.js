const CHECK_TYPES = new Set(['radio', 'checkbox']);
const DEFAULT_VALUE_PROP_NAMES = new Set(['value', 'valueAsNumber', 'valueAsDate']);
export function isPossibleTwoWay(node, propName) {
    if (node.nodeType !== Node.ELEMENT_NODE) {
        return false;
    }
    const element = node;
    const tagName = element.tagName.toLowerCase();
    if (tagName === 'input') {
        const inputType = (element.getAttribute('type') || 'text').toLowerCase();
        if (inputType === 'button') {
            return false;
        }
        if (CHECK_TYPES.has(inputType) && propName === 'checked') {
            return true;
        }
        if (DEFAULT_VALUE_PROP_NAMES.has(propName)) {
            return true;
        }
    }
    if (tagName === 'select' && propName === 'value') {
        return true;
    }
    if (tagName === 'textarea' && propName === 'value') {
        return true;
    }
    return false;
}
//# sourceMappingURL=isPossibleTwoWay.js.map