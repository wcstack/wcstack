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
    if (element.localName === config.tagNames.state) {
      if (element.hasAttribute("mount")) {
        return results.filter((result) => result.propSegments[0] !== VOLUME_INJECTION_PROP);
      }
      // `mount=` の無い `<wcs-state>` の左辺 `state…` は、誰も読まないまま束縛として残り、
      // 存在しない `state` プロパティへの書き込みとして適用の段で落ちていた。書いた場所を名指しする。
      // 1 段（`state: x`）と 2 段以上（`state.<key>: x`）で助言が違う — 前者に `mount=` を足しても
      // 今度は `inject one key at a time` になるので、助言が回らないように分ける
      const injection = results.find((result) => result.propSegments[0] === VOLUME_INJECTION_PROP);
      if (typeof injection !== "undefined") {
        const where =
          `on a volume element — a <${config.tagNames.state}> with a "mount" attribute`;
        raiseError(injection.propSegments.length === 1
          ? `[wcs/mount-path-invalid] "${injection.propName}" is the reserved namespace for volume injection, ` +
            `so it cannot be bound as an element property. Write one key at a time ` +
            `("${VOLUME_INJECTION_PROP}.<key>: <path>") ${where}.`
          : `[wcs/mount-path-invalid] "${injection.propName}: ${injection.statePathName}" is a volume injection ` +
            `declaration, and it can only be written ${where}. Add mount="<path>", or bind an element ` +
            `property instead.`);
      }
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