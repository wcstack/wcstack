export function applyChangeToAttribute(element, attrName, newValue) {
    if (element.getAttribute(attrName) !== newValue) {
        element.setAttribute(attrName, newValue);
    }
}
//# sourceMappingURL=applyChangeToAttribute.js.map