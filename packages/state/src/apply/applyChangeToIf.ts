import { config } from "../config";
import { getLoopContextByNode } from "../list/loopContextByNode";
import { IStateProxy } from "../proxy/types";
import { activateContent, deactivateContent } from "../structural/activateContent";
import { getContentByNode } from "../structural/contentByNode";
import { createContent } from "../structural/createContent";
import { IBindingInfo } from "../types";

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
  const currentConnected = bindingInfo.node.isConnected;
  const newValue = Boolean(_newValue);
  let content = getContentByNode(bindingInfo.node);
  if (content === null) {
    content = createContent(bindingInfo);
  }
  try {
    if (!newValue) {
      if (config.debug) {
        console.log(`unmount if content : ${bindingInfoText(bindingInfo)}`);
      }
      content.unmount();
      deactivateContent(content);
    }
    if (newValue) {
      if (config.debug) {
        console.log(`mount if content : ${bindingInfoText(bindingInfo)}`);
      }
      content.mountAfter(bindingInfo.node);
      const loopContext = getLoopContextByNode(bindingInfo.node);
      activateContent(content, loopContext, state, stateName);
    }
  } finally {
    lastConnectedByNode.set(bindingInfo.node, currentConnected);
  }
}

