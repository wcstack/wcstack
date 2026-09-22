import { config } from "../config";
import { VOLUME_INJECTION_PROP } from "../define";
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
    const results = parseBindTextsForElement(bindText);
    // ボリューム要素の `state.<key>: path` は注入口の宣言で、束縛ではない（B14③）。ボリュームが
    // 接ぎ木の時に自分で読む — ここで束縛にすると、無い `state` プロパティへの書き込みとして適用に失敗する
    if (element.localName === config.tagNames.state && element.hasAttribute("mount")) {
      return results.filter((result) => result.propSegments[0] !== VOLUME_INJECTION_PROP);
    }
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