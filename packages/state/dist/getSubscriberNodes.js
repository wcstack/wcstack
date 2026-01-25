import { config } from "./config";
import { isEmbeddedNode } from "./isEmbeddedNode";
const NOTARGET_TAGS = new Set([config.tagNames.loop, config.tagNames.cond]);
export function getSubscriberNodes(root) {
    const subscriberNodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL, 
    //    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT |, 
    {
        acceptNode(node) {
            console.log('node:', node);
            if (node.nodeType === Node.ELEMENT_NODE) {
                const element = node;
                const hasBinding = element.hasAttribute(config.bindAttributeName);
                return hasBinding
                    ? NodeFilter.FILTER_ACCEPT
                    : NodeFilter.FILTER_SKIP;
            }
            else {
                // Comment node
                return isEmbeddedNode(node)
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