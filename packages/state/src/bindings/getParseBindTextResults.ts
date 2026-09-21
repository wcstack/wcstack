import { config } from "../config";
import { raiseError } from "../raiseError";
import { parseBindTextsForElement } from "../bindTextParser/parseBindTextsForElement";
import { parseCommentNode } from "./parseCommentNode";
import { parseBindTextForEmbeddedNode } from "../bindTextParser/parseBindTextForEmbeddedNode";
import { ParseBindTextResult } from "../bindTextParser/types";
import { getFragmentInfoByUUID } from "../structural/fragmentInfoByUUID";

export function getParseBindTextResults(node: Node): ParseBindTextResult[] {
  if (node.nodeType === Node.ELEMENT_NODE) {
    const element = node as Element;
    const bindText = element.getAttribute(config.bindAttributeName) || '';
    return parseBindTextsForElement(bindText);
  } else if (node.nodeType === Node.COMMENT_NODE) {
    const bindTextOrUUID = parseCommentNode(node);
    if (bindTextOrUUID === null) {
      raiseError(`Comment node binding text not found.`);
    }
    const fragmentInfo = getFragmentInfoByUUID(bindTextOrUUID);
    let parseBindingTextResult = fragmentInfo?.parseBindTextResult ?? null;
    let uuid: string | null = null;
    if (parseBindingTextResult === null) {
      // It is not a structural fragment UUID, so treat it as bindText
      parseBindingTextResult = parseBindTextForEmbeddedNode(bindTextOrUUID);
      uuid = null;
    } else {
      uuid = bindTextOrUUID;
    }
    return [{
      ...parseBindingTextResult,
      uuid: uuid,
    }]
  }
  return [];
}