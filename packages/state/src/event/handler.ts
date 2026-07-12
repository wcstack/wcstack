import { createStateAddress } from "../address/StateAddress";
import { IPathInfo } from "../address/types";
import { isCommandToken } from "../command/CommandToken";
import { ICommandToken } from "../command/types";
import { STATE_COMMAND_NAMESPACE_NAME } from "../define";
import { getLoopContextByNode } from "../list/loopContextByNode";
import { getByAddressSymbol, setLoopContextSymbol } from "../proxy/symbols";
import { raiseError } from "../raiseError";
import { getStateElementByName } from "../stateElementByName";
import { IBindingInfo } from "../types";
import { createHandlerBindingRegistry } from "./handlerBindingRegistry";

// onclick: $command.<name> のように、DOM イベントから command token を直接 emit する形式かを判定する。
// 右辺が $command 名前空間配下のパス（$command.<token>）のときに true。
function isCommandTokenPath(statePathName: string): boolean {
  return statePathName.startsWith(STATE_COMMAND_NAMESPACE_NAME + ".");
}

const handlerByHandlerKey: Map<string, (event: Event) => any> = new Map();
// binding を強参照しない台帳（handlerBindingRegistry.ts のリーク解説を参照）
const bindingRegistry = createHandlerBindingRegistry();

function getHandlerKey(binding: IBindingInfo): string {
  const modifierKey = binding.propModifiers.filter(m => m === 'prevent' || m === 'stop').sort().join(',');
  return `${binding.stateName}::${binding.statePathName}::${modifierKey}`;
}

const stateEventHandlerFunction = (
  stateName: string,
  handlerName: string,
  modifiers: string[],
  statePathInfo: IPathInfo
) => (event: Event): any => {
  if (modifiers.includes('prevent')) event.preventDefault();
  if (modifiers.includes('stop')) event.stopPropagation();

  const node = event.target as Element;
  const rootNode = node.getRootNode() as Node;
  const stateElement = getStateElementByName(rootNode, stateName);
  if (stateElement === null) {
    raiseError(`State element with name "${stateName}" not found for event handler.`);
  }

  const loopContext = getLoopContextByNode(node);
  const isCommand = isCommandTokenPath(handlerName);
  stateElement.createStateAsync("writable", async (state) => {
    state[setLoopContextSymbol](loopContext, () => {
      const indexes = loopContext?.listIndex.indexes ?? [];
      if (isCommand) {
        // command token を解決して emit。引数はハンドラ呼び出しと同じく (event, ...listIndexes) を透過する。
        const token = state[getByAddressSymbol](createStateAddress(statePathInfo, null));
        if (!isCommandToken(token)) {
          raiseError(`Event binding "${handlerName}" did not resolve to a CommandToken. Declare the name in $commandTokens and reference it as $command.<name>.`);
        }
        return (token as ICommandToken).emit(event, ...indexes);
      }
      const handler = state[handlerName];
      if (typeof handler !== "function") {
        raiseError(`Handler "${handlerName}" is not a function on state "${stateName}".`);
      }
      return Reflect.apply(handler, state, [event, ...indexes]);
    });
  });
}

export function attachEventHandler(binding: IBindingInfo): boolean {
  if (!binding.propName.startsWith("on")) {
    return false;
  }
  const key = getHandlerKey(binding);
  let stateEventHandler = handlerByHandlerKey.get(key);
  if (typeof stateEventHandler === "undefined") {
    stateEventHandler = stateEventHandlerFunction(binding.stateName, binding.statePathName, binding.propModifiers, binding.statePathInfo);
    handlerByHandlerKey.set(key, stateEventHandler);
  }

  const eventName = binding.propName.slice(2);
  (binding.node as Element).addEventListener(eventName, stateEventHandler);

  bindingRegistry.add(key, binding);
  return true;
}

export function detachEventHandler(binding: IBindingInfo): boolean {
  if (!binding.propName.startsWith("on")) {
    return false;
  }
  const key = getHandlerKey(binding);
  const stateEventHandler = handlerByHandlerKey.get(key);
  if (typeof stateEventHandler === "undefined") {
    return false;
  }
  const eventName = binding.propName.slice(2);
  (binding.node as Element).removeEventListener(eventName, stateEventHandler);

  if (bindingRegistry.countOf(key) === 0) {
    return false;
  }
  if (bindingRegistry.remove(key, binding)) {
    handlerByHandlerKey.delete(key);
  }
  return true;
}

export const __private__ = {
  handlerByHandlerKey,
  bindingRegistry,
  getHandlerKey,
};

