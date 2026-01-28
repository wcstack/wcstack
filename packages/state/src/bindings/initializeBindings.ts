import { IStateElement } from "../components/types";
import { isPossibleTwoWay } from "./isPossibleTwoWay";
import { getListIndexByNode, setListIndexByNode } from "../list/listIndexByNode";
import { IListIndex } from "../list/types";
import { IBindingInfo } from "../types";
import { getStateElementByName } from "../stateElementByName";
import { raiseError } from "../raiseError";
import { replaceToComment } from "./replaceToComment";
import { applyChange } from "../apply/applyChange";
import { collectNodesAndBindingInfos, collectNodesAndBindingInfosByFragment } from "./collectNodesAndBindingInfos";
import { IFragmentNodeInfo } from "../structural/types";

interface IApplyInfo {
  bindingInfo: IBindingInfo;
  value: any;
}

async function _initializeBindings(
  allBindings: IBindingInfo[]
): Promise<void> {
  const applyInfoList: IApplyInfo[] = [];
  const cacheValueByPathByStateElement = new Map<IStateElement, Map<string, any>>();
  for(const bindingInfo of allBindings) {
    const stateElement = getStateElementByName(bindingInfo.stateName);
    if (stateElement === null) {
      raiseError(`State element with name "${bindingInfo.stateName}" not found for binding.`);
    }

    // replace to comment node
    replaceToComment(bindingInfo);

    // event
    if (bindingInfo.propName.startsWith("on")) {
      const eventName = bindingInfo.propName.slice(2);
      (bindingInfo.node as Element).addEventListener(eventName, (event: Event) => {
        const handler = stateElement.state[bindingInfo.statePathName];
        if (typeof handler === "function") {
          handler.call(stateElement.state, event);
        }
      });
      continue;
    }

    // two-way binding
    if (isPossibleTwoWay(bindingInfo.node, bindingInfo.propName) && bindingInfo.propModifiers.indexOf('ro') === -1) {
      const tagName = (bindingInfo.node as Element).tagName.toLowerCase();
      let eventName = (tagName === 'select') ? 'change' : 'input';
      for(const modifier of bindingInfo.propModifiers) {
        if (modifier.startsWith('on')) {
          eventName = modifier.slice(2);
        }
      }
      (bindingInfo.node as Element).addEventListener(eventName, (event: Event) => {
        const target = event.target as Element;
        if (typeof target === "undefined") {
          console.warn(`[@wcstack/state] event.target is undefined.`);
          return;
        }
        if (!(bindingInfo.propName in target)) {
          console.warn(`[@wcstack/state] Property "${bindingInfo.propName}" does not exist on target element.`);
          return;
        }
        const newValue = (target as any)[bindingInfo.propName];
        const state = stateElement.state;

        const listIndex = getListIndexByNode(bindingInfo.node);
        state.$stack(listIndex, () => {
          stateElement.state[bindingInfo.statePathName] = newValue;
        });
      });
    }

    // register binding
    stateElement.addBindingInfo(bindingInfo);

    // get cache value
    let cacheValueByPath = cacheValueByPathByStateElement.get(stateElement);
    if (typeof cacheValueByPath === "undefined") {
      cacheValueByPath = new Map<string, any>();
      cacheValueByPathByStateElement.set(stateElement, cacheValueByPath);
    }
    const cacheValue = cacheValueByPath.get(bindingInfo.statePathName);
    if (typeof cacheValue !== "undefined") {
      // apply cached value
      applyInfoList.push({ bindingInfo, value: cacheValue });
      continue;
    }

    // apply initial value
    await stateElement.initializePromise;
    const listIndex = getListIndexByNode(bindingInfo.node);
    const state = stateElement.state;
    const value = state.$stack(listIndex, () => {
      return state[bindingInfo.statePathName];
    });
    applyInfoList.push({ bindingInfo, value });

    // set cache value
    cacheValueByPath.set(bindingInfo.statePathName, value);
  }

  // apply all at once
  for(const applyInfo of applyInfoList) {
    applyChange(applyInfo.bindingInfo, applyInfo.value);
  }
}

export async function initializeBindings(root: Document | Element, parentListIndex: IListIndex | null): Promise<void> {
  const [subscriberNodes, allBindings] = collectNodesAndBindingInfos(root);
  for(const node of subscriberNodes) {
    if (parentListIndex !== null) {
      setListIndexByNode(node, parentListIndex);
    }
  }
  await _initializeBindings(allBindings);
}

export async function initializeBindingsByFragment(
  root: DocumentFragment,
  nodeInfos: IFragmentNodeInfo[], 
  parentListIndex: IListIndex | null
): Promise<void> {
  const [subscriberNodes, allBindings] = collectNodesAndBindingInfosByFragment(root, nodeInfos);
  for(const node of subscriberNodes) {
    if (parentListIndex !== null) {
      setListIndexByNode(node, parentListIndex);
    }
  }
  await _initializeBindings(allBindings);
}
