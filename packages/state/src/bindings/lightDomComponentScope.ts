/**
 * bindings/lightDomComponentScope.ts — Light DOM の mapped `bind-component` を
 * 「ホストとは別のバインディングスコープ」として扱うための判定
 * （docs/architecture-hardening/15-state-component-mechanism-consistency.md §1.13）。
 *
 * Shadow DOM 形では、コンポーネントの `<wcs-state>` が**別 rootNode** にいることで
 * 2 つのことが同時に成立している。
 *
 * 1. ホスト root の `waitForStateInitialize` の走査集合に入らない
 * 2. 子スコープのバインディングがホストとは別の `buildBindings` パスで処理される
 *
 * Light DOM では両方が失われる。1 が失われると、
 * 「ホストの `waitForStateInitialize` が子 state を待つ →
 *   子 state は自分を束ねるホスト binding を待つ →
 *   その binding を作る `initializeBindings` は `waitForStateInitialize` の後」
 * という循環になり、初期化が永久に解決しない。2 が失われると、子スコープの
 * `@name` 参照がホストと同じパスで解決されてしまい、子 state の名前登録より
 * 先に評価される。
 *
 * このモジュールはその 2 つを明示的に復元するための判定だけを持つ。
 *
 * **plain（ホストからバインドしない state 注入）の Light DOM は v2 で廃止**
 *（State._initializeBindWebComponent が raise する — 共有 rootNode に独立ツリーを
 * 置けないため。shadow を付ければ plain Shadow 形として従来どおり動く）。
 * ここの判定が「ホストからバインドされているか」を見るのはその名残ではなく、
 * マウント（配線あり）だけをスコープとして切り出すため。
 */

import { config } from "../config";

/** `<wcs-state bind-component>` が Light DOM の mapped 形（＝別スコープ扱い）か。 */
export function isLightDomMappedStateElement(stateElement: Element): boolean {
  if (!stateElement.hasAttribute("bind-component")) {
    return false;
  }
  const parentNode = stateElement.parentNode;
  // Shadow DOM 形では parentNode が ShadowRoot になる（かつホスト root の
  // querySelectorAll にはそもそも出てこない）
  if (!(parentNode instanceof Element)) {
    return false;
  }
  // ホストからバインドされていなければ plain。従来どおりの扱いに任せる
  return parentNode.hasAttribute(config.bindAttributeName);
}

/**
 * `root` の内側にある Light DOM mapped コンポーネント要素を集める。
 *
 * `root` 自身は**含めない**。子スコープが自分のパスとして
 * `initializeBindings(componentElement)` を呼ぶとき、その要素自身まで prune すると
 * 何も初期化されなくなるため。
 */
export function findNestedLightDomComponents(root: Document | Element | DocumentFragment): Element[] {
  const components: Element[] = [];
  const stateElements = root.querySelectorAll(`${config.tagNames.state}[bind-component]`);
  for (const stateElement of stateElements) {
    if (!isLightDomMappedStateElement(stateElement)) {
      continue;
    }
    const component = stateElement.parentNode as Element;
    if (component === (root as unknown as Element)) {
      continue;
    }
    components.push(component);
  }
  return components;
}

/** `node` が、いずれかのコンポーネント要素の**真の**子孫か。 */
export function isInsideAnyComponent(node: Node, components: Element[]): boolean {
  for (let i = 0; i < components.length; i++) {
    const component = components[i];
    if (component !== node && component.contains(node)) {
      return true;
    }
  }
  return false;
}
