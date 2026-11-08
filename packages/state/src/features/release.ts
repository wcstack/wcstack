/**
 * The release add-on (@wcstack/state/features/release): the binder protocol's `release(subtree)`
 * (version 2). Markup handed over to be bound (`globalThis[Symbol.for("wcstack.binder")].bind(node)`)
 * and then thrown away for good by whoever inserted it — htmx replacing search results — kept its
 * bindings: every later change wrote into the nodes it left behind, and each replacement added more
 * (docs/seam-apps.md, community-hall). `release` lets go of them: the bindings under the subtree are
 * unregistered and its `for:` / `if:` views disposed, as a row's are when its row goes. Its event
 * handlers and command subscriptions go with its nodes (held by them, or weakly).
 *
 * Only an inserter knows that content is gone for good: the router hides a route's content and shows
 * it again, so a binder cannot tell "out for now" from "out for good", and @wcstack/router never calls
 * it. Released nodes are not bound again when handed over again (walked once, they are left alone).
 */
import { hooks, type Feature } from "../hooks";
import { bind } from "../dom/binder";
import { engines } from "../dom/mount";
import { BINDER_KEY, type IWcsBindOptions } from "../protocol/binder";

/** The root node each handed-over subtree was in: one released after it left still finds its engine. */
const handedIn = new WeakMap<Node, Node>();

function handOver(subtree: Node, options?: IWcsBindOptions): void {
  if (subtree.isConnected) handedIn.set(subtree, subtree.getRootNode());
  bind(subtree, options);
}

/** Lets go of what is bound in `subtree` (see above). */
export function releaseSubtree(subtree: Node): void {
  const root = subtree.isConnected ? subtree.getRootNode() : handedIn.get(subtree);
  const engine = root === undefined ? undefined : engines.get(root);
  if (engine === undefined) return;
  const inside = (n: Node): boolean => subtree.contains(n);
  // the lists' views first: each unregisters what its rows bound
  for (const list of engine.rootLists.values()) {
    for (const view of [list.view, ...(list.extra ?? [])]) if (view !== null && inside(view.anchor)) view.dispose();
  }
  // then the bindings outside any row: an `if:` condition's takes its chain along (its branch's block)
  for (const set of engine.rootBindings.values()) {
    for (const b of set) {
      if (!inside(b.node)) continue;
      set.delete(b);
      // (an `elseif:` condition belongs to the same chain: disposed once)
      if (b.chain?.alive) b.chain.dispose();
    }
  }
}

export const release: Feature = {
  name: "release",
  hooks,
  install(): void {
    const slot = globalThis as Record<symbol, any>;
    const binder = slot[BINDER_KEY];
    // installed before <wcs-state> is defined (the full entries): this is the binder it finds there. Installed
    // after (a split page that loads the add-on later): it adds to the binder — unless another copy of the
    // package installed that one (its bindings are not this copy's to let go of)
    if (binder === undefined) slot[BINDER_KEY] = { protocol: "wcs-binder", version: 2, bind: handOver, release: releaseSubtree };
    else if (binder.bind === bind) Object.assign(binder, { version: 2, bind: handOver, release: releaseSubtree });
  },
};
export default release;
