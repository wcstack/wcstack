import { createStateAddress } from "../address/StateAddress";
import { IPathInfo } from "../address/types";
import { isCommandToken } from "../command/CommandToken";
import { ICommandToken } from "../command/types";
import { EVENT_PROP_PREFIX, MODIFIER_PREVENT, MODIFIER_STOP, STATE_COMMAND_NAMESPACE_NAME } from "../define";
import { getLoopContextByNode } from "../list/loopContextByNode";
import { getByAddressSymbol, setLoopContextSymbol } from "../proxy/symbols";
import { getScopedIndexes } from "../list/wildcardLevel";
import { raiseError } from "../raiseError";
import { getStateElement } from "../stateElementByName";
import { findMountRecordForNode } from "../webComponent/mount";
import { IBindingInfo } from "../types";
import { captureHandlerRejection } from "./captureHandlerRejection";
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
  const modifierKey = binding.propModifiers.filter(m => m === MODIFIER_PREVENT || m === MODIFIER_STOP).sort().join(',');
  return `${binding.statePathName}::${modifierKey}`;
}

const stateEventHandlerFunction = (
  handlerName: string,
  modifiers: string[],
  statePathInfo: IPathInfo
) => (event: Event): any => {
  if (modifiers.includes(MODIFIER_PREVENT)) event.preventDefault();
  if (modifiers.includes(MODIFIER_STOP)) event.stopPropagation();

  const node = event.target as Element;
  const rootNode = node.getRootNode() as Node;
  const stateElement = getStateElement(rootNode);
  if (stateElement === null) {
    raiseError(`No state tree found on this root for event handler.`);
  }

  const loopContext = getLoopContextByNode(node);
  const isCommand = isCommandTokenPath(handlerName);
  stateElement.createStateAsync("writable", async (state) => {
    const results = state[setLoopContextSymbol](loopContext, () => {
      // マウントされたスコープ（v2）: 作者のハンドラが受ける添字は自スコープの
      // ループ分だけ（§4-4 / P2-9）。翻訳で増えたワイルドカード数を落とす。
      // 翻訳された for の台帳に無いループ文脈は外側スコープのもの（境界ホップで
      // 借りた行）なので、作者から見える添字は 0 本。
      // 記録の解決はノードから（findMountRecordForNode）— Shadow 形は rootNode
      // （shadowRoot）で直に引け、Light DOM 形はスコープ根がコンポーネント要素
      // 自身なので祖先走査が要る（rootNode だけ見ると Light DOM で外側の添字が漏れる）
      let scopedWildcardCount = loopContext !== null ? loopContext.pathInfo.wildcardCount : 0;
      if (loopContext !== null && stateElement.hasMounts === true) {
        const mountRecord = findMountRecordForNode(node, rootNode);
        if (mountRecord !== null) {
          const shift = mountRecord.indexShiftByLoopElementPath.get(loopContext.pathInfo.path);
          scopedWildcardCount = typeof shift !== "undefined" ? scopedWildcardCount - shift : 0;
        }
      }
      const indexes = loopContext !== null
        ? getScopedIndexes(loopContext.listIndex, scopedWildcardCount) : [];
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
        raiseError(`Handler "${handlerName}" is not a function on the state tree.`);
      }
      return Reflect.apply(handler, state, [event, ...indexes]);
    });
    // eventTokenHandler と同じく、この経路もハンドラの完了を待たない。async な
    // state メソッド / command subscriber の reject を unhandled にせず報告へ落とす。
    captureHandlerRejection(results, `"${handlerName}"`);
  });
}

export function attachEventHandler(binding: IBindingInfo): boolean {
  if (!binding.propName.startsWith(EVENT_PROP_PREFIX)) {
    return false;
  }
  const key = getHandlerKey(binding);
  let stateEventHandler = handlerByHandlerKey.get(key);
  if (typeof stateEventHandler === "undefined") {
    stateEventHandler = stateEventHandlerFunction(binding.statePathName, binding.propModifiers, binding.statePathInfo);
    handlerByHandlerKey.set(key, stateEventHandler);
  }

  const eventName = binding.propName.slice(2);
  (binding.node as Element).addEventListener(eventName, stateEventHandler);

  bindingRegistry.add(key, binding);
  return true;
}

export function detachEventHandler(binding: IBindingInfo): boolean {
  if (!binding.propName.startsWith(EVENT_PROP_PREFIX)) {
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

