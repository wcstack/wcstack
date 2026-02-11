import { isCustomElement } from "../components/isCustomElement.js";
import { config } from "../config.js";
import { raiseError } from "../raiseError.js";
import { getStateElementByName } from "../stateElementByName.js";
import { IBindingInfo } from "../types.js";
import { applyChangeToAttribute } from "./applyChangeToAttribute.js";
import { applyChangeToClass } from "./applyChangeToClass.js";
import { applyChangeToFor } from "./applyChangeToFor.js";
import { applyChangeToIf } from "./applyChangeToIf.js";
import { applyChangeToProperty } from "./applyChangeToProperty.js";
import { applyChangeToStyle } from "./applyChangeToStyle.js";
import { applyChangeToText } from "./applyChangeToText.js";
import { getFilteredValue } from "./getFilteredValue.js";
import { getValue } from "./getValue.js";
import { getRootNodeByFragment } from "./rootNodeByFragment.js";
import { ApplyChangeFn, IApplyContext } from "./types.js";

const applyChangeByFirstSegment: { [key: string]: ApplyChangeFn } = {
  "class": applyChangeToClass,
  "attr": applyChangeToAttribute,
  "style": applyChangeToStyle,
};

const applyChangeByBindingType: { [key: string]: ApplyChangeFn } = {
  "text": applyChangeToText,
  "for": applyChangeToFor,
  "if": applyChangeToIf,
  "else": applyChangeToIf,
  "elseif": applyChangeToIf,
};

function _applyChange(binding: IBindingInfo, context: IApplyContext): void {
  const value = getValue(context.state, binding);
  const filteredValue = getFilteredValue(value, binding.outFilters);

  let fn = applyChangeByBindingType[binding.bindingType];
  if (typeof fn === 'undefined') {
    const firstSegment = binding.propSegments[0];
    fn = applyChangeByFirstSegment[firstSegment];
    if (typeof fn === 'undefined') {
      fn = applyChangeToProperty;
    }
  }
  fn(binding, context, filteredValue);
}

export function applyChange(binding: IBindingInfo, context: IApplyContext): void {
  if (context.appliedBindingSet.has(binding)) {
    return;
  }
  if(config.debug) {
    console.log(`applyChange: ${binding.bindingType} ${binding.statePathName} on ${binding.node.nodeName}`, binding);
  }
  context.appliedBindingSet.add(binding);
  if (binding.bindingType === "event") {
    return;
  }
  if (isCustomElement(binding.replaceNode)) {
    const element = binding.replaceNode as Element;
    if (customElements.get(element.tagName.toLowerCase()) === undefined) {
      // cutomElement側の初期化を期待
      return;
    }
  }
  let rootNode: Node | null = binding.replaceNode.getRootNode() as Node;
  if (rootNode instanceof DocumentFragment && !(rootNode instanceof ShadowRoot)) {
    rootNode = getRootNodeByFragment(rootNode);
    if (rootNode === null) {
      raiseError(`Root node for fragment not found for binding.`);
    }
  }
  if (binding.stateName !== context.stateName || rootNode !== context.rootNode) {
    const stateElement = getStateElementByName(rootNode, binding.stateName);
    if (stateElement === null) {
      raiseError(`State element with name "${binding.stateName}" not found for binding.`);
    }
    stateElement.createState("readonly", (targetState) => {
      const newContext = {
        stateName: binding.stateName,
        rootNode: rootNode,
        stateElement: stateElement,
        state: targetState,
        appliedBindingSet: context.appliedBindingSet,
        newListValueByAbsAddress: context.newListValueByAbsAddress,
      }
      _applyChange(binding, newContext);
    });
  } else {
    _applyChange(binding, context);
  }
}
