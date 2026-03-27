import { config } from "../config";
import { IBindingInfo } from "../types";
import { IApplyContext } from "./types";
import { addSsrProperty, trackSsrPropertyNode } from "./ssrPropertyStore";

// SSR 時に HTML 属性で代替可能なプロパティ
// これら以外のプロパティは ssrPropertyStore に蓄積してハイドレーション時に復元
const SSR_ATTR_PROPS: Record<string, (element: Element, value: unknown) => void> = {
  value(element, value) {
    if (element.tagName === 'TEXTAREA') {
      element.textContent = String(value ?? '');
    } else {
      element.setAttribute('value', String(value ?? ''));
    }
  },
  checked(element, value) {
    if (value) element.setAttribute('checked', '');
    else element.removeAttribute('checked');
  },
  selected(element, value) {
    if (value) element.setAttribute('selected', '');
    else element.removeAttribute('selected');
  },
  disabled(element, value) {
    if (value) element.setAttribute('disabled', '');
    else element.removeAttribute('disabled');
  },
  selectedIndex(element, value) {
    const options = element.querySelectorAll('option');
    const idx = Number(value);
    for (let i = 0; i < options.length; i++) {
      if (i === idx) options[i].setAttribute('selected', '');
      else options[i].removeAttribute('selected');
    }
  },
};

export function applyChangeToProperty(binding: IBindingInfo, _context: IApplyContext, newValue: unknown): void {
  const element = binding.node as Element;
  const propSegments = binding.propSegments;
  if (propSegments.length === 1) {
    const firstSegment = propSegments[0];
    if ((element as any)[firstSegment] !== newValue) {
      try {
        (element as any)[firstSegment] = newValue;
      } catch (error) {
        if (config.debug) {
          console.warn(`Failed to set property '${firstSegment}' on element.`, {
            element,
            newValue,
            error
          });
        }
      }
    }
    if (config.ssr) {
      const attrHandler = SSR_ATTR_PROPS[firstSegment];
      if (attrHandler) {
        // 属性で代替可能 → HTML 属性に反映
        attrHandler(element, newValue);
      } else {
        // 属性で代替不可 → ハイドレーション用ストアに蓄積
        addSsrProperty(element, firstSegment, newValue);
        trackSsrPropertyNode(element);
      }
    }
    return;
  }
  const firstSegment = propSegments[0];
  let subObject = (element as any)[firstSegment];
  for (let i = 1; i < propSegments.length - 1; i++) {
    const segment = propSegments[i];
    if (subObject == null) {
      return;
    }
    subObject = subObject[segment];
  }
  const oldValue = subObject[propSegments[propSegments.length - 1]];
  if (oldValue !== newValue) {
    if (Object.isFrozen(subObject)) {
      if (config.debug) {
        console.warn(`Attempting to set property on frozen object.`, {
          element,
          propSegments,
          oldValue,
          newValue
        });
      }
      return;
    }
    try {
      subObject[propSegments[propSegments.length - 1]] = newValue;
    } catch (error) {
      if (config.debug) {
        console.warn(`Failed to set property on sub-object.`, {
          element,
          propSegments,
          oldValue,
          newValue,
          error
        });
      }
    }
  }
  // サブオブジェクトプロパティ (e.g. style.xxx) は属性に反映済みなのでストア不要
}
