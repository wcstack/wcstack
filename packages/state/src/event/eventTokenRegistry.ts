import { IStateElement } from "../components/types";
import { EventToken } from "./EventToken";

const registryByStateElement: WeakMap<IStateElement, Map<string, EventToken>> = new WeakMap();

export function getOrCreateEventToken(stateElement: IStateElement, name: string): EventToken {
  let registry = registryByStateElement.get(stateElement);
  if (typeof registry === "undefined") {
    registry = new Map<string, EventToken>();
    registryByStateElement.set(stateElement, registry);
  }
  let token = registry.get(name);
  if (typeof token === "undefined") {
    // stateElement を渡すのは devtools のツリー識別（protocol v2 追補）のため
    token = new EventToken(name, stateElement);
    registry.set(name, token);
  }
  return token;
}

export function clearEventTokenRegistry(stateElement: IStateElement): void {
  registryByStateElement.delete(stateElement);
}

export const __private__ = {
  registryByStateElement,
};
