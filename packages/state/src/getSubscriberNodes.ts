import { config } from "./config";
import { isEmbeddedNode } from "./isEmbeddedNode";
import { isLoopComment } from "./isLoopComment";

const NOTARGET_TAGS = new Set([config.tagNames.loop, config.tagNames.cond]);

export function getSubscriberNodes(root: Document | Element | DocumentFragment): Node[] {
  const subscriberNodes: Node[] = [];
  const walker = document.createTreeWalker(
    root, 
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT, 
    {
      acceptNode(node: Node) {
        console.log('node:', node);
        if (node.nodeType === Node.ELEMENT_NODE) {
          const element = node as Element;
          const hasBinding = element.hasAttribute(config.bindAttributeName);
          return hasBinding
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_SKIP;
        } else {
          // Comment node
          return isEmbeddedNode(node) || isLoopComment(node)
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