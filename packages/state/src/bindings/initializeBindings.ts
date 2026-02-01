import { IStateElement } from "../components/types";
import { ILoopContext } from "../list/types";
import { IBindingInfo } from "../types";
import { getStateElementByName } from "../stateElementByName";
import { raiseError } from "../raiseError";
import { replaceToReplaceNode } from "./replaceToReplaceNode";
import { applyChange } from "../apply/applyChange";
import { collectNodesAndBindingInfos, collectNodesAndBindingInfosByFragment } from "./collectNodesAndBindingInfos";
import { IFragmentNodeInfo } from "../structural/types";
import { attachEventHandler } from "../event/handler";
import { attachTwowayEventHandler } from "../event/twowayHandler";
import { getLoopContextByNode, setLoopContextByNode } from "../list/loopContextByNode";

interface IApplyInfo {
  bindingInfo: IBindingInfo;
  value: any;
}

function _initializeBindings(
  allBindings: IBindingInfo[],
): void {
  const applyInfoList: IApplyInfo[] = [];
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
        applyInfoList.push({ bindingInfo, value: cacheValue });
      }
    });
  }

  // apply all at once
  for(const applyInfo of applyInfoList) {
    applyChange(applyInfo.bindingInfo, applyInfo.value);
  }
}

export  function initializeBindings(
  root: Document | Element, parentLoopContext: ILoopContext | null
): IBindingInfo[] {
  const [subscriberNodes, allBindings] = collectNodesAndBindingInfos(root);
  for(const node of subscriberNodes) {
    setLoopContextByNode(node, parentLoopContext);
  }
  _initializeBindings(allBindings);
  return allBindings;
}

export function initializeBindingsByFragment(
  root: DocumentFragment,
  nodeInfos: IFragmentNodeInfo[], 
  parentLoopContext: ILoopContext | null
): IBindingInfo[] {
  const [subscriberNodes, allBindings] = collectNodesAndBindingInfosByFragment(root, nodeInfos);
  for(const node of subscriberNodes) {
    setLoopContextByNode(node, parentLoopContext);
  }
  _initializeBindings(allBindings);
  return allBindings;
}
