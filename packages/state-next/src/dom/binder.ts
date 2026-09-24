import { BINDER_KEY, flushPendingBinds, type IWcsBinder } from "../protocol/binder";
import { engines, mountSubtree } from "./mount";

/**
 * The binder protocol's provider (docs/binder-protocol-design.md): a package that inserts
 * DOM after the mount — the router's route content, `<wcs-head>`'s clones in <head> —
 * hands the subtree over, and it is bound to the engine of its root, synchronously.
 * Only what is handed over is bound (no scan of every insertion), and binding twice is a
 * no-op, so the router may hand the same nodes over on every insertion.
 */

/** Subtrees handed over before their root's engine finished its first mount. */
const early: Element[] = [];

function bind(subtree: Node): void {
  if (subtree.nodeType !== 1) return;
  const engine = engines.get(subtree.getRootNode());
  if (engine === undefined) early.push(subtree as Element);
  else mountSubtree(engine, subtree as Element);
}

/**
 * After an engine's first mount: binds what was handed over too early — to this binder
 * before the mount, or (queued by the protocol) before any binder existed.
 */
export function drainBinds(): void {
  for (const subtree of early.splice(0)) bind(subtree);
  flushPendingBinds();
}

/** Installs the binder on the protocol's global slot, unless another copy already has it. */
export function installBinder(): void {
  const slot = globalThis as Record<symbol, unknown>;
  if (slot[BINDER_KEY] === undefined) slot[BINDER_KEY] = { protocol: "wcs-binder", version: 1, bind } satisfies IWcsBinder;
}
