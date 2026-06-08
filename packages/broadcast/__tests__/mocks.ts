/**
 * In-process fake BroadcastChannel.
 *
 * happy-dom does not implement BroadcastChannel, so tests install this fake as
 * the global constructor. It keeps a per-name registry of live instances and,
 * on postMessage, delivers a structured-clone *copy* to every OTHER instance on
 * the same channel — replicating the two semantics the Core depends on:
 *
 * - **self-exclusion**: the posting instance never receives its own message, so
 *   a single tab's `<wcs-broadcast>` only updates from a sibling on the same
 *   channel name (the cross-context property the whole package showcases).
 * - **structured clone**: peers receive a deep copy (not the same reference),
 *   and a non-cloneable payload throws `DataCloneError` synchronously, exactly
 *   as the platform does.
 *
 * Delivery is synchronous (the platform is async) so tests assert without
 * awaiting a tick; this does not change any observable Core behavior.
 */
export class FakeBroadcastChannel extends EventTarget {
  static registry = new Map<string, Set<FakeBroadcastChannel>>();
  /** Every instance ever constructed this test (cleared by reset()). */
  static created: FakeBroadcastChannel[] = [];

  static reset(): void {
    this.registry.clear();
    this.created = [];
  }

  /** Dispatch a `messageerror` on every live instance of the named channel. */
  static dispatchMessageError(name: string): void {
    const peers = this.registry.get(name);
    if (!peers) return;
    for (const peer of peers) {
      peer.dispatchEvent(new Event("messageerror"));
    }
  }

  name: string;
  closed = false;

  constructor(name: string) {
    super();
    this.name = name;
    FakeBroadcastChannel.created.push(this);
    let set = FakeBroadcastChannel.registry.get(name);
    if (!set) {
      set = new Set();
      FakeBroadcastChannel.registry.set(name, set);
    }
    set.add(this);
  }

  postMessage(data: unknown): void {
    // structuredClone throws DataCloneError for non-cloneable values, mirroring
    // the platform — the Core catches it and surfaces it through `error`.
    const cloned = structuredClone(data);
    const peers = FakeBroadcastChannel.registry.get(this.name);
    if (!peers) return;
    for (const peer of peers) {
      if (peer === this) continue; // self-exclusion
      if (peer.closed) continue;
      peer.dispatchEvent(makeMessageEvent("message", cloned));
    }
  }

  close(): void {
    this.closed = true;
    FakeBroadcastChannel.registry.get(this.name)?.delete(this);
  }
}

/**
 * Build a `message`-shaped event carrying `data`. We do not use the
 * `MessageEvent` constructor (uneven across DOM shims); the Core only reads
 * `event.data`, so a plain Event with a `data` field is sufficient and portable.
 */
function makeMessageEvent(type: string, data: unknown): MessageEvent {
  const event = new Event(type) as Event & { data: unknown };
  event.data = data;
  return event as MessageEvent;
}

const ORIGINAL = (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;

/** Install the fake as the global BroadcastChannel and clear its registry. */
export function installBroadcastChannel(): void {
  FakeBroadcastChannel.reset();
  (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = FakeBroadcastChannel;
}

/** Remove BroadcastChannel entirely, exercising the "unsupported" branches. */
export function removeBroadcastChannel(): void {
  (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = undefined;
}

/** Restore whatever BroadcastChannel the host environment originally had. */
export function restoreBroadcastChannel(): void {
  (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = ORIGINAL;
}
