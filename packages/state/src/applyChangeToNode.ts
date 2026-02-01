
export function applyChangeToNode(node: Node, propSegments: string[], newValue: any): void {
  if (node.nodeType === Node.ELEMENT_NODE) {
    const element = node as Element;
    if (propSegments.length === 1) {
      const propName = propSegments[0];
      (element as any)[propName] = newValue;
    } else {
      const typeKey = propSegments[0];
      if (typeKey === 'style') {
        const htmlElement = element as HTMLElement;
        const stylePropName = propSegments[1];
        (htmlElement.style as any)[stylePropName] = newValue;
      } else if (typeKey === 'attr') {
        const attrName = propSegments[1];
        if (newValue === null || typeof newValue === "undefined") {
          element.removeAttribute(attrName);
        } else {
          element.setAttribute(attrName, String(newValue));
        }
      } else {
        const subObject = (element as any)[typeKey];
        if (typeof subObject === "object" && subObject !== null) {
          const subPropName = propSegments[1];
          (subObject as any)[subPropName] = newValue;
        }
      }
    }
  } else if (node.nodeType === Node.TEXT_NODE) {
    const textNode = node as Text;
    textNode.textContent = String(newValue);
  }
}