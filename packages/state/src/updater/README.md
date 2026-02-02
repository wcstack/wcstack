
依存解決 / 更新対象収集
Resolve Dependencies / Collect Update Targets

バインド取得 / バインド情報解決
Retrieve Bindings / Resolve Binding Info

ノード適用 / DOM反映
Apply to Nodes / Commit to DOM



_applyChange(bindingInfo, state, stateName) {
  const stateAddress = stateAddressByBindingInfo(bindingInfo);
  const value = state.$$getByAddress(stateAddress);
}

applyChange(bindingInfo, state, stateName) {
  if (bindingInfo.stateName !== stateName) {
    const stateElement = stateElementByName(bindingInfo.stateName)
    stateElement.createState("readonly", (state) = {
      _applyChange(bindingInfo, state, bindingInfo.stateName)
    })
  } else {
    _applyChange(bindingInfo, state, stateName)
  }

}
