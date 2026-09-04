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
 * 粒度もプロパティ単位が正しい（v2 の注記: **マウント**スコープは 1 コンポーネント
 * 1 つに制約される — 2 本目の `<wcs-state bind-component>` は
 * webComponent/mountScope.ts が raise する。プロパティ粒度の台帳自体は
 * 型の取り違え防止として維持する）。
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

/**
 * `<wcs-state bind-component="<prop>">` が接続され、(webComponent, stateProp) を束ねると
 * **宣言した**台帳。完了（上）より前 — ホストの `whenDefined` / `waitInitializeBinding` を
 * 待つ前 — に記録する。
 *
 * 用途は丸ごとマウント `data-wcs="state: user"` の**完了前の初期適用の抑止**。完了前の
 * 1 セグメントバインディングは applyChangeToProperty が `element.state = userObject` と
 * 親のオブジェクトそのものをコンポーネントの state プロパティに書いてしまい、
 * bindWebComponent がそれを子 state の実体として取り込む — own data key が親のキー全部に
 * なり、R1 では全部が私有に化ける。宣言済みなら値を書かずに完了を待つ（子は完了後に
 * innerState 経由でライブに読む — docs/state-mount-design.md §3-2 / impl-plan P1-1）。
 *
 * 未宣言（子がまだ接続していない）の間は従来どおり書く。未 upgrade 要素への own property は
 * upgrade 時のクラスフィールド初期化で置き換わるので、実害は無い。
 */
const declaredStatePropsByWebComponent = new WeakMap<Element, Set<string>>();

export function markWebComponentStatePropDeclared(webComponent: Element, stateProp: string): void {
  let declaredStateProps = declaredStatePropsByWebComponent.get(webComponent);
  if (!declaredStateProps) {
    declaredStateProps = new Set<string>();
    declaredStatePropsByWebComponent.set(webComponent, declaredStateProps);
  }
  declaredStateProps.add(stateProp);
}

export function isWebComponentStatePropDeclared(webComponent: Element, stateProp: string): boolean {
  return declaredStatePropsByWebComponent.get(webComponent)?.has(stateProp) === true;
}
