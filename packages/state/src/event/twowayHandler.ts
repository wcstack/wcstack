import { isPossibleTwoWay } from "./isPossibleTwoWay";
import { EVENT_PROP_PREFIX, MODIFIER_READONLY } from "../define";
import { config } from "../config";
import { devtoolsSink } from "../platform/devtoolsSink";
import { getLoopContextByNode } from "../list/loopContextByNode";
import { beginPropagationTransaction, extendPropagationContext, getCurrentPropagationContext, getEdgeId, getWireId, matchWriteReceipt, runWithPropagationContext } from "../propagation/propagation";
import { raiseError } from "../raiseError";
import { getStateElement } from "../stateElementByName";
import { IBindingInfo, IFilterInfo } from "../types";
import { setLoopContextSymbol } from "../proxy/symbols";
import { getCustomElement } from "../getCustomElement";
import { getCustomElementRegistry } from "../platform/customElementRegistry";
import { readBindableDeclaration } from "../protocol/wcBindableReader";
import { filterListKey } from "../binding/filterKey";
import { createHandlerBindingRegistry } from "./handlerBindingRegistry";
import { beginOccurrenceWrite, endOccurrenceWrite } from "../proxy/occurrenceWrite";

const handlerByHandlerKey: Map<string, (event: Event) => any> = new Map();
// binding を強参照しない台帳（handlerBindingRegistry.ts のリーク解説を参照）
const bindingRegistry = /*#__PURE__*/ createHandlerBindingRegistry();
const producerValueObserversByNode = new WeakMap<Node, Map<string, Set<(value: unknown) => void>>>();

const DEFAULT_GETTER = (e: Event) => (e as CustomEvent).detail;

/**
 * 既定 getter（`(e) => e.detail`）が要素の宣言と噛み合っていない典型 2 形を、
 * 要素 × プロパティごとに 1 回だけ警告する（README「What the element writes back」）。
 *
 * (a) detail が undefined なのに `element[propName]` には値がある —
 *     CustomEvent でない Event を dispatch している / `detail` を付け忘れている
 * (b) detail が `{ <propName>: … }` の形のラッパーで、`element[propName]` はオブジェクトでない —
 *     `getter: (e) => e.detail.<propName>` が要る
 *
 * どちらも state には黙って undefined / ラッパーが書かれ、例外も lint 診断も出ない
 * （payload の形は静的に見えない）。挙動は変えない — 書き込みはそのまま行う。
 * occurrence（`semantics: "event"`）は payload が任意なので対象外（呼び出し側で除外）。
 */
const warnedDefaultGetter = new WeakMap<Element, Set<string>>();
function warnDefaultGetterMismatch(node: Element, propName: string, detail: unknown): void {
  const propValue = (node as any)[propName];
  let reason: string | null = null;
  if (typeof detail === "undefined") {
    if (typeof propValue !== "undefined") {
      reason = `the event carried no detail (undefined) while element.${propName} is ${typeof propValue}`;
    }
  } else if (
    detail !== null && typeof detail === "object" && Object.prototype.hasOwnProperty.call(detail, propName)
    && (propValue === null || typeof propValue !== "object")
  ) {
    reason = `the event's detail is an object with a "${propName}" key while element.${propName} is ${typeof propValue}`;
  }
  if (reason === null) return;
  let props = warnedDefaultGetter.get(node);
  if (typeof props === "undefined") {
    props = new Set();
    warnedDefaultGetter.set(node, props);
  }
  if (props.has(propName)) return;
  props.add(propName);
  console.warn(
    `[@wcstack/state] [wcs/default-getter-mismatch] <${node.tagName.toLowerCase()}> "${propName}": ${reason}. ` +
    `With no getter, state receives e.detail as-is. Dispatch the value itself as detail, or declare ` +
    `getter (e.g. (e) => e.detail.${propName}, or (e) => e.target.${propName}) on that wcBindable property.`
  );
}

/**
 * getter 関数ごとの安定した識別子。
 *
 * ハンドラのクロージャは `valueGetter` の**実体**を捕捉するのに、鍵は「getter があるか」の
 * 真偽しか持っていなかった。propName / イベント名 / state パス / フィルタ列が同じで getter だけ
 * 違う 2 つの wc-bindable タグを同じパスに繋ぐと、後から配線した方が**先のタグの getter で
 * 畳んだ値**を state に書く。`filterListKey` を入れて塞いだのと同じ不完全さが getter に残っていた。
 */
const getterIds = new WeakMap<object, number>();
let nextGetterId = 0;
function getterIdOf(valueGetter: ((event: Event) => any) | null): string {
  if (valueGetter === null) {
    return "n";
  }
  let id = getterIds.get(valueGetter);
  if (typeof id === "undefined") {
    getterIds.set(valueGetter, id = ++nextGetterId);
  }
  return `g${id}`;
}

/**
 * attach 時に控えた「何を、どのイベント名で付けたか」。**detach はここだけを見る。**
 *
 * `wcBindable` の宣言は live と規定されている（`protocol/wcBindableReader.ts`）ので、attach と
 * detach の間に差し替わりうる（composite shell は `target.constructor.wcBindable` で synthesized
 * 宣言を出すので絵空事ではない）。detach 側で作り直すと、宣言に依存する 3 つ — 二方向かの判定
 * （`isPossibleTwoWay`）、イベント名（`getEventName`）、ハンドラの鍵（`getHandlerKey`）— が
 * すべてずれうる。判定がずれれば門で早戻りしてリスナが残り、イベント名や鍵がずれれば
 * `removeEventListener` が空振りしてリスナが残る。**控えがあるかどうかが「attach したか」
 * そのもの**なので、detach は宣言を一切読み直さない。
 */
interface IAttachedTwoway {
  readonly key: string;
  readonly eventName: string;
}
const attachedByBinding = new WeakMap<IBindingInfo, IAttachedTwoway>();

function getHandlerKey(binding: IBindingInfo, eventName: string, valueGetter: ((event: Event) => any) | null, isOccurrence: boolean): string {
  const filterKey = filterListKey(binding.inFilters);
  return `${binding.propName}::${binding.statePathName}::${eventName}::${filterKey}::${getterIdOf(valueGetter)}::${isOccurrence ? 'o' : 's'}`;
}

function getEventName(binding: IBindingInfo): string {
  const tagName = (binding.node as Element).tagName.toLowerCase();
  // 1.default event name
  let eventName = (tagName === 'select') ? 'change' : 'input';
  // 2.wcBindable protocol
  const customTagName = getCustomElement(binding.node as Element);
  if (customTagName !== null) {
    const customClass = getCustomElementRegistry(binding.node)?.get(customTagName);
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
    if (valueGetter === DEFAULT_GETTER && !isOccurrence) {
      warnDefaultGetterMismatch(node, propName, newValue);
    }
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
    const wireId = getWireId(node, propName, statePathName);
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
  const stateElement = getStateElement(rootNode);
  if (stateElement === null) {
    raiseError(`No state tree found on this root for two-way binding.`);
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
    const registry = getCustomElementRegistry(binding.node);
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
    const key = getHandlerKey(binding, eventName, valueGetter, isOccurrence);
    attachedByBinding.set(binding, { key, eventName });
    let twowayEventHandler = handlerByHandlerKey.get(key);
    if (typeof twowayEventHandler === "undefined") {
      twowayEventHandler = twowayEventHandlerFunction(
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
  // 控えが無い ＝ attach していない（未定義のカスタム要素、二方向でないプロパティ、`#ro`）。
  // ここで `wcBindable` を読み直さないのが要点 — 理由は `attachedByBinding` の注記
  const attached = attachedByBinding.get(binding);
  if (typeof attached === "undefined") {
    return;
  }
  attachedByBinding.delete(binding);
  const twowayEventHandler = handlerByHandlerKey.get(attached.key);
  if (typeof twowayEventHandler === "undefined") {
    return;
  }
  (binding.node as Element).removeEventListener(attached.eventName, twowayEventHandler);

  if (bindingRegistry.remove(attached.key, binding)) {
    handlerByHandlerKey.delete(attached.key);
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
