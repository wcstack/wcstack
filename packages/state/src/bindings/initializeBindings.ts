import { ILoopContext } from "../list/types";
import { IBindingInfo } from "../types";
import { getStateElementByName } from "../stateElementByName";
import { raiseError } from "../raiseError";
import { replaceToReplaceNode } from "./replaceToReplaceNode";
import {
  collectNodesAndBindingInfos,
  collectNodesAndBindingInfosByFragment,
  IDeferredSpreadEntry,
  processDeferredNode,
} from "./collectNodesAndBindingInfos";
import { IFragmentNodeInfo } from "../structural/types";
import { attachEventHandler } from "../event/handler";
import { attachTwowayEventHandler } from "../event/twowayHandler";
import { setLoopContextByNode } from "../list/loopContextByNode";
import { applyChangeFromBindings } from "../apply/applyChangeFromBindings";
import { IInitialBindingInfo } from "./types";
import { getAbsoluteStateAddressByBinding } from "../binding/getAbsoluteStateAddressByBinding";
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

function _registerAbsoluteAddresses(allBindings: IBindingInfo[]): void {
  for(const binding of allBindings) {
    const absoluteStateAddress = getAbsoluteStateAddressByBinding(binding);
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
}

function _scheduleDeferredSpreads(
  deferredSpreads: IDeferredSpreadEntry[],
  parentLoopContext: ILoopContext | null,
): void {
  for (const entry of deferredSpreads) {
    customElements.whenDefined(entry.tagName).then(() => {
      if (!entry.node.isConnected) return; // node was removed before class became ready
      const bindings = processDeferredNode(entry);
      if (bindings.length === 0) return;
      setLoopContextByNode(entry.node, parentLoopContext);
      _initializeBindings(bindings);
      _registerAbsoluteAddresses(bindings);
      applyChangeFromBindings(bindings);
    }).catch((error: unknown) => {
      console.error(`[@wcstack/state] deferred spread failed for <${entry.tagName}>.`, error);
    });
  }
}

export function initializeBindings(
  root: Document | DocumentFragment |Element, parentLoopContext: ILoopContext | null
): void {
  const [subscriberNodes, allBindings, deferredSpreads] = collectNodesAndBindingInfos(root);
  for(const node of subscriberNodes) {
    setLoopContextByNode(node, parentLoopContext);
  }
  _initializeBindings(allBindings);
  _registerAbsoluteAddresses(allBindings);
  // apply all at once
  applyChangeFromBindings(allBindings);
  _scheduleDeferredSpreads(deferredSpreads, parentLoopContext);
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
