interface IWcBindableProperty {
    readonly name: string;
    readonly event: string;
    readonly getter?: (event: Event) => any;
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
    readonly network: string;
}
interface IWritableTagNames {
    network?: string;
}
interface IConfig {
    readonly tagNames: ITagNames;
}
interface IWritableConfig {
    tagNames?: IWritableTagNames;
}

/**
 * A single snapshot of `navigator.connection` (Network Information API), or the
 * unsupported default. `effectiveType`/`downlink`/`rtt`/`saveData` are `null`
 * when the API is absent (`supported === false`) — and each also normalizes to
 * `null` individually, even while `supported` is `true`, when the browser
 * reports that field as missing or with an unexpected type; `downlinkMax` and
 * `type` are intentionally not surfaced (see docs/network-tag-design.md §2).
 */
interface WcsNetworkSnapshot {
    effectiveType: string | null;
    downlink: number | null;
    rtt: number | null;
    saveData: boolean | null;
    supported: boolean;
}
/**
 * Value types for NetworkCore (headless) — the observable state properties.
 * Use with `bind()` from a wc-bindable binding core for compile-time type checking.
 *
 * @example
 * ```typescript
 * const core = new NetworkCore();
 * bind(core, (name: keyof WcsNetworkCoreValues, value) => { ... });
 * ```
 */
type WcsNetworkCoreValues = WcsNetworkSnapshot;
/**
 * Value types for the Shell (`<wcs-network>`) — identical observable surface to
 * the Core. The Shell adds no inputs and no commands: `navigator.connection` is a
 * single global with nothing to configure and no request()-style action.
 */
type WcsNetworkValues = WcsNetworkCoreValues;

declare function bootstrapNetwork(userConfig?: IWritableConfig): void;

declare function getConfig(): IConfig;

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
declare class NetworkCore extends EventTarget {
    static wcBindable: IWcBindable;
    private _target;
    private _snapshot;
    private _connection;
    private _subscribed;
    private _ready;
    constructor(target?: EventTarget);
    get ready(): Promise<void>;
    get effectiveType(): string | null;
    get downlink(): number | null;
    get rtt(): number | null;
    get saveData(): boolean | null;
    get supported(): boolean;
    observe(): Promise<void>;
    dispose(): void;
    private _api;
    private _read;
    private _onChange;
    private _apply;
}

/**
 * `<wcs-network>` — declarative Network Information API monitor.
 *
 * The smallest Shell in the batch (docs/network-tag-design.md §9): no
 * attributes at all. `navigator.connection` is a single global with nothing to
 * configure, unlike target-based nodes (`intersection`/`resize`) or
 * descriptor-based ones (`permission`).
 */
declare class WcsNetwork extends HTMLElement {
    static hasConnectedCallbackPromise: boolean;
    static wcBindable: IWcBindable;
    private _core;
    private _connectedCallbackPromise;
    private _internals;
    constructor();
    get debugStates(): string[];
    private _initInternals;
    private _wireStates;
    get effectiveType(): string | null;
    get downlink(): number | null;
    get rtt(): number | null;
    get saveData(): boolean | null;
    get supported(): boolean;
    get connectedCallbackPromise(): Promise<void>;
    connectedCallback(): void;
    disconnectedCallback(): void;
}

export { NetworkCore, WcsNetwork, bootstrapNetwork, getConfig };
export type { IWritableConfig, IWritableTagNames, WcsNetworkCoreValues, WcsNetworkSnapshot, WcsNetworkValues };
