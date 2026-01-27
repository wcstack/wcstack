import { config } from "../config";
import { raiseError } from "../raiseError";
import { IBindingInfo } from "../types";
import { parseBindTextsForElement } from "../bindTextParser/parseBindTextsForElement";
import { getCommentNodeBindText } from "./isCommentNode";
import { parseBindTextForEmbeddedNode } from "../bindTextParser/parseBindTextForEmbeddedNode";
import { getParseBindTextResultByUUID } from "../bindTextParser/parseBindTextResultByUUID";

export function getBindingInfos(node: Node): IBindingInfo[] {
  const bindingInfos: IBindingInfo[] = [];
  if (node.nodeType === Node.ELEMENT_NODE) {
    const element = node as Element;
    const bindText = element.getAttribute(config.bindAttributeName) || '';
    const bindingInfosFromElement = parseBindTextsForElement(bindText);
    for (const bindingInfo of bindingInfosFromElement) {
      bindingInfos.push({
        ...bindingInfo,
        node: node,
        placeHolderNode: element,
        uuid: null,
      });
    }
  } else if (node.nodeType === Node.COMMENT_NODE) {
    const bindTextOrUUID = getCommentNodeBindText(node);
    if (bindTextOrUUID === null) {
      raiseError(`Comment node binding text not found.`);
    }
    let parseBindingTextResult = getParseBindTextResultByUUID(bindTextOrUUID);
    let uuid: string | null = null;
    if (parseBindingTextResult === null) {
      // It is not a structural fragment UUID, so treat it as bindText
      parseBindingTextResult = parseBindTextForEmbeddedNode(bindTextOrUUID);
      uuid = null;
    } else {
      uuid = bindTextOrUUID;
    }
    let placeHolderNode: Node = node;
    if (parseBindingTextResult.bindingType === "text") {
      placeHolderNode = document.createTextNode('');
    }
    bindingInfos.push({
      ...parseBindingTextResult,
      node: node,
      placeHolderNode: placeHolderNode,
      uuid: uuid,
    });
  }
  return bindingInfos;
}