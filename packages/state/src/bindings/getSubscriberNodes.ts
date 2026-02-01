import { config } from "../config";
import { parseCommentNode } from "./parseCommentNode";

/**
 * data-bind-state 属性または埋め込みノード<!--{{}}-->を持つノードをすべて取得する
 * @param root 
 * @returns 
 */

export function getSubscriberNodes(root: Document | Element | DocumentFragment): Node[] {
  const subscriberNodes: Node[] = [];
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
    subscriberNodes.push(walker.currentNode);
  }
  return subscriberNodes;
}