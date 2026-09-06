import {
  IWcBindable, WcsMatchMedia, WcsMediaQueryCoreOptions, WcsMediaQueryList, WcsMediaQuerySnapshot,
} from "../types.js";

const UNSUPPORTED_SNAPSHOT: WcsMediaQuerySnapshot = Object.freeze({
  matched: false,
  media: "",
  supported: false,
});

// "matchMedia exists but there is nothing to watch": an empty query, or a
// matchMedia call that threw. Same shape as UNSUPPORTED_SNAPSHOT except that
// `supported` stays honest about the API being present.
const IDLE_SNAPSHOT: WcsMediaQuerySnapshot = Object.freeze({
  matched: false,
  media: "",
  supported: true,
});

/**
 * Headless media-query primitive. A thin, framework-agnostic wrapper around
 * `window.matchMedia` exposed through the wc-bindable protocol.
 *
 * `observe(query)` subscribes to one `MediaQueryList` and republishes its
 * `matches` / `media` as `matched` / `media` state; a different query while subscribed tears the
 * old list down and subscribes to the new one. Subscribing is synchronous, but
 * — unlike `@wcstack/network` — this Core does keep a `_gen` generation guard
 * (§3.4): each subscription's `change` listener captures the generation it was
 * created under and bails when it is stale, so a `MediaQueryList` whose
 * `removeEventListener` / `removeListener` misbehaves can never write the old
 * query's `matched` over the new query's (docs/media-query-tag-design.md §6).
 *
 * `matchMedia` is universally available in browsers; `supported === false` is
 * the non-browser case (SSR, workers) rather than a browser quirk.
 */
export class MediaQueryCore extends EventTarget {
  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [
      { name: "matched", event: "wcs-media-query:change", semantics: "state", getter: (e: Event) => (e as CustomEvent).detail.matched },
      { name: "media", event: "wcs-media-query:change", semantics: "state", getter: (e: Event) => (e as CustomEvent).detail.media },
      { name: "supported", event: "wcs-media-query:change", semantics: "state", getter: (e: Event) => (e as CustomEvent).detail.supported },
    ],
    // Pure monitor: a MediaQueryList has no action to invoke.
    //
    // `matched`, not `matches`: `Element.prototype.matches(selector)` exists on
    // every element, and a wc-bindable property name is read straight off the
    // Shell — a boolean `matches` would shadow the platform method
    // (docs/media-query-tag-design.md §2.1).
    commands: [],
  };

  private _target: EventTarget;
  private _snapshot: WcsMediaQuerySnapshot = UNSUPPORTED_SNAPSHOT;

  // The query currently subscribed (or last requested). "" means "nothing to watch".
  private _query = "";

  // Detaches the live `change` listener of the current subscription, if any.
  private _unsubscribe: (() => void) | null = null;

  // True between observe() and dispose(). Guards observe() so a redundant call
  // with the same query does not re-subscribe; dispose() resets it.
  private _subscribed = false;

  // Generation guard (§3.4). Bumped by every (re)subscription and by dispose().
  // A `change` listener captures its generation and ignores the event once a
  // newer subscription exists — see the class docs for why this is kept even
  // though subscribing itself is synchronous.
  private _gen = 0;

  // Injected matchMedia (tests / non-window hosts). `null` = resolve
  // `globalThis.matchMedia` at call time (§3.7).
  private _injectedMatchMedia: WcsMatchMedia | null;

  // SSR (§3.8): no asynchronous probe to await — observe() completes
  // synchronously, so readiness is immediate.
  private _ready: Promise<void> = Promise.resolve();

  constructor(target?: EventTarget, options?: WcsMediaQueryCoreOptions) {
    super();
    this._target = target ?? this;
    this._injectedMatchMedia = options?.matchMedia ?? null;
  }

  get ready(): Promise<void> {
    return this._ready;
  }

  get query(): string {
    return this._query;
  }

  get matched(): boolean {
    return this._snapshot.matched;
  }

  get media(): string {
    return this._snapshot.media;
  }

  get supported(): boolean {
    return this._snapshot.supported;
  }

  // Lifecycle (§3.5). Idempotent: observe() with the query already subscribed
  // is a no-op (no double listener, no redundant dispatch). A different query
  // re-subscribes (dispose-then-observe semantics in one call). Omitting the
  // argument keeps the current query — the reconnect case for the Shell.
  // Synchronous overall (no probe to await), so the returned promise is only
  // for API uniformity with other IO nodes.
  observe(query: string = this._query): Promise<void> {
    if (this._subscribed && query === this._query) {
      return this._ready;
    }
    this._teardown();
    this._query = query;
    this._subscribed = true;
    this._subscribe(query);
    return this._ready;
  }

  dispose(): void {
    this._subscribed = false;
    this._teardown();
  }

  // API resolution is call-time, never cached (§3.7): lets tests install/remove
  // globalThis.matchMedia freely and lets a non-browser host be detected
  // correctly on every observe(). Called as a method of globalThis so the
  // native implementation keeps its `this` (calling it unbound throws).
  private _resolveMatchMedia(): WcsMatchMedia | null {
    if (this._injectedMatchMedia !== null) {
      return this._injectedMatchMedia;
    }
    const g = globalThis as { matchMedia?: WcsMatchMedia };
    return typeof g.matchMedia === "function" ? (q: string) => g.matchMedia!(q) : null;
  }

  private _subscribe(query: string): void {
    const gen = ++this._gen;
    const matchMedia = this._resolveMatchMedia();
    if (matchMedia === null) {
      this._apply(UNSUPPORTED_SNAPSHOT);
      return;
    }
    if (query === "") {
      this._apply(IDLE_SNAPSHOT);
      return;
    }
    // never-throw (§3.6): browsers do not throw on an invalid query string
    // (they return `media: "not all"`), but a hostile host or a broken
    // MediaQueryList polyfill might — that must not kill observe().
    let list: WcsMediaQueryList | null = null;
    try {
      list = matchMedia(query);
      const onChange = (): void => {
        if (gen !== this._gen) return; // stale subscription — never write
        this._apply(this._read(list!));
      };
      this._unsubscribe = attachChange(list, onChange);
    } catch {
      list = null;
      this._unsubscribe = null;
    }
    this._apply(list === null ? IDLE_SNAPSHOT : this._read(list));
  }

  private _teardown(): void {
    this._gen++;
    if (this._unsubscribe !== null) {
      const unsubscribe = this._unsubscribe;
      this._unsubscribe = null;
      try {
        unsubscribe();
      } catch {
        // never-throw: a list that refuses to detach is already neutralized
        // by the generation bump above.
      }
    }
  }

  private _read(list: WcsMediaQueryList): WcsMediaQuerySnapshot {
    return {
      matched: list.matches === true,
      media: typeof list.media === "string" ? list.media : "",
      supported: true,
    };
  }

  // Same-value guard (§3.3 MUST): the native `change` event already fires only
  // when `matches` flips, but this Core still verifies field-by-field before
  // dispatching — a re-subscription to an equivalent query, or a legacy
  // `addListener` double-fire, must not produce a redundant event.
  private _apply(next: WcsMediaQuerySnapshot): void {
    const prev = this._snapshot;
    if (
      prev.matched === next.matched &&
      prev.media === next.media &&
      prev.supported === next.supported
    ) {
      return;
    }
    this._snapshot = next;
    this._target.dispatchEvent(new CustomEvent("wcs-media-query:change", {
      detail: next,
      // Family-wide MUST (async-io-node-guidelines.md §3.3): the event bubbles
      // from the Shell element so document-level consumers can delegate.
      bubbles: true,
    }));
  }
}

// Subscribe to a MediaQueryList's `change` with whichever listener API it has.
// Modern engines: EventTarget-style. Old Safari (< 14): the deprecated
// addListener / removeListener pair. Neither: no live updates — the snapshot
// taken at observe() is all there is (a static polyfill, for instance).
// Returns the matching detach function.
function attachChange(list: WcsMediaQueryList, listener: () => void): () => void {
  if (typeof list.addEventListener === "function" && typeof list.removeEventListener === "function") {
    list.addEventListener("change", listener);
    return () => list.removeEventListener!("change", listener);
  }
  if (typeof list.addListener === "function" && typeof list.removeListener === "function") {
    list.addListener(listener);
    return () => list.removeListener!(listener);
  }
  return () => {};
}
