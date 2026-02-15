import { getAbsolutePathInfo } from "../address/AbsolutePathInfo";
import { createAbsoluteStateAddress } from "../address/AbsoluteStateAddress";
import { getRootNodeByFragment } from "../apply/rootNodeByFragment";
import { getListIndexByBindingInfo } from "../list/getListIndexByBindingInfo";
import { raiseError } from "../raiseError";
import { getStateElementByName } from "../stateElementByName";
const absoluteStateAddressByBinding = new WeakMap();
export function getAbsoluteStateAddressByBinding(binding) {
    // 切断されていても、キャッシュされていれば絶対状態アドレスを返す。
    let absoluteStateAddress = null;
    absoluteStateAddress = absoluteStateAddressByBinding.get(binding) || null;
    if (absoluteStateAddress !== null) {
        return absoluteStateAddress;
    }
    let rootNode = binding.replaceNode.getRootNode();
    // binding.replaceNodeはisConnected=trueになっていることが前提、切断されている場合はraiseErrorを返す
    if (binding.replaceNode.isConnected === false) {
        // DocumentFragmentでバッファリングされている場合は、ルートノードをDocumentFragmentから実際のルートノードに切り替える
        const rootNodeByFragment = getRootNodeByFragment(rootNode);
        if (rootNodeByFragment === null) {
            raiseError(`Cannot get absolute state address for disconnected binding: ${binding.bindingType} ${binding.statePathName} on ${binding.node.nodeName}`);
        }
        else {
            rootNode = rootNodeByFragment;
        }
    }
    const listIndex = getListIndexByBindingInfo(binding);
    const stateElement = getStateElementByName(rootNode, binding.stateName);
    if (stateElement === null) {
        raiseError(`State element with name "${binding.stateName}" not found for binding.`);
    }
    const absolutePathInfo = getAbsolutePathInfo(stateElement, binding.statePathInfo);
    absoluteStateAddress =
        createAbsoluteStateAddress(absolutePathInfo, listIndex);
    absoluteStateAddressByBinding.set(binding, absoluteStateAddress);
    return absoluteStateAddress;
}
export function clearAbsoluteStateAddressByBinding(binding) {
    absoluteStateAddressByBinding.delete(binding);
}
//# sourceMappingURL=getAbsoluteStateAddressByBinding.js.map