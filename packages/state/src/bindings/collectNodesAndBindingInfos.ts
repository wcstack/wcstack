import { raiseError } from "../raiseError";
import { resolveNodePath } from "../structural/resolveNodePath";
import { IFragmentNodeInfo } from "../structural/types";
import { IBindingInfo } from "../types";
import { getBindingInfos } from "./getBindingInfos";
import { setBindingsByNode } from "./getBindingsByNode";
import { getParseBindTextResults } from "./getParseBindTextResults";
import { getSubscriberNodes } from "./getSubscriberNodes";
import { resolveInitializedBinding } from "./initializeBindingPromiseByNode";

const registeredNodeSet = new WeakSet<Node>();

export function collectNodesAndBindingInfos(
  root: Document | Element | DocumentFragment
): [ Node[], IBindingInfo[] ] {
  const subscriberNodes = getSubscriberNodes(root);
  const allBindings: IBindingInfo[] = [];
  for(const node of subscriberNodes) {
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

export function collectNodesAndBindingInfosByFragment(
  root: DocumentFragment,
  nodeInfos: IFragmentNodeInfo[],
): [ Node[], IBindingInfo[] ] {
  const nodes: Node[] = [];
  const allBindings: IBindingInfo[] = [];
  for(const nodeInfo of nodeInfos) {
    const node = resolveNodePath(root, nodeInfo.nodePath);
    if (node === null) {
      raiseError(`Node not found by path [${nodeInfo.nodePath.join(', ')}] in fragment.`);
    }
    if (!registeredNodeSet.has(node)) {
      registeredNodeSet.add(node);
      const bindings = getBindingInfos(node, nodeInfo.parseBindTextResults);
      setBindingsByNode(node, bindings);
      resolveInitializedBinding(node);
      allBindings.push(...bindings);
      nodes.push(node);
    }
  }
  return [nodes, allBindings];
}

export function unregisterNode(node: Node): void {
  registeredNodeSet.delete(node);
}