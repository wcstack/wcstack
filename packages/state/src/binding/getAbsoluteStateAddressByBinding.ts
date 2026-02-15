import { getAbsolutePathInfo } from "../address/AbsolutePathInfo";
import { createAbsoluteStateAddress } from "../address/AbsoluteStateAddress";
import { IAbsoluteStateAddress } from "../address/types";
import { getRootNodeByFragment } from "../apply/rootNodeByFragment";
import { getListIndexByBindingInfo } from "../list/getListIndexByBindingInfo";
import { raiseError } from "../raiseError";
import { getStateElementByName } from "../stateElementByName";
import { IBindingInfo } from "./types";

const absoluteStateAddressByBinding: WeakMap<IBindingInfo, IAbsoluteStateAddress> = new WeakMap();

export function getAbsoluteStateAddressByBinding(binding: IBindingInfo): IAbsoluteStateAddress {
  // 切断されていても、キャッシュされていれば絶対状態アドレスを返す。
  let absoluteStateAddress: IAbsoluteStateAddress | null = null;
  absoluteStateAddress = absoluteStateAddressByBinding.get(binding) || null;
  if (absoluteStateAddress !== null) {
    return absoluteStateAddress;
  }

  let rootNode: Node | null = binding.replaceNode.getRootNode() as Node;
  // binding.replaceNodeはisConnected=trueになっていることが前提、切断されている場合はraiseErrorを返す
  if (binding.replaceNode.isConnected === false) {
    // DocumentFragmentでバッファリングされている場合は、ルートノードをDocumentFragmentから実際のルートノードに切り替える
    const rootNodeByFragment = getRootNodeByFragment(rootNode as DocumentFragment);
    if (rootNodeByFragment === null) {
      raiseError(`Cannot get absolute state address for disconnected binding: ${binding.bindingType} ${binding.statePathName} on ${binding.node.nodeName}`);
    } else {
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

export function clearAbsoluteStateAddressByBinding(binding: IBindingInfo) {
  absoluteStateAddressByBinding.delete(binding);
}