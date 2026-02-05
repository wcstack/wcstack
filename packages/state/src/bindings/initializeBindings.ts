import { IStateElement } from "../components/types";
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
import { addBindingInfoByAbsoluteStateAddress } from "../binding/getBindingInfosByAbsoluteStateAddress";

function _initializeBindings(
  allBindings: IBindingInfo[],
): void {
  const bindingsByStateElement = new Map<IStateElement, IBindingInfo[]>();
  for(const bindingInfo of allBindings) {
    const stateElement = getStateElementByName(bindingInfo.stateName);
    if (stateElement === null) {
      raiseError(`State element with name "${bindingInfo.stateName}" not found for binding.`);
    }

    // replace node
    replaceToReplaceNode(bindingInfo);

    // event
    if (attachEventHandler(bindingInfo)) {
      continue;
    }

    // two-way binding
    attachTwowayEventHandler(bindingInfo);

    // register binding
    stateElement.setBindingInfo(bindingInfo);

    // group by state element
    let bindings = bindingsByStateElement.get(stateElement);
    if (typeof bindings === "undefined") {
      bindingsByStateElement.set(stateElement, [ bindingInfo ]);
    } else {
      bindings.push(bindingInfo);
    }
  }
}

export function initializeBindings(
  root: Document | Element, parentLoopContext: ILoopContext | null
): void {
  const [subscriberNodes, allBindings] = collectNodesAndBindingInfos(root);
  for(const node of subscriberNodes) {
    setLoopContextByNode(node, parentLoopContext);
  }
  _initializeBindings(allBindings);
  // create absolute state address and register binding infos
  for(const binding of allBindings) {
    const absoluteStateAddress = getAbsoluteStateAddressByBindingInfo(binding);
    addBindingInfoByAbsoluteStateAddress(absoluteStateAddress, binding);
  }
  // apply all at once
  applyChangeFromBindings(allBindings);
}

export function initializeBindingsByFragment(
  root: DocumentFragment,
  nodeInfos: IFragmentNodeInfo[], 
//  loopContext: ILoopContext | null
): IInitialBindingInfo {
  const [subscriberNodes, allBindings] = collectNodesAndBindingInfosByFragment(root, nodeInfos);
//  for(const node of subscriberNodes) {
//    setLoopContextByNode(node, loopContext);
//  }
  _initializeBindings(allBindings);
  return {
    nodes: subscriberNodes,
    bindingInfos: allBindings,
  };
}
