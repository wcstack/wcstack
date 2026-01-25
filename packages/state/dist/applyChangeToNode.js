export function applyChangeToNode(node, propSegments, newValue) {
    if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node;
        if (propSegments.length === 1) {
            const propName = propSegments[0];
            element[propName] = newValue;
        }
        else {
            const typeKey = propSegments[0];
            if (typeKey === 'style') {
                const htmlElement = element;
                const stylePropName = propSegments[1];
                htmlElement.style[stylePropName] = newValue;
            }
            else if (typeKey === 'attr') {
                const attrName = propSegments[1];
                if (newValue === null || typeof newValue === "undefined") {
                    element.removeAttribute(attrName);
                }
                else {
                    element.setAttribute(attrName, String(newValue));
                }
            }
            else {
                const subObject = element[typeKey];
                if (typeof subObject === "object" && subObject !== null) {
                    const subPropName = propSegments[1];
                    subObject[subPropName] = newValue;
                }
            }
        }
    }
    else if (node.nodeType === Node.TEXT_NODE) {
        const textNode = node;
        textNode.textContent = String(newValue);
    }
}
//# sourceMappingURL=applyChangeToNode.js.map