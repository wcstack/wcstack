/**
 * stream/streamNamespace.ts
 *
 * `$streamStatus` / `$streamError` の read-only namespace proxy
 * （docs/state-streams-design.md §4-1 / §4-2）。commandNamespace と対称。
 *
 * - state element 単位で memo 化し、同一 stateElement なら同じ proxy が返る。
 * - 宣言された stream 名（`$streams` に列挙されたもの）のみ registry entry の
 *   status / error を返す。宣言外の名前・Symbol キーは undefined
 *   （`then` / `constructor` 等を内部機構が触っても throw しない寛容規約、
 *    $command と同じ）。
 * - 値は memo しない: proxy は getStreamEntries を毎回読む thin gateway
 *   （status / error は runtime が随時書き換えるため。registry entry が正本、§2-1）。
 * - set / deleteProperty は raiseError。setByAddress の親走査が namespace proxy に
 *   到達したときの Reflect.set もここで落ちる（書き込み防御 S11 の終端）。
 */

import type { IStateElement } from "../components/types";
import {
  STATE_STREAM_ERROR_NAMESPACE_NAME,
  STATE_STREAM_STATUS_NAMESPACE_NAME,
} from "../define";
import { raiseError } from "../raiseError";
import { getStreamEntries } from "./streamRegistry";
import type { IStreamEntry } from "./types";

const statusNamespaceByStateElement: WeakMap<IStateElement, object> = new WeakMap();
const errorNamespaceByStateElement: WeakMap<IStateElement, object> = new WeakMap();

function createStreamNamespaceProxy(
  stateElement: IStateElement,
  namespaceName: string,
  pick: (entry: IStreamEntry) => unknown,
): object {
  return new Proxy(Object.create(null), {
    get(_target: object, prop: PropertyKey): unknown {
      if (typeof prop !== "string") {
        return undefined;
      }
      const entry = getStreamEntries(stateElement).get(prop);
      if (typeof entry === "undefined") {
        return undefined;
      }
      return pick(entry);
    },
    has(_target: object, prop: PropertyKey): boolean {
      return typeof prop === "string" && getStreamEntries(stateElement).has(prop);
    },
    ownKeys(): string[] {
      return Array.from(getStreamEntries(stateElement).keys());
    },
    getOwnPropertyDescriptor(_target: object, prop: PropertyKey): PropertyDescriptor | undefined {
      if (typeof prop !== "string") {
        return undefined;
      }
      const entry = getStreamEntries(stateElement).get(prop);
      if (typeof entry === "undefined") {
        return undefined;
      }
      return {
        configurable: true,
        enumerable: true,
        value: pick(entry),
      };
    },
    set(): boolean {
      raiseError(`${namespaceName} namespace is read-only; assigning to it is not allowed.`);
    },
    deleteProperty(): boolean {
      raiseError(`${namespaceName} namespace is read-only; deleting from it is not allowed.`);
    },
  });
}

export function getStreamStatusNamespace(stateElement: IStateElement): object {
  const cached = statusNamespaceByStateElement.get(stateElement);
  if (typeof cached !== "undefined") {
    return cached;
  }
  const proxy = createStreamNamespaceProxy(
    stateElement,
    STATE_STREAM_STATUS_NAMESPACE_NAME,
    (entry) => entry.status,
  );
  statusNamespaceByStateElement.set(stateElement, proxy);
  return proxy;
}

export function getStreamErrorNamespace(stateElement: IStateElement): object {
  const cached = errorNamespaceByStateElement.get(stateElement);
  if (typeof cached !== "undefined") {
    return cached;
  }
  const proxy = createStreamNamespaceProxy(
    stateElement,
    STATE_STREAM_ERROR_NAMESPACE_NAME,
    (entry) => entry.error,
  );
  errorNamespaceByStateElement.set(stateElement, proxy);
  return proxy;
}

/**
 * 両 namespace proxy の memo を破棄する（clearCommandNamespace と対称）。
 * disconnectedCallback と `_state` 再 set 時に呼ばれる。
 */
export function clearStreamNamespace(stateElement: IStateElement): void {
  statusNamespaceByStateElement.delete(stateElement);
  errorNamespaceByStateElement.delete(stateElement);
}

export const __private__ = {
  statusNamespaceByStateElement,
  errorNamespaceByStateElement,
};
