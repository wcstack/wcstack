import { ILoopContext } from "../list/types";
import { IBindingInfo } from "../types";
import { getStateElementByName } from "../stateElementByName";
import { raiseError } from "../raiseError";
import { replaceToReplaceNode } from "./replaceToReplaceNode";
import { collectNodesAndBindingInfos, collectNodesAndBindingInfosByFragment } from "./collectNodesAndBindingInfos";
import { IFragmentNodeInfo } from "../structural/types";
import { attachEventHandler } from "../event/handler";
import { attachTwowayEventHandler } from "../event/twowayHandler";
import { setLoopContextByNode } from "../list/loopContextByNode";
import { applyChangeFromBindings } from "../apply/applyChangeFromBindings";
import { IInitialBindingInfo } from "./types";
import { getAbsoluteStateAddressByBindingInfo } from "../binding/getAbsoluteStateAddressByBindingInfo";
import { addBindingByAbsoluteStateAddress } from "../binding/getBindingSetByAbsoluteStateAddress";
import { attachRadioEventHandler } from "../event/radioHandler";
import { attachCheckboxEventHandler } from "../event/checkboxHandler";

function _initializeBindings(
  allBindings: IBindingInfo[],
): void {
  for(const binding of allBindings) {

    // replace node
    replaceToReplaceNode(binding);

    // event
    if (attachEventHandler(binding)) {
      continue;
    }

    // two-way binding
    attachTwowayEventHandler(binding);
    // radio binding
    attachRadioEventHandler(binding);
    // checkbox binding
    attachCheckboxEventHandler(binding);

  }
}

export function initializeBindings(
  root: Document | DocumentFragment |Element, parentLoopContext: ILoopContext | null
): void {
  const [subscriberNodes, allBindings] = collectNodesAndBindingInfos(root);
  for(const node of subscriberNodes) {
    setLoopContextByNode(node, parentLoopContext);
  }
  _initializeBindings(allBindings);
  // create absolute state address and register binding infos
  for(const binding of allBindings) {
    const absoluteStateAddress = getAbsoluteStateAddressByBindingInfo(binding);
    addBindingByAbsoluteStateAddress(absoluteStateAddress, binding);
    const rootNode = binding.replaceNode.getRootNode() as Node;
    const stateElement = getStateElementByName(rootNode, binding.stateName);
    if (stateElement === null) {
      raiseError(`State element with name "${binding.stateName}" not found for binding.`);
    }
    if (binding.bindingType !== 'event') {
      stateElement.setPathInfo(binding.statePathName, binding.bindingType);
    }
  }
  // apply all at once
  applyChangeFromBindings(allBindings);
}

export function initializeBindingsByFragment(
  root: DocumentFragment,
  nodeInfos: IFragmentNodeInfo[], 
): IInitialBindingInfo {
  const [subscriberNodes, allBindings] = collectNodesAndBindingInfosByFragment(root, nodeInfos);
  _initializeBindings(allBindings);
  return {
    nodes: subscriberNodes,
    bindingInfos: allBindings,
  };
}
