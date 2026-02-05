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
import { getLoopContextByNode, setLoopContextByNode } from "../list/loopContextByNode";
import { applyChangeFromBindings } from "../apply/applyChangeFromBindings";
import { IInitialBindingInfo } from "./types";

function _initializeBindings(
  allBindings: IBindingInfo[],
): void {
  const applyBindings: IBindingInfo[] = [];
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
    stateElement.addBindingInfo(bindingInfo);

    // group by state element
    let bindings = bindingsByStateElement.get(stateElement);
    if (typeof bindings === "undefined") {
      bindingsByStateElement.set(stateElement, [ bindingInfo ]);
    } else {
      bindings.push(bindingInfo);
    }
  }

  // get apply values from cache and state
  for(const [stateElement, bindings] of bindingsByStateElement.entries()) {
    const cacheValueByPath = new Map<string, any>();
    stateElement.createState("readonly", (state) => {
      for(const bindingInfo of bindings) {
        let cacheValue = cacheValueByPath.get(bindingInfo.statePathName);
        if (typeof cacheValue === "undefined") {
          const loopContext = getLoopContextByNode(bindingInfo.node);
          cacheValue = state.$$setLoopContext(loopContext, () => {
            return state[bindingInfo.statePathName];
          });
          cacheValueByPath.set(bindingInfo.statePathName, cacheValue);
        }
        applyBindings.push(bindingInfo);
      }
    });
  }

  // apply all at once
  applyChangeFromBindings(applyBindings);
}

export  function initializeBindings(
  root: Document | Element, parentLoopContext: ILoopContext | null
): IInitialBindingInfo {
  const [subscriberNodes, allBindings] = collectNodesAndBindingInfos(root);
  for(const node of subscriberNodes) {
    setLoopContextByNode(node, parentLoopContext);
  }
  _initializeBindings(allBindings);
  return {
    nodes: subscriberNodes,
    bindingInfos: allBindings,
  };
}

export function initializeBindingsByFragment(
  root: DocumentFragment,
  nodeInfos: IFragmentNodeInfo[], 
  loopContext: ILoopContext | null
): IInitialBindingInfo {
  const [subscriberNodes, allBindings] = collectNodesAndBindingInfosByFragment(root, nodeInfos);
  for(const node of subscriberNodes) {
    setLoopContextByNode(node, loopContext);
  }
  _initializeBindings(allBindings);
  return {
    nodes: subscriberNodes,
    bindingInfos: allBindings,
  };
}
