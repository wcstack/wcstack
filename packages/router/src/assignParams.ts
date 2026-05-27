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
        // null/undefined は属性削除として扱う（文字列 "null"/"undefined" になる事故を防ぐ）。
        // boolean/number は setAttribute の標準挙動に従って文字列化される。
        if (value === null || value === undefined) {
          element.removeAttribute(key);
        } else {
          element.setAttribute(key, String(value));
        }
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
    // 注意: customElements.whenDefined(tag) は当該タグが define されるまで pending のままになる。
    // element が削除されてもこの Promise は GC されず、closure に保持される element/params は
    // 解放されない（弱い参照を持つ手段がないため）。define されないまま要素のみが大量に作られる
    // ようなケースではリークになりうるが、通常の Web Components 利用では autoloader が
    // 一括 define するため実用上問題にならない。明示的にキャンセルしたい場合は将来 AbortSignal を
    // サポートすることを検討する。
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