/**
 * `state.$command` でアクセスされる command token の namespace proxy を提供する。
 *
 * - state element 単位で memo 化し、同一 stateElement なら同じ proxy が返る。
 * - 宣言された名前 (`$commandTokens` に列挙されたもの) のみ token を返す。
 *   宣言外の名前にアクセスした場合は undefined を返す。
 *   （`constructor` / `Symbol.toPrimitive` / `then` など内部システムが触るキーで
 *    例外を投げないため。typo は subsequent な `.emit()` 呼び出しで TypeError として
 *    間接的に表面化する。）
 * - token そのものの memo は `getOrCreateCommandToken` 側に集約されており、
 *   namespace proxy は薄いゲートウェイとして振る舞う。
 */

import { IStateElement } from "../components/types";
import { raiseError } from "../raiseError";
import { getOrCreateCommandToken } from "./commandTokenRegistry";
import { ICommandToken } from "./types";

const namespaceProxyByStateElement: WeakMap<IStateElement, object> = new WeakMap();

export function getCommandNamespace(stateElement: IStateElement): object {
  const cached = namespaceProxyByStateElement.get(stateElement);
  if (typeof cached !== "undefined") {
    return cached;
  }
  const proxy = new Proxy(Object.create(null), {
    get(_target: object, prop: PropertyKey): ICommandToken | undefined {
      if (typeof prop !== "string") {
        return undefined;
      }
      if (!stateElement.commandTokenNames.has(prop)) {
        return undefined;
      }
      return getOrCreateCommandToken(stateElement, prop);
    },
    has(_target: object, prop: PropertyKey): boolean {
      return typeof prop === "string" && stateElement.commandTokenNames.has(prop);
    },
    ownKeys(): string[] {
      return Array.from(stateElement.commandTokenNames);
    },
    getOwnPropertyDescriptor(_target: object, prop: PropertyKey): PropertyDescriptor | undefined {
      if (typeof prop === "string" && stateElement.commandTokenNames.has(prop)) {
        return {
          configurable: true,
          enumerable: true,
          value: getOrCreateCommandToken(stateElement, prop),
        };
      }
      return undefined;
    },
    set(): boolean {
      raiseError(`$command namespace is read-only; assigning to it is not allowed.`);
    },
    deleteProperty(): boolean {
      raiseError(`$command namespace is read-only; deleting from it is not allowed.`);
    },
  });
  namespaceProxyByStateElement.set(stateElement, proxy);
  return proxy;
}

export function clearCommandNamespace(stateElement: IStateElement): void {
  namespaceProxyByStateElement.delete(stateElement);
}

export const __private__ = {
  namespaceProxyByStateElement,
};
