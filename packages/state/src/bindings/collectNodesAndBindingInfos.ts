import { expandSpread, hasUnresolvedSpread } from "../bindTextParser/expandSpread";
import { ParseBindTextResult } from "../bindTextParser/types";
import { getCustomElement } from "../getCustomElement";
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

export interface IDeferredSpreadEntry {
  readonly node: Node;
  readonly tagName: string;
  readonly parseResults: ParseBindTextResult[];
}

function processParseResultsForNode(
  node: Node,
  parseResults: ParseBindTextResult[],
  options: { allowDeferred: boolean },
): { bindings: IBindingInfo[], deferred: IDeferredSpreadEntry | null } {
  const expanded = expandSpread(node, parseResults, { allowDeferred: options.allowDeferred });
  if (hasUnresolvedSpread(expanded)) {
    const tagName = node.nodeType === Node.ELEMENT_NODE
      ? getCustomElement(node as Element)
      : null;
    if (tagName === null) {
      raiseError(`Spread binding deferred but element is not a custom element.`);
    }
    return { bindings: [], deferred: { node, tagName, parseResults } };
  }
  registeredNodeSet.add(node);
  const bindings = getBindingInfos(node, expanded);
  setBindingsByNode(node, bindings);
  resolveInitializedBinding(node);
  return { bindings, deferred: null };
}

export function collectNodesAndBindingInfos(
  root: Document | Element | DocumentFragment
): [ Node[], IBindingInfo[], IDeferredSpreadEntry[] ] {
  const subscriberNodes = getSubscriberNodes(root);
  const allBindings: IBindingInfo[] = [];
  const deferredSpreads: IDeferredSpreadEntry[] = [];
  for(const node of subscriberNodes) {
    if (registeredNodeSet.has(node)) continue;
    const parseResults = getParseBindTextResults(node);
    const result = processParseResultsForNode(node, parseResults, { allowDeferred: true });
    if (result.deferred !== null) {
      deferredSpreads.push(result.deferred);
      continue;
    }
    allBindings.push(...result.bindings);
  }
  return [subscriberNodes, allBindings, deferredSpreads];
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
    if (registeredNodeSet.has(node)) continue;
    const result = processParseResultsForNode(node, nodeInfo.parseBindTextResults, { allowDeferred: false });
    // deferred is impossible when allowDeferred=false (expandSpread raises instead)
    allBindings.push(...result.bindings);
    nodes.push(node);
  }
  return [nodes, allBindings];
}

export function unregisterNode(node: Node): void {
  registeredNodeSet.delete(node);
}

/**
 * RowPlan 経路（createContent のプラン実体化）用。パース・spread 展開を経ずに
 * binding を組み立てた subscriber ノードを二重処理防止台帳へ載せる
 * （後続の collectNodesAndBindingInfos による再スキャンから保護）。
 */
export function markNodeRegistered(node: Node): void {
  registeredNodeSet.add(node);
}

/**
 * Re-process a deferred spread entry once the custom element class is
 * registered. Expands the captured parseResults, installs bindings, and
 * returns them so the caller can attach handlers and apply state values.
 */
export function processDeferredNode(entry: IDeferredSpreadEntry): IBindingInfo[] {
  const { node, parseResults } = entry;
  unregisterNode(node);
  const result = processParseResultsForNode(node, parseResults, { allowDeferred: false });
  return result.bindings;
}
