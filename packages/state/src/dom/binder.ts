import { BINDER_KEY, flushPendingBinds, type IWcsBinder, type IWcsBindOptions } from "../protocol/binder";
import { engines, mountSubtree } from "./mount";

/**
 * The binder protocol's provider (docs/binder-protocol-design.md): a package that inserts
 * DOM after the mount — the router's route content, `<wcs-head>`'s clones in <head> —
 * hands the subtree over, and it is bound to the engine of its root, synchronously.
 * Only what is handed over is bound (no scan of every insertion), and binding twice is a
 * no-op, so the router may hand the same nodes over on every insertion.
 */

/**
 * Subtrees handed over before their root's engine finished its first mount, or while it was out of the
 * page, with what the caller declared (a range: a route's top-level template is rendered then).
 */
const early = new Map<Element, IWcsBindOptions | undefined>();

export function bind(subtree: Node, options?: IWcsBindOptions): void {
  // not in a document (it left, or was replaced, as a chain's `else:` template by its anchor): nothing to bind
  if (subtree.nodeType !== 1 || !subtree.isConnected) return;
  // (a root taken out of the page lets go of its root node: it binds what waited here when it is back.
  // A component's, whose <wcs-state> alone left, is still registered: not one to bind to either)
  const engine = engines.get(subtree.getRootNode());
  // (once each: the router hands the same nodes over on every insertion. One handed over early is
  // walked by the first mount where it is: the declaration is not needed then)
  if (engine === undefined || (engine.element as Node | null)?.isConnected === false) early.set(subtree as Element, options);
  else mountSubtree(engine, subtree as Element, options?.range);
}

/**
 * After an engine's first mount, and when a root is back in the page: binds what was handed over
 * too early — to this binder before the mount or while the root was out, or (queued by the
 * protocol) before any binder existed.
 */
export function drainBinds(): void {
  // (one that left the document meanwhile is dropped: handed over again if it comes back)
  const waiting = [...early];
  early.clear();
  for (const [subtree, options] of waiting) bind(subtree, options);
  flushPendingBinds();
}

/** Installs the binder on the protocol's global slot, unless another copy already has it. */
export function installBinder(): void {
  const slot = globalThis as Record<symbol, unknown>;
  if (slot[BINDER_KEY] === undefined) slot[BINDER_KEY] = { protocol: "wcs-binder", version: 1, bind } satisfies IWcsBinder;
}
