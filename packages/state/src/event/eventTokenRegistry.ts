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
    token = new EventToken(name, stateElement.name);
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
