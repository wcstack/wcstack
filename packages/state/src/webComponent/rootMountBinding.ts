import { getBindingsByNode } from "../bindings/getBindingsByNode";
import { config } from "../config";

/**
 * ホストが `<stateProp>: path`（1 セグメント ＝ 丸ごとマウント・ルート規則）を
 * このコンポーネントに書いているか。バインディング初期化が済んだ後に呼ぶこと
 * （`State._initializeBindWebComponent` は `waitInitializeBinding` の後で呼ぶ）。
 */
export function hasRootMountBinding(component: Element, stateProp: string): boolean {
  if (!component.hasAttribute(config.bindAttributeName)) {
    return false;
  }
  const bindings = getBindingsByNode(component);
  if (bindings === null) {
    return false;
  }
  for (const binding of bindings) {
    if (binding.propSegments.length === 1 && binding.propSegments[0] === stateProp) {
      return true;
    }
  }
  return false;
}
