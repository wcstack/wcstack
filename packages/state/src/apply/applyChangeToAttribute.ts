
export function applyChangeToAttribute(element: Element, attrName: string, newValue: string): void {
  if (element.getAttribute(attrName) !== newValue) {
    element.setAttribute(attrName, newValue);
  }
}