import { setLastListValueByAbsoluteStateAddress } from "../list/lastListValueByAbsoluteStateAddress";
import { raiseError } from "../raiseError";
import { getStateElementByName } from "../stateElementByName";
import { applyChange } from "./applyChange";
import { getRootNodeByFragment } from "./rootNodeByFragment";
/**
 * バインディング情報の配列を処理し、各バインディングに対して状態の変更を適用する。
 *
 * 最適化のため、以下のグループ化を行う:
 * 同じ stateNameとrootNode を持つバインディングをグループ化 → createState の呼び出しを削減
 */
export function applyChangeFromBindings(bindings) {
    let bindingIndex = 0;
    const appliedBindingSet = new Set();
    const newListValueByAbsAddress = new Map();
    // 外側ループ: stateName ごとにグループ化
    while (bindingIndex < bindings.length) {
        let binding = bindings[bindingIndex];
        const stateName = binding.stateName;
        let rootNode = binding.replaceNode.getRootNode();
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
            const context = {
                rootNode: rootNode,
                stateName: stateName,
                stateElement: stateElement,
                state: state,
                appliedBindingSet: appliedBindingSet,
                newListValueByAbsAddress: newListValueByAbsAddress
            };
            do {
                applyChange(binding, context);
                bindingIndex++;
                const nextBindingInfo = bindings[bindingIndex];
                if (!nextBindingInfo)
                    break; // 終端に到達
                const nextRootNode = nextBindingInfo.replaceNode.getRootNode();
                if (nextBindingInfo.stateName !== stateName || nextRootNode !== context.rootNode)
                    break; // stateName が変わった
                binding = nextBindingInfo;
            } while (true); // eslint-disable-line no-constant-condition
        });
    }
    for (const [absAddress, newListValue] of newListValueByAbsAddress.entries()) {
        setLastListValueByAbsoluteStateAddress(absAddress, newListValue);
    }
}
//# sourceMappingURL=applyChangeFromBindings.js.map