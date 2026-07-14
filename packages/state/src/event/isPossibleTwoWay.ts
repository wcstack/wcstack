import { getCustomElement } from "../getCustomElement";
import { getCustomElementRegistry } from "../platform/customElementRegistry";
import { readBindableDeclaration } from "../protocol/wcBindableReader";
import { raiseError } from "../raiseError";

const CHECK_TYPES = new Set([ 'radio', 'checkbox' ]);
const DEFAULT_VALUE_PROP_NAMES = new Set([ 'value', 'valueAsNumber', 'valueAsDate' ]);

export function isPossibleTwoWay(node: Node, propName: string): boolean {
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return false;
  }
  const element = node as Element;
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
  const customTagName = getCustomElement(element);
  if (customTagName !== null) {
    const customClass = getCustomElementRegistry()?.get(customTagName);
    if (typeof customClass === "undefined") {
      raiseError(`Custom element <${customTagName}> is not defined. Cannot determine if property "${propName}" is suitable for two-way binding.`);
    }
    const bindable = readBindableDeclaration(element);
    if (bindable?.knownProperties.has(propName)) {
      return true;
    }
  }
  return false;
}
