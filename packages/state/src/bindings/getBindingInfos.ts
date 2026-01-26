import { config } from "../config";
import { raiseError } from "../raiseError";
import { IBindingInfo } from "../types";
import { parseBindTextsForElement } from "../bindTextParser/parseBindTextsForElement";
import { getUUID } from "../getUUID";
import { getEmbeddedNodeBindText } from "./isEmbeddedNode";
import { parseBindTextForEmbeddedNode } from "../bindTextParser/parseBindTextForEmbeddedNode";
import { STRUCTURAL_BINDING_TYPE_SET } from "../structural/define";

function createPlaceHolderCommentNode(propName: string): Comment {
  const uuid = getUUID();
  return document.createComment(`@@${propName}:${uuid}`);
}

export function getBindingInfos(node: Node): IBindingInfo[] {
  const bindingInfos: IBindingInfo[] = [];
  if (node.nodeType === Node.ELEMENT_NODE) {
    const element = node as Element;
    const bindText = element.getAttribute(config.bindAttributeName) || '';
    const bindingInfosFromElement = parseBindTextsForElement(bindText);
    for (const bindingInfo of bindingInfosFromElement) {
      let targetNode: Node = element;
      if (STRUCTURAL_BINDING_TYPE_SET.has(bindingInfo.bindingType)) {
        if (element.tagName.toLowerCase() !== 'template') {
          raiseError(`[@wcstack/state] The element with special binding property "${bindingInfo.propName}" must be a <template> element.`);
        }
        targetNode = createPlaceHolderCommentNode(bindingInfo.bindingType);
      } else {
        targetNode = element;
      }
      bindingInfos.push({
        ...bindingInfo,
        rawNode: node,
        node: targetNode,
      });
    }
  } else if (node.nodeType === Node.COMMENT_NODE) {
    const bindText = getEmbeddedNodeBindText(node);
    if (bindText === null) {
      raiseError(`Comment node binding text not found.`);
    }
    const bindingInfo = parseBindTextForEmbeddedNode(bindText);
    const targetNode = createPlaceHolderCommentNode(bindingInfo.bindingType);
    bindingInfos.push({
      ...bindingInfo,
      rawNode: node,
      node: targetNode,
    });
  }
  return bindingInfos;
}