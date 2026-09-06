import { IStateElement } from "../components/types";
import { CommandToken } from "./CommandToken";
import { ICommandToken } from "./types";

const registryByStateElement: WeakMap<IStateElement, Map<string, ICommandToken>> = new WeakMap();

export function getOrCreateCommandToken(stateElement: IStateElement, name: string): ICommandToken {
  let registry = registryByStateElement.get(stateElement);
  if (typeof registry === "undefined") {
    registry = new Map<string, ICommandToken>();
    registryByStateElement.set(stateElement, registry);
  }
  let token = registry.get(name);
  if (typeof token === "undefined") {
    // stateElement を渡すのは devtools のツリー識別（protocol v2 追補）のため
    token = new CommandToken(name, stateElement);
    registry.set(name, token);
  }
  return token;
}

export function clearCommandTokenRegistry(stateElement: IStateElement): void {
  registryByStateElement.delete(stateElement);
}

export const __private__ = {
  registryByStateElement,
};
