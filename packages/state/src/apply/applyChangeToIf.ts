import { config } from "../config";
import { getLoopContextByNode } from "../list/loopContextByNode";
import { activateContent, deactivateContent } from "../structural/activateContent";
import { getContentsByNode } from "../structural/contentsByNode";
import { createContent } from "../structural/createContent";
import { IBindingInfo } from "../types";
import { IApplyContext } from "./types";

const lastConnectedByNode: WeakMap<Node, boolean> = new WeakMap();

function bindingInfoText(bindingInfo: IBindingInfo): string {
  return `${bindingInfo.bindingType} ${bindingInfo.statePathName} ${bindingInfo.outFilters.map(f => f.filterName).join('|')} ${bindingInfo.node.isConnected ? '(connected)' : '(disconnected)'}`;
}

export function applyChangeToIf(
  bindingInfo: IBindingInfo, 
  context: IApplyContext,
  rawNewValue: unknown,
): void {
  const currentConnected = bindingInfo.node.isConnected;
  const newValue = Boolean(rawNewValue);
  let contents = getContentsByNode(bindingInfo.node);
  if (contents.length === 0) {
    contents = [createContent(bindingInfo)];
  }
  const content = contents[0];
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
      activateContent(content, loopContext, context);
    }
  } finally {
    lastConnectedByNode.set(bindingInfo.node, currentConnected);
  }
}

