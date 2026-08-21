import { isPossibleTwoWay } from "./isPossibleTwoWay";
import { EVENT_PROP_PREFIX, MODIFIER_READONLY } from "../define";
import { config } from "../config";
import { devtoolsSink } from "../devtools/sink";
import { getLoopContextByNode } from "../list/loopContextByNode";
import { beginPropagationTransaction, extendPropagationContext, getCurrentPropagationContext, getEdgeId, getWireId, matchWriteReceipt, runWithPropagationContext } from "../propagation/propagation";
import { raiseError } from "../raiseError";
import { getStateElementByName } from "../stateElementByName";
import { IBindingInfo, IFilterInfo } from "../types";
import { setLoopContextSymbol } from "../proxy/symbols";
import { getCustomElement } from "../getCustomElement";
import { getCustomElementRegistry } from "../platform/customElementRegistry";
import { readBindableDeclaration } from "../protocol/wcBindableReader";
import { createHandlerBindingRegistry } from "./handlerBindingRegistry";
import { beginOccurrenceWrite, endOccurrenceWrite } from "../proxy/occurrenceWrite";

const handlerByHandlerKey: Map<string, (event: Event) => any> = new Map();
// binding を強参照しない台帳（handlerBindingRegistry.ts のリーク解説を参照）
const bindingRegistry = createHandlerBindingRegistry();
const producerValueObserversByNode = new WeakMap<Node, Map<string, Set<(value: unknown) => void>>>();

const DEFAULT_GETTER = (e: Event) => (e as CustomEvent).detail;

function getHandlerKey(binding: IBindingInfo, eventName: string, hasGetter: boolean, isOccurrence: boolean): string {
  const filterKey = binding.inFilters.map(f => f.filterName + '(' + f.args.join(',') + ')').join('|');
  return `${binding.stateName}::${binding.propName}::${binding.statePathName}::${eventName}::${filterKey}::${hasGetter ? 'g' : 'n'}::${isOccurrence ? 'o' : 's'}`;
}

function getEventName(binding: IBindingInfo): string {
  const tagName = (binding.node as Element).tagName.toLowerCase();
  // 1.default event name
  let eventName = (tagName === 'select') ? 'change' : 'input';
  // 2.wcBindable protocol
  const customTagName = getCustomElement(binding.node as Element);
  if (customTagName !== null) {
    const customClass = getCustomElementRegistry()?.get(customTagName);
    if (typeof customClass === "undefined") {
      raiseError(`Custom element <${customTagName}> is not defined. Cannot determine event name for two-way binding.`);
    }
    const propDesc = readBindableDeclaration(binding.node)?.knownProperties.get(binding.propName);
    if (propDesc) {
      eventName = propDesc.event;
    }
  }
  // 3.modifier（`#onchange` 等 — `on` + イベント名の修飾子形。README「Modifiers」参照）
  for(const modifier of binding.propModifiers) {
    if (modifier.startsWith(EVENT_PROP_PREFIX)) {
      eventName = modifier.slice(EVENT_PROP_PREFIX.length);
    }
  }
  return eventName;
}

function getValueGetter(binding: IBindingInfo): ((event: Event) => any) | null {
  const customTagName = getCustomElement(binding.node as Element);
  if (customTagName !== null) {
    const propDesc = readBindableDeclaration(binding.node)?.knownProperties.get(binding.propName);
    if (propDesc) {
      return propDesc.getter ?? DEFAULT_GETTER;
    }
  }
  return null;
}

/**
 * producer が `semantics: "event"` を宣言した property か。occurrence は同じ payload でも
 * 「もう一度起きた」ことに意味があるため、state への書き込みで same-value guard を通さない
 * （docs/async-io-node-guidelines.md §3.3.1 の `event`）。宣言が無い property は従来どおり
 * — 未指定は「未指定」であって state ではないので、挙動は変えない。
 */
function isOccurrenceProperty(binding: IBindingInfo): boolean {
  const customTagName = getCustomElement(binding.node as Element);
  if (customTagName === null) return false;
  const propDesc = readBindableDeclaration(binding.node)?.knownProperties.get(binding.propName);
  return propDesc?.semantics === "event";
}

const twowayEventHandlerFunction = (
  stateName: string,
  propName: string,
  statePathName: string,
  inFilters: IFilterInfo[],
  valueGetter: ((event: Event) => any) | null,
  isOccurrence: boolean,
) => (event: Event): any => {
  const node = event.target as Element;
  if (node === null) {
    console.warn(`[@wcstack/state] event.target is null.`);
    return;
  }
  let newValue: any;
  if (valueGetter !== null) {
    newValue = valueGetter(event);
  } else {
    if (!(propName in node)) {
      console.warn(`[@wcstack/state] Property "${propName}" does not exist on target element.`);
      return;
    }
    newValue = (node as any)[propName];
  }
  let filteredNewValue = newValue;
  for(const filter of inFilters) {
    filteredNewValue = filter.filterFn(filteredNewValue);
  }
  const producerObservers = producerValueObserversByNode.get(node)?.get(propName);
  if (typeof producerObservers !== "undefined") {
    for (const observer of producerObservers) observer(filteredNewValue);
  }

  let propagationContext: ReturnType<typeof getCurrentPropagationContext> = null;
  if (config.enablePropagationContext) {
    // Phase 3: element → state edge の因果判定（設計書 §4）。
    const wireId = getWireId(node, propName, stateName, statePathName);
    const receipt = matchWriteReceipt(node, propName);
    if (receipt !== null && Object.is(receipt.writtenValue, newValue)) {
      // 規則 4: 同じ setter call stack 内で同じ member から Object.is 同値の
      // 通知が戻った場合だけ confirmation として再伝播を抑止する。
      // shadow diagnostic（§8）: primitive なら same-value guard も同じ結論に
      // なるため、provenance だけが守っている非 primitive の echo を可視化する。
      if (config.debug) {
        console.debug(`[@wcstack/state] propagation: write confirmation suppressed echo.`, {
          node,
          propName,
          statePathName,
          transactionId: receipt.transactionId,
          coveredBySameValueGuard: config.sameValueGuard
            && (filteredNewValue === null || typeof filteredNewValue !== "object"),
        });
      }
      if (devtoolsSink !== null) {
        devtoolsSink({
          type: "propagation:suppressed",
          reason: "confirmation",
          transactionId: receipt.transactionId,
          edgeId: getEdgeId(wireId, "to-state"),
          node,
          member: propName,
        });
      }
      return;
    }
    // receipt があるが値が異なる場合は正規化差分: element の確定値として受理し、
    // 新しい edge を通る変更として継続する（規則 5・decision gate）。
    const toStateEdgeId = getEdgeId(wireId, "to-state");
    const baseContext = getCurrentPropagationContext();
    if (baseContext !== null && baseContext.visitedEdges.has(toStateEdgeId)) {
      // 規則 2: 同じ transaction が同じ edge を再度通ろうとした場合だけ抑止
      if (devtoolsSink !== null) {
        devtoolsSink({
          type: "propagation:suppressed",
          reason: "visited-edge",
          transactionId: baseContext.transactionId,
          edgeId: toStateEdgeId,
          node,
          member: propName,
        });
      }
      return;
    }
    // 規則 1: 外部 event（受け皿の context が無い）なら新しい transaction を開始
    propagationContext = extendPropagationContext(
      baseContext ?? beginPropagationTransaction(wireId),
      toStateEdgeId,
    );
  }

  const rootNode = node.getRootNode() as Node;
  const stateElement = getStateElementByName(rootNode, stateName);
  if (stateElement === null) {
    raiseError(`State element with name "${stateName}" not found for two-way binding.`);
  }

  const loopContext = getLoopContextByNode(node);
  const commitToState = (): void => {
    // occurrence は同値でも取りこぼしてはならない（§3.3.1 `event`）。トークンは
    // setByAddress の最初のガード評価で消費されるため、この write 1 回だけに効く。
    if (isOccurrence) beginOccurrenceWrite();
    try {
      stateElement.createState("writable", (state) => {
        state[setLoopContextSymbol](loopContext, () => {
          state[statePathName] = filteredNewValue;
        });
      });
    } finally {
      if (isOccurrence) endOccurrenceWrite();
    }
  };
  if (propagationContext !== null) {
    runWithPropagationContext(propagationContext, commitToState);
  } else {
    commitToState();
  }
}

export function addTwowayValueObserver(
  node: Node,
  propName: string,
  observer: (value: unknown) => void,
): () => void {
  let byProperty = producerValueObserversByNode.get(node);
  if (typeof byProperty === "undefined") {
    byProperty = new Map();
    producerValueObserversByNode.set(node, byProperty);
  }
  let observers = byProperty.get(propName);
  if (typeof observers === "undefined") {
    observers = new Set();
    byProperty.set(propName, observers);
  }
  observers.add(observer);
  return () => {
    observers?.delete(observer);
    if (observers?.size === 0) byProperty?.delete(propName);
    if (byProperty?.size === 0) producerValueObserversByNode.delete(node);
  };
}

export function attachTwowayEventHandler(binding: IBindingInfo): void {
  const customTagName = getCustomElement(binding.node as Element);
  if (customTagName !== null) {
    const registry = getCustomElementRegistry();
    const customClass = registry?.get(customTagName);
    if (typeof customClass === "undefined") {
      if (registry === null) {
        raiseError(`CustomElementRegistry is unavailable for <${customTagName}>.`);
      }
      return;
    }
  }

  if (isPossibleTwoWay(binding.node, binding.propName) && binding.propModifiers.indexOf(MODIFIER_READONLY) === -1) {
    const eventName = getEventName(binding);
    const valueGetter = getValueGetter(binding);
    const isOccurrence = isOccurrenceProperty(binding);
    const key = getHandlerKey(binding, eventName, valueGetter !== null, isOccurrence);
    let twowayEventHandler = handlerByHandlerKey.get(key);
    if (typeof twowayEventHandler === "undefined") {
      twowayEventHandler = twowayEventHandlerFunction(
        binding.stateName,
        binding.propName,
        binding.statePathName,
        binding.inFilters,
        valueGetter,
        isOccurrence
      );
      handlerByHandlerKey.set(key, twowayEventHandler);
    }
    (binding.node as Element).addEventListener(eventName, twowayEventHandler);
    bindingRegistry.add(key, binding);
  }
}

export function detachTwowayEventHandler(binding: IBindingInfo): void {
  const customTagName = getCustomElement(binding.node as Element);
  if (customTagName !== null) {
    const registry = getCustomElementRegistry();
    const customClass = registry?.get(customTagName);
    if (typeof customClass === "undefined") {
      if (registry === null) {
        return;
      }
      return;
    }
  }

  if (isPossibleTwoWay(binding.node, binding.propName) && binding.propModifiers.indexOf(MODIFIER_READONLY) === -1) {
    const eventName = getEventName(binding);
    const valueGetter = getValueGetter(binding);
    const key = getHandlerKey(binding, eventName, valueGetter !== null, isOccurrenceProperty(binding));
    const twowayEventHandler = handlerByHandlerKey.get(key);
    if (typeof twowayEventHandler === "undefined") {
      return;
    }
    (binding.node as Element).removeEventListener(eventName, twowayEventHandler);

    if (bindingRegistry.remove(key, binding)) {
      handlerByHandlerKey.delete(key);
    }
  }
}

export const __private__ = {
  handlerByHandlerKey,
  bindingRegistry,
  producerValueObserversByNode,
  getHandlerKey,
  getEventName,
  getValueGetter,
  twowayEventHandlerFunction,
  DEFAULT_GETTER,
};
