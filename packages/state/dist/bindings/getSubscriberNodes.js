import { config } from "../config";
import { isCommentNode } from "./isCommentNode";
/**
 * data-bind-state 属性または埋め込みノード<!--{{}}-->を持つノードをすべて取得する
 * @param root
 * @returns
 */
export function getSubscriberNodes(root) {
    const subscriberNodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT, {
        acceptNode(node) {
            if (node.nodeType === Node.ELEMENT_NODE) {
                const element = node;
                const hasBinding = element.hasAttribute(config.bindAttributeName);
                return hasBinding
                    ? NodeFilter.FILTER_ACCEPT
                    : NodeFilter.FILTER_SKIP;
            }
            else {
                // Comment node
                return isCommentNode(node)
                    ? NodeFilter.FILTER_ACCEPT
                    : NodeFilter.FILTER_SKIP;
            }
        }
    });
    while (walker.nextNode()) {
        subscriberNodes.push(walker.currentNode);
    }
    return subscriberNodes;
}
//# sourceMappingURL=getSubscriberNodes.js.map