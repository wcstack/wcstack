import { IStateElement } from "../components/types";

const stateElementByWebComponent: WeakMap<Element, Map<string, IStateElement>> = new WeakMap();

export function setStateElementByWebComponent(webComponent: Element, stateName: string, stateElement: IStateElement): void {
  let stateMap = stateElementByWebComponent.get(webComponent);
  if (!stateMap) {
    stateMap = new Map();
    stateElementByWebComponent.set(webComponent, stateMap);
  }
  stateMap.set(stateName, stateElement);
}

export function getStateElementByWebComponent(webComponent: Element, stateName: string): IStateElement | null {
  const stateMap = stateElementByWebComponent.get(webComponent);
  if (!stateMap) {
    return null;
  }
  return stateMap.get(stateName) ?? null;
}

/**
 * コンポーネントが mapped されている「1 つ外のスコープ」の state 要素。
 * `buildPrimaryMappingRule` がプライマリ規則から記録する
 * （規則の outer 側が属する state 要素 ＝ 値の正本を持つスコープそのもの）。
 *
 * 用途は Δ（base listIndex）の境界越え合成（§1.12）。`getLoopContextByNode` は
 * `parentNode` しか辿らず shadow 境界を越えないため、Δ を外へ引き継ぐには
 * 「1 つ外のスコープ」への明示的なリンクが要る。
 *
 * この台帳を MappingRule ではなくここに置くのは循環参照を避けるため
 * （baseListIndex → MappingRule → BindingSession → outerListPath → baseListIndex）。
 */
const outerStateElementByWebComponent: WeakMap<Element, IStateElement> = new WeakMap();

export function setOuterStateElementByWebComponent(webComponent: Element, stateElement: IStateElement): void {
  outerStateElementByWebComponent.set(webComponent, stateElement);
}

export function getOuterStateElementByWebComponent(webComponent: Element): IStateElement | null {
  return outerStateElementByWebComponent.get(webComponent) ?? null;
}