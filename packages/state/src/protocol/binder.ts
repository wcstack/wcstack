// ===========================================================================
// AUTO-GENERATED FILE - DO NOT EDIT.
// Generated from /protocol/binder.ts by scripts/sync-protocol-types.mjs.
// Run `node scripts/sync-protocol-types.mjs` after editing the source.
// ===========================================================================

// binder protocol — how a package that inserts DOM hands those nodes to whoever
// owns data bindings on the page.
//
// The dual of transition-runner: that one hands a *mutation* to whoever animates
// it, this one hands *new nodes* to whoever binds them.
//
// A `data-wcs` binding exists only for nodes @wcstack/state walked when it built
// its bindings. Nodes that arrive later — the content of a route that was not
// active at that moment, a <wcs-head> child reflected into <head> — were never
// walked, so their bindings silently do nothing, however often they are inserted.
// @wcstack/router must not depend on @wcstack/state (zero runtime dependencies,
// independently publishable), so state installs a binder on a well-known global
// symbol and inserters look it up lazily.
//
// No binder installed means nothing happens — byte-for-byte the behavior these
// packages had before the protocol existed.
//
// docs/binder-protocol-design.md is the normative description.
//
// SINGLE SOURCE OF TRUTH: edit only this file (/protocol/binder.ts), then run
// `node scripts/sync-protocol-types.mjs` to regenerate the per-package copies
// (packages/<pkg>/src/protocol/binder.ts). Those copies are generated — do not edit them.

/**
 * Global key the binder installs itself under. `Symbol.for` so independently
 * loaded copies of this file (two CDN bundles on one page) still agree.
 */
export const BINDER_KEY = Symbol.for("wcstack.binder");

export interface IWcsBinder {
  readonly protocol: "wcs-binder";
  /** Integer protocol version. All versions >= 1 are participant-compatible. */
  readonly version: number;
  /**
   * Take a subtree that has just entered the document and bind whatever
   * declarations it carries.
   *
   * Contract (docs/binder-protocol-design.md §2):
   *   - Synchronous. Initial values are applied before this returns, so the
   *     caller never shows one frame of unbound markup.
   *   - Idempotent. A subtree that is already bound is left alone, so a caller
   *     may hand over the same nodes on every insertion without tracking which
   *     ones are new.
   *   - Binding survives later relocation, so this need not be called again when
   *     the same nodes are moved (measured: design doc §8-3).
   *   - Never throws for markup reasons; a subtree with no declarations is a
   *     no-op.
   */
  bind(subtree: Node): void;
}

/**
 * The installed binder, or null when there is none or it speaks a version this
 * reader does not.
 *
 * Looked up on every call rather than cached, for the same reason
 * transition-runner does: the page's composition can change at any point, and a
 * stale cache would keep calling into a binder that is no longer there.
 */
export function getBinder(): IWcsBinder | null {
  const candidate = (globalThis as Record<symbol, unknown>)[BINDER_KEY] as IWcsBinder | undefined;
  if (candidate === undefined || candidate === null) return null;
  if (candidate.protocol !== "wcs-binder") return null;
  if (typeof candidate.version !== "number" || candidate.version < 1) return null;
  if (typeof candidate.bind !== "function") return null;
  return candidate;
}

/**
 * Subtrees offered before a binder existed, and the set of everything a binder
 * has taken. Both live on global symbols so that independently loaded copies of
 * this file — the router's and state's — share one queue.
 *
 * The queue is needed because of load order: the router's auto bundle runs
 * before state's, so `<wcs-head>` reflects its children into `<head>` while
 * there is still nothing to bind them. Offering them to a binder that arrives
 * later is the difference between working and silently blank.
 */
const PENDING_KEY = Symbol.for("wcstack.binder.pending");
const TAKEN_KEY = Symbol.for("wcstack.binder.taken");

function pendingQueue(): Node[] {
  const globals = globalThis as Record<symbol, unknown>;
  let queue = globals[PENDING_KEY] as Node[] | undefined;
  if (queue === undefined) {
    queue = [];
    globals[PENDING_KEY] = queue;
  }
  return queue;
}

function takenSet(): WeakSet<Node> {
  const globals = globalThis as Record<symbol, unknown>;
  let taken = globals[TAKEN_KEY] as WeakSet<Node> | undefined;
  if (taken === undefined) {
    taken = new WeakSet<Node>();
    globals[TAKEN_KEY] = taken;
  }
  return taken;
}

/**
 * Hand `subtree` to the installed binder, or hold it for one that arrives later.
 *
 * Returns whether a binder took it *now*. A `false` does not yet mean the markup
 * is doomed — check {@link wasBoundBy} once module scripts have run.
 */
export function bindSubtree(subtree: Node): boolean {
  const binder = getBinder();
  if (binder === null) {
    pendingQueue().push(subtree);
    return false;
  }
  takenSet().add(subtree);
  binder.bind(subtree);
  return true;
}

/** Whether any binder has taken this subtree. */
export function wasBoundBy(subtree: Node): boolean {
  return takenSet().has(subtree);
}

/**
 * Bind everything offered before this binder existed. Called by the binder right
 * after it installs itself.
 */
export function flushPendingBinds(): void {
  const binder = getBinder();
  if (binder === null) return;
  const queue = pendingQueue();
  if (queue.length === 0) return;
  const pending = queue.splice(0, queue.length);
  const taken = takenSet();
  for (const subtree of pending) {
    taken.add(subtree);
    binder.bind(subtree);
  }
}
