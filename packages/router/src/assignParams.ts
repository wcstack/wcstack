import { BindType } from "./components/types";
import { getCustomTagName } from "./getCustomTagName";
import { raiseError } from "./raiseError";

const bindTypeSet: Set<BindType> = new Set([ "props", "states", "attr", "" ]);

function _assignParams(element: Element, params: Record<string, any>, bindType: BindType) {
  for(const [key, value] of Object.entries(params)) {
    switch(bindType) {
      case "props":
        (element as any).props = {
          ...(element as any).props,
          [key]: value
        };
        break;
      case "states":
        (element as any).states = {
          ...(element as any).states,
          [key]: value
        };
        break;
      case "attr":
        element.setAttribute(key, value);
        break;
      case "":
        (element as any)[key] = value;
        break;
    }
  }
}

export function assignParams(element: Element, params: Record<string, any>) {
  if (!element.hasAttribute('data-bind')) {
    raiseError(`${element.tagName} has no 'data-bind' attribute.`);
  }
  const bindTypeText = element.getAttribute('data-bind') || '';
  if (!bindTypeSet.has(bindTypeText as BindType)) {
    raiseError(`${element.tagName} has invalid 'data-bind' attribute: ${bindTypeText}`);
  }
  const bindType = bindTypeText as BindType;
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
  } else {
    _assignParams(element, params, bindType);
  }
}