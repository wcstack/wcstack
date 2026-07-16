/**
 * eventToken.<propertyName>: <eventTokenName> バインディングの attach ハンドラ。
 *
 * command-token の双対（element→state）。要素が dispatch する CustomEvent を受けて
 * event-token を emit し、state 側の `$on` ハンドラ群へ pub/sub で配送する。
 *
 * 設計（MVP スコープ: wc-bindable カスタム要素のみ）:
 *   - キーは生イベント名ではなく **wcBindable property 名**。実 DOM イベント名は
 *     wcBindable.properties[].event から解決する（command-token が wcBindable.commands で
 *     検証するのと対称。コロンを含む namespaced event 名と binding 構文の `:` 衝突も回避）。
 *   - <prop> が wcBindable.properties に宣言されていることは attach 時に検証する
 *     （要素クラス参照のみで DOM 接続に非依存。fail-fast / typo 耐性）。
 *   - <eventTokenName> が $eventTokens に宣言されていることは **発火時** に検証する
 *     （state 解決が必要なため。詳細は下記の fire-time 解決の注記を参照）。
 *   - subscriber 引数規約は `(state, event, ...listIndexes)`。
 *   - modifier `#prevent` / `#stop` は既存イベント binding と同等にサポート。
 *
 * token はイベント発火ごとに registry から解決する（getOrCreateEventToken）。これにより
 * state の再 set で registry が作り直されても最新の subscriber 群へ配送できる。
 *
 * state element の解決と `$eventTokens` 検証は **発火時** に行う（attach 時ではない）。
 * 構造ブロック（for/if）や SSR hydration では、binding 初期化時にノードが detached な
 * DocumentFragment / wrapper 上にあり、その時点では element.getRootNode() から state を
 * 解決できないため。onclick / two-way ハンドラと同じく fire-time 解決に揃えている。
 */

import { getLoopContextByNode } from "../list/loopContextByNode";
import { setLoopContextSymbol } from "../proxy/symbols";
import { raiseError } from "../raiseError";
import { getStateElementByName } from "../stateElementByName";
import { getCustomElement } from "../getCustomElement";
import { getCustomElementRegistry } from "../platform/customElementRegistry";
import { readBindableDeclaration, ReadBindableResult } from "../protocol/wcBindableReader";
import { IBindingInfo } from "../types";
import { getOrCreateEventToken } from "./eventTokenRegistry";

interface IEventTokenListener {
  readonly eventName: string;
  readonly handler: (event: Event) => void;
}

const listenerByBinding: WeakMap<IBindingInfo, IEventTokenListener> = new WeakMap();

function getWcBindable(element: Element): ReadBindableResult | null {
  const customTagName = getCustomElement(element);
  if (customTagName === null) {
    return null;
  }
  // attach 側で未定義要素は whenDefined 後に再試行するため、ここに来る時点で customClass は定義済み。
  return readBindableDeclaration(element);
}

export function attachEventTokenHandler(binding: IBindingInfo): boolean {
  if (binding.propSegments[0] !== "eventToken") {
    return false;
  }
  const element = binding.node as Element;

  // カスタム要素が未定義なら定義後に再試行（wcBindable が必要なため）。
  const customTagName = getCustomElement(element);
  const registry = getCustomElementRegistry();
  if (customTagName !== null && registry?.get(customTagName) === undefined) {
    if (registry === null) {
      raiseError(`CustomElementRegistry is unavailable for <${customTagName}>.`);
    }
    return true;
  }

  // 再評価で二重 attach しない。
  if (listenerByBinding.has(binding)) {
    return true;
  }

  const propertyName = binding.propSegments[1];
  if (typeof propertyName !== "string" || propertyName.length === 0) {
    raiseError(`eventToken binding requires a property name (e.g., "eventToken.error").`);
  }

  const bindable = getWcBindable(element);
  if (bindable === null) {
    raiseError(`eventToken binding requires a wc-bindable custom element. <${element.tagName.toLowerCase()}> is not wc-bindable.`);
  }
  const propDesc = bindable.knownProperties.get(propertyName);
  if (typeof propDesc === "undefined") {
    raiseError(`Property "${propertyName}" is not declared in wcBindable.properties of <${element.tagName.toLowerCase()}>.`);
  }
  const eventName = propDesc.event;

  const tokenName = binding.statePathName;
  const stateName = binding.stateName;
  const modifiers = binding.propModifiers;
  const handler = (event: Event): void => {
    if (modifiers.includes("prevent")) event.preventDefault();
    if (modifiers.includes("stop")) event.stopPropagation();

    // state は発火時の live root から解決する（attach 時は detached の可能性があるため）。
    const rootNode = element.getRootNode() as Node;
    const stateElement = getStateElementByName(rootNode, stateName);
    if (stateElement === null) {
      raiseError(`State element with name "${stateName}" not found for eventToken handler.`);
    }
    if (!stateElement.eventTokenNames.has(tokenName)) {
      raiseError(`eventToken "${tokenName}" is not declared in $eventTokens of state "${stateName}".`);
    }
    const loopContext = getLoopContextByNode(element);
    stateElement.createStateAsync("writable", async (state) => {
      state[setLoopContextSymbol](loopContext, () => {
        const indexes = loopContext?.listIndex.indexes ?? [];
        const token = getOrCreateEventToken(stateElement, tokenName);
        return token.emit(state, event, ...indexes);
      });
    });
  };

  element.addEventListener(eventName, handler);
  listenerByBinding.set(binding, { eventName, handler });
  return true;
}

export function detachEventTokenHandler(binding: IBindingInfo): boolean {
  if (binding.propSegments[0] !== "eventToken") {
    return false;
  }
  const listener = listenerByBinding.get(binding);
  if (typeof listener === "undefined") {
    return false;
  }
  (binding.node as Element).removeEventListener(listener.eventName, listener.handler);
  listenerByBinding.delete(binding);
  return true;
}

export const __private__ = {
  listenerByBinding,
};
