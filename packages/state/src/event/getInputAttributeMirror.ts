import { getCustomElement } from "../getCustomElement";
import { getCustomElementRegistry } from "../platform/customElementRegistry";
import { readBindableDeclaration } from "../protocol/wcBindableReader";

/**
 * 要素 `element` の `propName` プロパティ書き込みに対して、
 * wc-bindable inputs の `attribute` ミラー先属性名を返す。
 *
 * - wc-bindable でないネイティブ要素や、inputs 未宣言、attribute フィールド無しは null
 * - inputs に同名宣言があっても `attribute` を持たないものはミラー対象外
 *
 * 戻り値の string がそのまま `setAttribute(name, value)` の name となる。
 */
export function getInputAttributeMirror(element: Element, propName: string): string | null {
  const customTagName = getCustomElement(element);
  if (customTagName === null) {
    return null;
  }
  const customClass = getCustomElementRegistry()?.get(customTagName);
  if (typeof customClass === "undefined") {
    return null;
  }
  const input = readBindableDeclaration(element)?.declaredInputs.get(propName);
  if (typeof input?.attribute === "string" && input.attribute.length > 0) {
    return input.attribute;
  }
  return null;
}

/**
 * mirror 属性値の表現を決める。
 * - null / undefined → 属性削除
 * - object / array → JSON.stringify (失敗時は String(value))
 * - その他 (string / number / boolean / bigint) → String(value)
 */
export function applyMirrorAttribute(element: Element, attributeName: string, value: unknown): void {
  if (value === null || typeof value === "undefined") {
    element.removeAttribute(attributeName);
    return;
  }
  let formatted: string;
  if (typeof value === "object") {
    try {
      formatted = JSON.stringify(value);
    } catch {
      formatted = String(value);
    }
  } else {
    formatted = String(value);
  }
  element.setAttribute(attributeName, formatted);
}
