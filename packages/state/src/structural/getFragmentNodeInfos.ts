import { getParseBindTextResults } from "../bindings/getParseBindTextResults";
import { getSubscriberNodes } from "../bindings/getSubscriberNodes";
import { getNodePath } from "./getNodePath";
import { IFragmentNodeInfo } from "./types";

export function getFragmentNodeInfos(fragment: DocumentFragment): IFragmentNodeInfo[] {
  const fragmnentNodeInfos: IFragmentNodeInfo[] = [];
  const subscriberNodes = getSubscriberNodes(fragment);
  for(const subscriberNode of subscriberNodes) {
    const parseBindingTextResults = getParseBindTextResults(subscriberNode);
    let node = subscriberNode;
    // テンプレート登録時の事前正規化: text 専用の wcs-text コメントは、この時点で
    // 空 Text に置き換えておく。行 clone は最初から Text を持ち、getBindingInfos が
    // その Text を replaceNode に使うため、行ごとの createTextNode と start() 時の
    // replaceChild（コメント→Text 差し替え）が丸ごと不要になる。
    // 置換は同じ位置なので nodePath は不変。wcs-for/if 等の構造コメントは
    // アンカーとしてコメントのまま維持する（bindingType で判別）。
    // 非フラグメント経路（実 DOM 上のコメント）は従来どおり実行時に差し替える。
    if (
      subscriberNode.nodeType === Node.COMMENT_NODE
      && parseBindingTextResults.length === 1
      && parseBindingTextResults[0].bindingType === "text"
      && subscriberNode.parentNode !== null
    ) {
      const textNode = document.createTextNode("");
      subscriberNode.parentNode.replaceChild(textNode, subscriberNode);
      node = textNode;
    }
    fragmnentNodeInfos.push({
      nodePath: getNodePath(node),
      parseBindTextResults: parseBindingTextResults,
    });
  }
  return fragmnentNodeInfos;
}