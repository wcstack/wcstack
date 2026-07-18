import { ILoopContext } from "../list/types";
import {
  collectNodesAndBindingInfos,
  collectNodesAndBindingInfosByFragment,
  IDeferredSpreadEntry,
  processDeferredNode,
} from "./collectNodesAndBindingInfos";
import { IFragmentNodeInfo } from "../structural/types";
import { setLoopContextByNode } from "../list/loopContextByNode";
import { applyChangeFromBindings } from "../apply/applyChangeFromBindings";
import { IInitialBindingInfo } from "./types";
import { BindingSession, getOrCreateBindingSession } from "./BindingSession";

function scheduleDeferredSpreads(
  deferredSpreads: IDeferredSpreadEntry[],
  parentLoopContext: ILoopContext | null,
  session: BindingSession,
): void {
  for (const entry of deferredSpreads) {
    session.deferUntilDefined(entry.node, entry.tagName, () => {
      const bindings = processDeferredNode(entry);
      if (bindings.length === 0) return;
      setLoopContextByNode(entry.node, parentLoopContext);
      const initialized = session.initialize(bindings);
      applyChangeFromBindings(initialized);
    }, (error: unknown) => {
      console.error(`[@wcstack/state] deferred spread failed for <${entry.tagName}>.`, error);
    });
  }
}

export function initializeBindings(
  root: Document | DocumentFragment | Element,
  parentLoopContext: ILoopContext | null,
): void {
  const [subscriberNodes, allBindings, deferredSpreads] = collectNodesAndBindingInfos(root);
  const session = getOrCreateBindingSession(root);
  for (const node of subscriberNodes) {
    setLoopContextByNode(node, parentLoopContext);
  }
  const initialized = session.initialize(allBindings);
  applyChangeFromBindings(initialized);
  scheduleDeferredSpreads(deferredSpreads, parentLoopContext, session);
}

export function initializeBindingsByFragment(
  root: DocumentFragment,
  nodeInfos: IFragmentNodeInfo[],
): IInitialBindingInfo {
  const [subscriberNodes, allBindings] = collectNodesAndBindingInfosByFragment(root, nodeInfos);
  const session = new BindingSession();
  // knownRoot=null: detached fragment 上の初期化。observableRootFor が必ず null を
  // 返す（observe は no-op）ため、binding ごとの getRootNode を省略する
  const initialized = session.initialize(allBindings, {
    registerAddress: false,
    applyOnReconnect: false,
  }, null);
  return {
    nodes: subscriberNodes,
    bindingInfos: initialized,
    bindingSession: session,
  };
}
