import { config, inSsr } from "../config";
import { getLoopContextByNode } from "../list/loopContextByNode";
import { activateContent, deactivateContent } from "../structural/activateContent";
import { getContentSetByNode } from "../structural/contentsByNode";
import { createContent } from "../structural/createContent";
import { IContent } from "../structural/types";
import { IBindingInfo } from "../types";
import { IApplyContext } from "./types";
import { applyTransitionName, getAutoNaming } from "./viewTransitionNaming";

function bindingInfoText(bindingInfo: IBindingInfo): string {
  return `${bindingInfo.bindingType} ${bindingInfo.statePathName} ${bindingInfo.outFilters.map(f => f.filterName).join('|')} ${bindingInfo.node.isConnected ? '(connected)' : '(disconnected)'}`;
}

export function applyChangeToIf(
  bindingInfo: IBindingInfo,
  context: IApplyContext,
  rawNewValue: unknown,
): void {
  const newValue = Boolean(rawNewValue);
  let content: IContent | undefined;
  const contents = getContentSetByNode(bindingInfo.node);
  if (contents.size === 0) {
    content = createContent(bindingInfo);
  } else {
    content = contents.values().next().value!;
  }
  const ssrMode = inSsr();
  const uuid = bindingInfo.uuid ?? '';
  const keyword = bindingInfo.bindingType; // if, elseif, else
  if (!newValue) {
    if (config.debug) {
      console.log(`unmount if content : ${bindingInfoText(bindingInfo)}`);
    }
    deactivateContent(content);
    content.unmount();
  }
  if (newValue) {
    if (config.debug) {
      console.log(`mount if content : ${bindingInfoText(bindingInfo)}`);
    }
    if (ssrMode) {
      const startComment = document.createComment(`@@wcs-${keyword}-start:${uuid}:${bindingInfo.statePathName}`);
      bindingInfo.node.parentNode!.insertBefore(startComment, bindingInfo.node.nextSibling);
      content.mountAfter(startComment);
      const endComment = document.createComment(`@@wcs-${keyword}-end:${uuid}:${bindingInfo.statePathName}`);
      const afterNode = content.lastNode ?? startComment;
      afterNode.parentNode!.insertBefore(endComment, afterNode.nextSibling);
    } else {
      content.mountAfter(bindingInfo.node);
    }
    const loopContext = getLoopContextByNode(bindingInfo.node);
    activateContent(content, loopContext, context);
    // 自動命名（docs/view-transition-design.md §6）。manual（既定）では null。
    const autoNaming = getAutoNaming();
    if (autoNaming !== null) {
      applyTransitionName(content, "branch", autoNaming);
    }
  }
}

