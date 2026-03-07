import { getCustomElement } from "../getCustomElement";
import { raiseError } from "../raiseError";
import { IWcBindable } from "./types";

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
    const customClass = customElements.get(customTagName) as any;
    if (typeof customClass === "undefined") {
      raiseError(`Custom element <${customTagName}> is not defined. Cannot determine if property "${propName}" is suitable for two-way binding.`);
    }
    const bindable: IWcBindable | undefined = customClass.wcBindable;
    if (bindable?.protocol === "wc-bindable" && bindable?.version === 1) {
      if (bindable.properties.some(p => p.name === propName)) {
        return true;
      }
    }
  }
  return false;
}