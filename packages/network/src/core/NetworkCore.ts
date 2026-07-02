import { IWcBindable, WcsNetworkSnapshot } from "../types.js";

const UNSUPPORTED_SNAPSHOT: WcsNetworkSnapshot = Object.freeze({
  effectiveType: null,
  downlink: null,
  rtt: null,
  saveData: null,
  supported: false,
});

/**
 * Headless Network Information primitive. A thin, framework-agnostic wrapper
 * around `navigator.connection` exposed through the wc-bindable protocol.
 *
 * Unlike most wcstack IO nodes, this Core needs no `_gen` generation guard
 * (§3.4): subscribing/unsubscribing to `navigator.connection`'s `change` event
 * is fully synchronous, so there is no asynchronous probe whose stale
 * resolution could race a dispose() (docs/network-tag-design.md §5).
 *
 * `navigator.connection` is unimplemented in Firefox/Safari — unsupported is
 * the common case here, not an edge case (docs/network-tag-design.md §0). All
 * four data fields collapse to `null` and `supported` to `false` in that case.
 */
export class NetworkCore extends EventTarget {
  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [
      { name: "effectiveType", event: "wcs-network:change", getter: (e: Event) => (e as CustomEvent).detail.effectiveType },
      { name: "downlink", event: "wcs-network:change", getter: (e: Event) => (e as CustomEvent).detail.downlink },
      { name: "rtt", event: "wcs-network:change", getter: (e: Event) => (e as CustomEvent).detail.rtt },
      { name: "saveData", event: "wcs-network:change", getter: (e: Event) => (e as CustomEvent).detail.saveData },
      { name: "supported", event: "wcs-network:change", getter: (e: Event) => (e as CustomEvent).detail.supported },
    ],
    // Pure monitor: navigator.connection has no request()/action method to invoke.
    commands: [],
  };

  private _target: EventTarget;
  private _snapshot: WcsNetworkSnapshot = UNSUPPORTED_SNAPSHOT;

  // The live NetworkInformation object the `change` listener is attached to (kept
  // so dispose() can remove it precisely; not read for anything else).
  private _connection: EventTarget | null = null;

  // True once observe() has attached the live listener (or determined there is
  // nothing to attach to). Guards observe() so a redundant call does not
  // re-subscribe; dispose() resets it so a later observe() resumes cleanly.
  private _subscribed = false;

  // SSR (§3.8): no asynchronous probe to await — observe() completes
  // synchronously, so readiness is immediate.
  private _ready: Promise<void> = Promise.resolve();

  constructor(target?: EventTarget) {
    super();
    this._target = target ?? this;
  }

  get ready(): Promise<void> {
    return this._ready;
  }

  get effectiveType(): string | null {
    return this._snapshot.effectiveType;
  }

  get downlink(): number | null {
    return this._snapshot.downlink;
  }

  get rtt(): number | null {
    return this._snapshot.rtt;
  }

  get saveData(): boolean | null {
    return this._snapshot.saveData;
  }

  get supported(): boolean {
    return this._snapshot.supported;
  }

  // Lifecycle (§3.5). Idempotent: a second observe() while already subscribed
  // is a no-op (no double listener, no redundant dispatch). Synchronous overall
  // (no probe to await), so the returned promise is only for API uniformity
  // with other IO nodes.
  observe(): Promise<void> {
    if (!this._subscribed) {
      this._subscribed = true;
      const api = this._api();
      if (api) {
        this._connection = api;
        api.addEventListener("change", this._onChange);
      }
      this._apply(this._read());
    }
    return this._ready;
  }

  dispose(): void {
    this._subscribed = false;
    if (this._connection) {
      this._connection.removeEventListener("change", this._onChange);
      this._connection = null;
    }
  }

  // API resolution is call-time, never cached (§3.7): lets tests install/remove
  // navigator.connection freely and lets an unsupported environment be detected
  // correctly on every observe()/reading.
  private _api(): (EventTarget & { effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean }) | undefined {
    const nav = (globalThis as any).navigator;
    return typeof nav !== "undefined" && nav.connection ? nav.connection : undefined;
  }

  private _read(): WcsNetworkSnapshot {
    const c = this._api();
    if (!c) {
      return UNSUPPORTED_SNAPSHOT;
    }
    return {
      effectiveType: typeof c.effectiveType === "string" ? c.effectiveType : null,
      downlink: typeof c.downlink === "number" ? c.downlink : null,
      rtt: typeof c.rtt === "number" ? c.rtt : null,
      saveData: typeof c.saveData === "boolean" ? c.saveData : null,
      supported: true,
    };
  }

  private _onChange = (): void => {
    this._apply(this._read());
  };

  // Same-value guard (§3.3 MUST): the native `change` event already fires only
  // on a real change, but this Core still verifies field-by-field before
  // dispatching — defense in depth against a browser quirk double-firing
  // `change` with identical values.
  private _apply(next: WcsNetworkSnapshot): void {
    const prev = this._snapshot;
    if (
      prev.effectiveType === next.effectiveType &&
      prev.downlink === next.downlink &&
      prev.rtt === next.rtt &&
      prev.saveData === next.saveData &&
      prev.supported === next.supported
    ) {
      return;
    }
    this._snapshot = next;
    this._target.dispatchEvent(new CustomEvent("wcs-network:change", {
      detail: next,
      bubbles: true,
    }));
  }
}
