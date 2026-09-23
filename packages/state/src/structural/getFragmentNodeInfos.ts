import { getParseBindTextResults } from "../bindings/getParseBindTextResults";
import { getSubscriberNodes } from "../bindings/getSubscriberNodes";
import { getNodePath } from "./getNodePath";
import { IFragmentNodeInfo } from "./types";

/**
 * 正規化で捨てたコメントの原文（テキスト束縛だけ）。空 Text からは元の
 * `<!--@@: path|filter-->` を復元できないが、SSR のスナップショットはこの fragment を
 * **マークアップとして**直列化するので、原文が無いと `for` / `if` テンプレートの中の
 * `{{ }}` がスナップショットから丸ごと消える（ハイドレーション後に恒久的に空になる）。
 * 直列化の直前に原文へ戻すための控え。`Ssr.buildContent` だけが読む。
 */
const textCommentDataByNode = new WeakMap<Node, string>();

/**
 * 正規化前のコメント原文（テキスト束縛の空 Text に対して）。無ければ null。
 * `null`（nodePath の解決に失敗）も受ける — `WeakMap.get` は弱く保持できないキーに
 * `undefined` を返すので、呼び手が解決失敗を分岐で捌かずに済む。
 */
export function getNormalizedTextCommentData(node: Node | null): string | null {
  return textCommentDataByNode.get(node as Node) ?? null;
}

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
      // 原文を控えてから捨てる（SSR の直列化が戻す — textCommentDataByNode を参照）
      textCommentDataByNode.set(textNode, (subscriberNode as Comment).data);
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