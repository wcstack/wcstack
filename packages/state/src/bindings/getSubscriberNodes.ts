import { config } from "../config";
import { findNestedLightDomComponents, isInsideAnyComponent } from "./lightDomComponentScope";
import { parseCommentNode } from "./parseCommentNode";

/**
 * data-wcs 属性または埋め込みノード<!--{{}}-->を持つノードをすべて取得する
 *
 * Light DOM の mapped コンポーネントの**内側**は除外する（§1.13）。そのサブツリーの
 * `@name` 参照は、コンポーネント側の state が名前登録を済ませてからでないと解決できず、
 * ホストと同じパスで拾うと登録前に評価されてしまう。除外したぶんは、その state が
 * 初期化を終えた時点で自分のスコープとして `initializeBindings(componentElement)` を
 * 呼び直す（Shadow DOM 形で rootNode ごとにパスが分かれるのと同じ形にする）。
 *
 * コンポーネント要素**自身**は除外しない。ホスト側の `data-wcs`（`state.msg: user.name`）
 * はホストのスコープに属し、それが張られることで子側の待ちが解ける。
 *
 * @param root
 * @returns
 */

export function getSubscriberNodes(root: Document | Element | DocumentFragment): Node[] {
  const subscriberNodes: Node[] = [];
  const nestedComponents = findNestedLightDomComponents(root);
  const walker = document.createTreeWalker(
    root, 
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT, 
    {
      acceptNode(node: Node) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const element = node as Element;
          const hasBinding = element.hasAttribute(config.bindAttributeName);
          return hasBinding
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_SKIP;
        } else {
          // Comment node
          return parseCommentNode(node) !== null
            ? NodeFilter.FILTER_ACCEPT 
            : NodeFilter.FILTER_SKIP;
        }
      }
    }
  );
  
  while (walker.nextNode()) {
    const node = walker.currentNode;
    // TreeWalker の acceptNode は「自分は拾うが子孫は辿らない」を表現できないため、
    // コンポーネント要素自身を拾ったうえで、その子孫をここで落とす。
    // nestedComponents が空（＝圧倒的多数）のときは contains 走査ごと発生しない。
    if (nestedComponents.length > 0 && isInsideAnyComponent(node, nestedComponents)) {
      continue;
    }
    subscriberNodes.push(node);
  }
  return subscriberNodes;
}