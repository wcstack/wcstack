/**
 * `bind-component` の配線が完了した (webComponent, stateProp) の台帳。
 *
 * 完了前は state プロパティがまだ素のオブジェクトなので、親からの適用は
 * `applyChangeToProperty` がそこへ値を積み、`bindWebComponent` が melt して取り込む。
 * 完了後は公開プロパティが outerState proxy に差し替わっているため、親からの適用は
 * 値を運ばない内部通知チャネル（`applyChangeToWebComponent`）へ切り替わる。
 * その切り替え判定がこの台帳。
 *
 * キーは「state プロパティ名」であって state 要素ではない。完了はプロパティ単位の
 * 事実（`defineProperty(component, stateProp, ...)` が済んだか）であり、
 * 1 つの要素に複数の state プロパティを束ねられる以上、粒度もプロパティ単位が正しい。
 * 以前は内側の `IStateElement` をキーにしていたが、照会側（apply/applyChange.ts）が
 * 手にしているのは *親スコープ* の `IStateElement` であり、どちらも同じ型なので
 * TypeScript が取り違えを検出できず、判定が恒久的に false になっていた
 * （＝親 state 起点の変更が子コンポーネントへ届かない。
 * docs/architecture-hardening/15-state-component-mechanism-consistency.md §1.7）。
 */
const completedStatePropsByWebComponent = new WeakMap<Element, Set<string>>();

export function markWebComponentAsComplete(webComponent: Element, stateProp: string): void {
  let completedStateProps = completedStatePropsByWebComponent.get(webComponent);
  if (!completedStateProps) {
    completedStateProps = new Set<string>();
    completedStatePropsByWebComponent.set(webComponent, completedStateProps);
  }
  completedStateProps.add(stateProp);
}

export function isWebComponentComplete(webComponent: Element, stateProp: string): boolean {
  return completedStatePropsByWebComponent.get(webComponent)?.has(stateProp) === true;
}
