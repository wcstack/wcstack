import { applyChangeToNode } from "../applyChangeToNode";
import { IStateElement } from "../components/types";
import { getBindingInfos } from "./getBindingInfos";
import { getSubscriberNodes } from "./getSubscriberNodes";
import { isPossibleTwoWay } from "./isPossibleTwoWay";
import { setListIndexByNode } from "../list/listIndexByNode";
import { IListIndex } from "../list/types";
import { IBindingInfo } from "../types";
import { getStateElementByName } from "../stateElementByName";
import { raiseError } from "../raiseError";
import { replaceToComment } from "./replaceToComment";
import { STRUCTURAL_BINDING_TYPE_SET } from "../structural/define";
import { getContentByNode, setContentByNode } from "../structural/contentByNode";
import { createContent } from "../structural/createContent";

const registeredNodeSet = new WeakSet<Node>();

interface IApplyInfo {
  bindingInfo: IBindingInfo;
  value: any;
}

export async function initializeBindings(root: Document | Element | DocumentFragment, parentListIndex: IListIndex | null): Promise<void> {
  const subscriberNodes = getSubscriberNodes(root);
  const allBindings: IBindingInfo[] = [];
  subscriberNodes.forEach(node => {
    if (!registeredNodeSet.has(node)) {
      registeredNodeSet.add(node);
      setListIndexByNode(node, parentListIndex);
      const bindings = getBindingInfos(node);
      allBindings.push(...bindings);
    }
  });
  const applyInfoList: IApplyInfo[] = [];
  const cacheValueByPathByStateElement = new Map<IStateElement, Map<string, any>>();
  for(const bindingInfo of allBindings) {
    const stateElement = getStateElementByName(bindingInfo.stateName);
    if (stateElement === null) {
      raiseError(`State element with name "${bindingInfo.stateName}" not found for binding.`);
    }

    // replace to comment node
    replaceToComment(bindingInfo);

    // structural content
    if (STRUCTURAL_BINDING_TYPE_SET.has(bindingInfo.bindingType)) {
      if (!(bindingInfo.rawNode instanceof HTMLTemplateElement)) {
        raiseError(`The element with special binding property "${bindingInfo.propName}" must be a <template> element.`);
      }
      if (getContentByNode(bindingInfo.node) === null) {
        const template: HTMLTemplateElement = bindingInfo.rawNode;
        const content = createContent(template.content);
        setContentByNode(bindingInfo.node, content);
      }
    }

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
        stateElement.state[bindingInfo.statePathName] = newValue;
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
    const value = stateElement.state[bindingInfo.statePathName];
    applyInfoList.push({ bindingInfo, value });

    // set cache value
    cacheValueByPath.set(bindingInfo.statePathName, value);
  }

  // apply all at once
  for(const applyInfo of applyInfoList) {
    applyChangeToNode(applyInfo.bindingInfo.node, applyInfo.bindingInfo.propSegments, applyInfo.value);
  }
}