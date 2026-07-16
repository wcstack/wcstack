import { getAbsoluteStateAddressByBinding } from "../binding/getAbsoluteStateAddressByBinding.js";
import { getBindingSession } from "../bindings/BindingSession.js";
import { getCustomElement } from "../getCustomElement.js";
import { getCustomElementRegistry } from "../platform/customElementRegistry.js";
import { raiseError } from "../raiseError.js";
import { getStateElementByName } from "../stateElementByName.js";
import { IBindingInfo } from "../types.js";
import { isWebComponentComplete } from "../webComponent/completeWebComponent.js";
import { applyChangeToAttribute } from "./applyChangeToAttribute.js";
import { applyChangeToCheckbox } from "./applyChangeToCheckbox.js";
import { applyChangeToClass } from "./applyChangeToClass.js";
import { applyChangeToCommand } from "./applyChangeToCommand.js";
import { applyChangeToFor } from "./applyChangeToFor.js";
import { applyChangeToIf } from "./applyChangeToIf.js";
import { applyChangeToProperty } from "./applyChangeToProperty.js";
import { applyChangeToRadio } from "./applyChangeToRadio.js";
import { applyChangeToStyle } from "./applyChangeToStyle.js";
import { applyChangeToText } from "./applyChangeToText.js";
import { applyChangeToWebComponent } from "./applyChangeToWebComponent.js";
import { getFilteredValue } from "./getFilteredValue.js";
import { getValue } from "./getValue.js";
import { getRootNodeByFragment } from "./rootNodeByFragment.js";
import { scheduleDeferredApply } from "./scheduleDeferredApply.js";
import { ApplyChangeFn, IApplyContext } from "./types.js";

const applyChangeByFirstSegment: { [key: string]: ApplyChangeFn } = {
  "class": applyChangeToClass,
  "attr": applyChangeToAttribute,
  "style": applyChangeToStyle,
  "command": applyChangeToCommand,
};

const applyChangeByBindingType: { [key: string]: ApplyChangeFn } = {
  "text": applyChangeToText,
  "for": applyChangeToFor,
  "if": applyChangeToIf,
  "else": applyChangeToIf,
  "elseif": applyChangeToIf,
  "radio": applyChangeToRadio,
  "checkbox": applyChangeToCheckbox,
};

const fnByBinding: WeakMap<IBindingInfo, ApplyChangeFn> = new WeakMap();
const deferredSelectBindingByBinding: WeakMap<IBindingInfo, boolean> = new WeakMap();

function _applyChange(binding: IBindingInfo, context: IApplyContext): void {
  const value = getValue(context.state, binding);
  const filteredValue = getFilteredValue(value, binding.outFilters);

  if (deferredSelectBindingByBinding.get(binding) === true) {
    context.deferredSelectBindings.push({ binding, value: filteredValue });
    return;
  }
  let fn = fnByBinding.get(binding);
  if (typeof fn !== 'undefined') {
    fn(binding, context, filteredValue);
    return;
  }
  if (fnByBinding.has(binding)) {
    if (isWebComponentComplete(binding.replaceNode as Element, context.stateElement)) {
      fn = applyChangeToWebComponent;
      fnByBinding.set(binding, fn); // 確定したのでキャッシュ
    } else {
      fn = applyChangeToProperty;
    }
    fn(binding, context, filteredValue);
    return;
  }

  fn = applyChangeByBindingType[binding.bindingType];
  if (typeof fn === 'undefined') {
    const firstSegment = binding.propSegments[0];
    fn = applyChangeByFirstSegment[firstSegment];
    fnByBinding.set(binding, fn);
    if (typeof fn === 'undefined') {
      const customTag = getCustomElement(binding.replaceNode);
      if (customTag) {
        if (isWebComponentComplete(binding.replaceNode as Element, context.stateElement)) {
          fn = applyChangeToWebComponent;
          fnByBinding.set(binding, fn); // 確定したのでキャッシュ
        } else {
          fn = applyChangeToProperty;
        }
      } else {
        fn = applyChangeToProperty;
        fnByBinding.set(binding, fn);
      }
    }
  }
  if (fn === applyChangeToProperty) {
    const element = binding.node as Element;
    if (element.tagName === 'SELECT') {
      const propName = binding.propSegments[0];
      if (propName === 'value' || propName === 'selectedIndex') {
        context.deferredSelectBindings.push({ binding, value: filteredValue });
        deferredSelectBindingByBinding.set(binding, true);
        return;
      }
    }
  }
  fn(binding, context, filteredValue);
}

export function applyChange(binding: IBindingInfo, context: IApplyContext): void {
  if (context.appliedBindingSet.has(binding)) {
    return;
  }
  context.appliedBindingSet.add(binding);
  // $updatedCallback が定義されていない state では、更新アドレスの集計自体が
  // 不要（drain 終端の呼び出しごと省略される）。大量バインディング適用時の
  // Set 蓄積を避ける。undefined（テスト用モック等）は従来通り集計する。
  if (context.stateElement.hasUpdatedCallback !== false) {
    const absAddress = getAbsoluteStateAddressByBinding(binding);
    if (context.updatedAbsAddressSetByStateElement.has(context.stateElement)) {
      const addressSet = context.updatedAbsAddressSetByStateElement.get(context.stateElement)!;
      addressSet.add(absAddress);
    } else {
      context.updatedAbsAddressSetByStateElement.set(context.stateElement, new Set([
        absAddress
      ]));
    }
  }
  const bindingSession = getBindingSession(binding);
  if (bindingSession !== null && !bindingSession.shouldApplyState(binding)) {
    return;
  }
  if (binding.bindingType === "event") {
    return;
  }
  const customTag = getCustomElement(binding.replaceNode);
  if (customTag) {
    if (getCustomElementRegistry()?.get(customTag) === undefined) {
      // 未 define のカスタム要素へは今は適用できない（accessor 未確立の要素に
      // 素の own property を書くと upgrade 後に class accessor を隠してしまう）。
      // whenDefined 後に最新 state 値で再適用する（two-way attach / deferred
      // spread と対称。docs/state-binding-init-races.md §2）。
      scheduleDeferredApply(binding, customTag);
      return;
    }
  }
  // applyChangeFromBindings のグループ化ループが解決済みルートの一致を検証済みの
  // 場合、stateName さえ一致すれば getRootNode の再解決（native 呼び出し）を省略
  // できる。activateContent 経由（フラグメント内の新規 content）も、フラグメントは
  // setRootNodeByFragment で context.rootNode に解決されるため同じ不変条件が成り立つ。
  if (context.sameRootVerified === true && binding.stateName === context.stateName) {
    _applyChange(binding, context);
    return;
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
        updatedAbsAddressSetByStateElement: context.updatedAbsAddressSetByStateElement,
        deferredSelectBindings: context.deferredSelectBindings,
      }
      _applyChange(binding, newContext);
    });
  } else {
    _applyChange(binding, context);
  }
}
