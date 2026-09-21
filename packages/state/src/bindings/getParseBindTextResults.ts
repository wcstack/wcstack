import { config } from "../config";
import { raiseError } from "../raiseError";
import { parseBindTextsForElement } from "../bindTextParser/parseBindTextsForElement";
import { parseCommentNode } from "./parseCommentNode";
import { parseBindTextForEmbeddedNode } from "../bindTextParser/parseBindTextForEmbeddedNode";
import { ParseBindTextResult } from "../bindTextParser/types";
import { getFragmentInfoByUUID } from "../structural/fragmentInfoByUUID";
import { checkBindTextForV3, checkEmbeddedBindTextForV3 } from "../v3Migration";

export function getParseBindTextResults(node: Node): ParseBindTextResult[] {
  if (node.nodeType === Node.ELEMENT_NODE) {
    const element = node as Element;
    const bindText = element.getAttribute(config.bindAttributeName) || '';
    const results = parseBindTextsForElement(bindText);
    // 3.0 で拒否される書き方の予告（要件 D2 — 2.x の挙動は変えない）
    checkBindTextForV3(bindText, results);
    return results;
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
      checkEmbeddedBindTextForV3(bindTextOrUUID, parseBindingTextResult);
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