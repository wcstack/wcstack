/**
 * Observation semantics of a `properties` entry.
 *
 *   "state"  — current value. A snapshot may cache it, and equality-based dedupe is safe.
 *   "event"  — occurrence. Repeated identical payloads are distinct occurrences; never dedupe.
 *   "handle" — live / opaque resource with its own lifecycle (e.g. MediaStream). Not
 *              snapshot-safe and not necessarily serializable; consumers need an explicit
 *              ref / callback surface rather than a value slot.
 */
type WcBindableSemantics = "state" | "event" | "handle";
interface IWcBindableProperty {
    readonly name: string;
    readonly event: string;
    readonly getter?: (event: Event) => any;
    /**
     * Optional, additive, forward-compatible. An absent value means **unspecified**, NOT
     * "state": a reader that finds no `semantics` MUST keep the behavior it had before this
     * field existed (deliver the update as-is; do not start deduping, caching or serializing
     * on assumption). Only an explicit value licenses a reader to change its handling.
     */
    readonly semantics?: WcBindableSemantics;
}
interface IWcBindableInput {
    readonly name: string;
    readonly attribute?: string;
}
interface IWcBindableCommand {
    readonly name: string;
    readonly async?: boolean;
}
interface IWcBindable {
    readonly protocol: "wc-bindable";
    /** Integer protocol version. All versions >= 1 are core-compatible. */
    readonly version: number;
    readonly properties: readonly IWcBindableProperty[];
    readonly inputs?: readonly IWcBindableInput[];
    readonly commands?: readonly IWcBindableCommand[];
}

interface ITagNames {
    readonly mediaQuery: string;
}
interface IWritableTagNames {
    mediaQuery?: string;
}
interface IConfig {
    readonly tagNames: ITagNames;
}
interface IWritableConfig {
    tagNames?: IWritableTagNames;
}

/**
 * The subset of `MediaQueryList` this node reads and subscribes to. Modern
 * engines expose `addEventListener("change", …)`; old Safari (< 14) only has
 * the deprecated `addListener` / `removeListener` pair, so both are optional
 * here and the Core picks whichever exists (docs/media-query-tag-design.md §5).
 */
interface WcsMediaQueryList {
    readonly matches: boolean;
    readonly media: string;
    addEventListener?(type: "change", listener: () => void): void;
    removeEventListener?(type: "change", listener: () => void): void;
    addListener?(listener: () => void): void;
    removeListener?(listener: () => void): void;
}
/**
 * Injectable `matchMedia` for MediaQueryCore. The default resolves
 * `globalThis.matchMedia` at call time (§3.7); tests inject a fake whose
 * `matches` and `change` dispatch they drive directly — happy-dom's
 * MediaQueryList change delivery is not reliable enough to test against
 * (the same precedent as `@wcstack/raf`'s reduced-motion gate).
 */
type WcsMatchMedia = (query: string) => WcsMediaQueryList;
interface WcsMediaQueryCoreOptions {
    matchMedia?: WcsMatchMedia;
}
/**
 * A single snapshot of the subscribed `MediaQueryList`, or the "nothing to
 * watch" default. `matched` (the list's `matches`) is `false` and `media` is `""` whenever there is
 * no live list — `matchMedia` absent (`supported === false`), an empty query,
 * or a `matchMedia` call that threw. `supported` answers only "is
 * `matchMedia` a function here", resolved on every observe().
 */
interface WcsMediaQuerySnapshot {
    matched: boolean;
    media: string;
    supported: boolean;
}
/**
 * Value types for MediaQueryCore (headless) — the observable state properties.
 * Use with `bind()` from a wc-bindable binding core for compile-time type checking.
 *
 * @example
 * ```typescript
 * const core = new MediaQueryCore();
 * bind(core, (name: keyof WcsMediaQueryCoreValues, value) => { ... });
 * ```
 */
type WcsMediaQueryCoreValues = WcsMediaQuerySnapshot;
/**
 * Value types for the Shell (`<wcs-media-query>`) — the Core's observable
 * surface plus the one attribute-linked input, `query`.
 */
type WcsMediaQueryValues = WcsMediaQueryCoreValues & {
    query: string;
};

declare function bootstrapMediaQuery(userConfig?: IWritableConfig, registry?: CustomElementRegistry): void;

declare function getConfig(): IConfig;

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
declare class MediaQueryCore extends EventTarget {
    static wcBindable: IWcBindable;
    private _target;
    private _snapshot;
    private _query;
    private _unsubscribe;
    private _subscribed;
    private _gen;
    private _injectedMatchMedia;
    private _ready;
    constructor(target?: EventTarget, options?: WcsMediaQueryCoreOptions);
    get ready(): Promise<void>;
    get query(): string;
    get matched(): boolean;
    get media(): string;
    get supported(): boolean;
    observe(query?: string): Promise<void>;
    dispose(): void;
    private _resolveMatchMedia;
    private _subscribe;
    private _teardown;
    private _read;
    private _apply;
}

/**
 * `<wcs-media-query query="(prefers-color-scheme: dark)">` — declarative
 * `matchMedia` monitor.
 *
 * One attribute (`query`), three outputs (`matched` / `media` / `supported`),
 * no commands. Changing `query` while connected re-subscribes the Core to the
 * new MediaQueryList (docs/media-query-tag-design.md §7).
 */
declare class WcsMediaQuery extends HTMLElement {
    static hasConnectedCallbackPromise: boolean;
    static wcBindable: IWcBindable;
    static get observedAttributes(): string[];
    private _core;
    private _connectedCallbackPromise;
    private _internals;
    constructor();
    get debugStates(): string[];
    private _initInternals;
    private _wireStates;
    get query(): string;
    set query(value: string);
    get matched(): boolean;
    get media(): string;
    get supported(): boolean;
    get connectedCallbackPromise(): Promise<void>;
    attributeChangedCallback(name: string, _oldValue: string | null, newValue: string | null): void;
    connectedCallback(): void;
    disconnectedCallback(): void;
}

declare global {
    interface HTMLElementTagNameMap {
        "wcs-media-query": WcsMediaQuery;
    }
}

export { MediaQueryCore, WcsMediaQuery, bootstrapMediaQuery, getConfig };
export type { IWritableConfig, IWritableTagNames, WcsMatchMedia, WcsMediaQueryCoreOptions, WcsMediaQueryCoreValues, WcsMediaQueryList, WcsMediaQuerySnapshot, WcsMediaQueryValues };
