import { raiseError } from "../raiseError";
import { resolveNodePath } from "../structural/resolveNodePath";
import { getBindingInfos } from "./getBindingInfos";
import { setBindingsByNode } from "./getBindingsByNode";
import { getParseBindTextResults } from "./getParseBindTextResults";
import { getSubscriberNodes } from "./getSubscriberNodes";
import { resolveInitializedBinding } from "./initializeBindingPromiseByNode";
const registeredNodeSet = new WeakSet();
export function collectNodesAndBindingInfos(root) {
    const subscriberNodes = getSubscriberNodes(root);
    const allBindings = [];
    for (const node of subscriberNodes) {
        if (!registeredNodeSet.has(node)) {
            registeredNodeSet.add(node);
            const parseBindingTextResults = getParseBindTextResults(node);
            const bindings = getBindingInfos(node, parseBindingTextResults);
            setBindingsByNode(node, bindings);
            resolveInitializedBinding(node);
            allBindings.push(...bindings);
        }
    }
    return [subscriberNodes, allBindings];
}
export function collectNodesAndBindingInfosByFragment(root, nodeInfos) {
    const nodes = [];
    const allBindings = [];
    for (const nodeInfo of nodeInfos) {
        const node = resolveNodePath(root, nodeInfo.nodePath);
        if (node === null) {
            raiseError(`Node not found by path [${nodeInfo.nodePath.join(', ')}] in fragment.`);
        }
        if (!registeredNodeSet.has(node)) {
            registeredNodeSet.add(node);
            const bindingInfos = getBindingInfos(node, nodeInfo.parseBindTextResults);
            allBindings.push(...bindingInfos);
            nodes.push(node);
        }
    }
    return [nodes, allBindings];
}
export function unregisterNode(node) {
    registeredNodeSet.delete(node);
}
//# sourceMappingURL=collectNodesAndBindingInfos.js.map