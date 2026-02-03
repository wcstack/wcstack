import { getBindingsByContent } from "../bindings/bindingsByContent";
import { config } from "../config";
import { getLoopContextByNode } from "../list/loopContextByNode";
import { IStateProxy } from "../proxy/types";
import { getContentByNode } from "../structural/contentByNode";
import { createContent } from "../structural/createContent";
import { IBindingInfo } from "../types";
import { applyChange } from "./applyChange";

const lastValueByNode: WeakMap<Node, boolean> = new WeakMap();
const lastConnectedByNode: WeakMap<Node, boolean> = new WeakMap();

function bindingInfoText(bindingInfo: IBindingInfo): string {
  return `${bindingInfo.bindingType} ${bindingInfo.statePathName} ${bindingInfo.filters.map(f => f.filterName).join('|')} ${bindingInfo.node.isConnected ? '(connected)' : '(disconnected)'}`;
}

export function applyChangeToIf(
  bindingInfo: IBindingInfo, 
  _newValue: any,
  state: IStateProxy,
  stateName: string
): void {
  const lastConnected = lastConnectedByNode.get(bindingInfo.node) ?? false;
  const currentConnected = bindingInfo.node.isConnected;
  const oldValue = lastValueByNode.get(bindingInfo.node) ?? false;
  const newValue = Boolean(_newValue);
  let content = getContentByNode(bindingInfo.node);
  let initialized = false;
  if (content === null) {
    const loopContext = getLoopContextByNode(bindingInfo.node);
    content = createContent(bindingInfo, loopContext);
    initialized = true;
  }
  try {
    if (oldValue === newValue && lastConnected === currentConnected) {
      if (config.debug) {
        console.log(`if content unchanged (same connecting): ${bindingInfoText(bindingInfo)}`);
      }
      return;
    }
    if (!newValue) {
      if (config.debug) {
        console.log(`unmount if content : ${bindingInfoText(bindingInfo)}`);
      }
      content.unmount();
    }
    if (newValue) {
      if (config.debug) {
        console.log(`mount if content : ${bindingInfoText(bindingInfo)}`);
      }
      content.mountAfter(bindingInfo.node);
      if (!initialized) {
        const bindings = getBindingsByContent(content);
        for(const bindingInfo of bindings) {
          applyChange(bindingInfo, state, stateName);
        }
      }
    }
  } finally {
    lastValueByNode.set(bindingInfo.node, newValue);
    lastConnectedByNode.set(bindingInfo.node, currentConnected);
  }
}

