import { IAbsoluteStateAddress } from "../address/types";
import { IStateElement } from "../components/types";
import { config } from "../config";
import { setLastListValueByAbsoluteStateAddress } from "../list/lastListValueByAbsoluteStateAddress";
import { updatedCallbackSymbol } from "../proxy/symbols";
import { raiseError } from "../raiseError";
import { getStateElementByName } from "../stateElementByName";
import { IBindingInfo } from "../types";
import { applyChange } from "./applyChange";
import { getRootNodeByFragment } from "./rootNodeByFragment";
import { IApplyContext } from "./types";

/**
 * バインディング情報の配列を処理し、各バインディングに対して状態の変更を適用する。
 * 
 * 最適化のため、以下のグループ化を行う:
 * 同じ stateNameとrootNode を持つバインディングをグループ化 → createState の呼び出しを削減
 */
export function applyChangeFromBindings(bindings: IBindingInfo[]): void {
  let bindingIndex = 0;
  const appliedBindingSet: Set<IBindingInfo> = new Set();
  const newListValueByAbsAddress: Map<IAbsoluteStateAddress, readonly unknown[]> = new Map();
  const updatedAbsAddressSetByStateElement: Map<IStateElement, Set<IAbsoluteStateAddress>> = new Map();

  // 外側ループ: stateName ごとにグループ化
  while(bindingIndex < bindings.length) {
    let binding = bindings[bindingIndex];
    const stateName = binding.stateName;
    if (binding.replaceNode.isConnected === false) {
      // 切断されているバインディングは無視、本来は事前に除去されているはず
      if (config.debug) {
        console.log(`applyChangeFromBindings: skip disconnected binding: ${binding.bindingType} ${binding.statePathName} on ${binding.node.nodeName}`, binding);
      }
      bindingIndex++;
      continue;
    }
    let rootNode: Node | null = binding.replaceNode.getRootNode() as Node;
    if (rootNode instanceof DocumentFragment && !(rootNode instanceof ShadowRoot)) {
      rootNode = getRootNodeByFragment(rootNode);
      if (rootNode === null) {
        raiseError(`Root node for fragment not found for binding.`);
      }
    }
    const stateElement = getStateElementByName(rootNode, stateName);
    if (stateElement === null) {
      raiseError(`State element with name "${stateName}" not found for binding.`);
    }

    stateElement.createState("readonly", (state) => {
      const context: IApplyContext = {
        rootNode: rootNode,
        stateName: stateName,
        stateElement: stateElement,
        state: state,
        appliedBindingSet: appliedBindingSet,
        newListValueByAbsAddress: newListValueByAbsAddress,
        updatedAbsAddressSetByStateElement: updatedAbsAddressSetByStateElement,
      };

      do {
        applyChange(binding, context);
        bindingIndex++;

        const nextBindingInfo: IBindingInfo | undefined = bindings[bindingIndex];
        if (!nextBindingInfo) break; // 終端に到達
        const nextRootNode = nextBindingInfo.replaceNode.getRootNode() as Node;
        if (nextBindingInfo.stateName !== stateName || nextRootNode !== context.rootNode) break; // stateName が変わった
        binding = nextBindingInfo;
      } while(true); // eslint-disable-line no-constant-condition
    });
  }
  for(const [ absAddress, newListValue ] of newListValueByAbsAddress.entries()) {
    setLastListValueByAbsoluteStateAddress(absAddress, newListValue);
  }
  for(const [ stateElement, absAddressSet ] of updatedAbsAddressSetByStateElement.entries()) {
    stateElement.createState("writable", (state) => {
      state[updatedCallbackSymbol](Array.from(absAddressSet));
    });
  }
}
