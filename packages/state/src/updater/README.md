
依存解決 / 更新対象収集
Resolve Dependencies / Collect Update Targets

バインド取得 / バインド情報解決
Retrieve Bindings / Resolve Binding Info

ノード適用 / DOM反映
Apply to Nodes / Commit to DOM



v2: 1 rootNode 1 ツリー（名前次元なし）。state 要素は binding のノードの
rootNode から解決する（マウントされたスコープは台帳エイリアスで親ツリーに到達する）。

_applyChange(bindingInfo, state) {
  const stateAddress = stateAddressByBindingInfo(bindingInfo);
  const value = state.$$getByAddress(stateAddress);
}

applyChangeFromBindings(bindings) {
  // 同じ rootNode のバインディングをグループ化し createState を 1 回にする
  for (const group of groupByRootNode(bindings)) {
    const stateElement = getStateElement(group.rootNode);
    stateElement.createState("readonly", (state) => {
      for (const bindingInfo of group.bindings) {
        _applyChange(bindingInfo, state);
      }
    });
  }
}
