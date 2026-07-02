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
    readonly version: 1;
    readonly properties: readonly IWcBindableProperty[];
    readonly inputs?: readonly IWcBindableInput[];
    readonly commands?: readonly IWcBindableCommand[];
}

interface ITagNames {
    readonly screenOrientation: string;
}
interface IWritableTagNames {
    screenOrientation?: string;
}
interface IConfig {
    readonly tagNames: ITagNames;
}
interface IWritableConfig {
    tagNames?: IWritableTagNames;
}

/**
 * `OrientationLockType` — the string union `ScreenOrientation.lock()` accepts.
 * Not defined in `lib.dom.d.ts` (the method itself is missing there because the
 * API is still experimental); defined here from the W3C Screen Orientation API
 * spec so `lock()` gets compile-time completion/typo detection. This is a DX
 * aid only — `lock()` does not validate the value at runtime (see
 * docs/screen-orientation-tag-design.md §4); an unrecognized string is passed
 * through verbatim and the browser rejects it, which never-throw absorbs into
 * `error`.
 */
type OrientationLockType = "any" | "natural" | "landscape" | "portrait" | "portrait-primary" | "portrait-secondary" | "landscape-primary" | "landscape-secondary";
/**
 * A single snapshot of `screen.orientation` (Screen Orientation API), or the
 * unsupported default. `type`/`angle` are `null` when the API is absent (see
 * docs/screen-orientation-tag-design.md §7). Unlike `@wcstack/network`, there
 * is no explicit `supported` boolean — `type === null` is the unsupported
 * signal (§7).
 */
interface WcsScreenOrientationSnapshot {
    type: OrientationType | null;
    angle: number | null;
}
/**
 * Value types for ScreenOrientationCore (headless) — the observable state
 * properties plus the derived `portrait`/`landscape` booleans. Use with
 * `bind()` from a wc-bindable binding core for compile-time type checking.
 *
 * @example
 * ```typescript
 * const core = new ScreenOrientationCore();
 * bind(core, (name: keyof WcsScreenOrientationCoreValues, value) => { ... });
 * ```
 */
type WcsScreenOrientationCoreValues = WcsScreenOrientationSnapshot & {
    portrait: boolean;
    landscape: boolean;
    error: any;
};
/**
 * Value types for the Shell (`<wcs-screen-orientation>`) — identical
 * observable surface to the Core. The Shell adds no inputs: `screen.orientation`
 * is a single global with nothing to configure. It adds no commands beyond the
 * Core's `lock`/`unlock` (delegated, not duplicated).
 */
type WcsScreenOrientationValues = WcsScreenOrientationCoreValues;

declare function bootstrapScreenOrientation(userConfig?: IWritableConfig): void;

declare function getConfig(): IConfig;

/**
 * Headless Screen Orientation primitive. A thin, framework-agnostic wrapper
 * around `screen.orientation` exposed through the wc-bindable protocol.
 *
 * Like `@wcstack/network`, monitoring needs no `_gen` generation guard (§6.1):
 * subscribing/unsubscribing to `screen.orientation`'s `change` event is fully
 * synchronous, so there is no asynchronous probe whose stale resolution could
 * race a dispose() (docs/screen-orientation-tag-design.md §6.1).
 *
 * Unlike `network`, this Core is **bidirectional**: it also exposes `lock()`/
 * `unlock()` commands. `lock()` is asynchronous and in-flight, so it needs its
 * own single `_gen` generation guard — independent from (and unrelated to) the
 * synchronous monitoring path (docs/screen-orientation-tag-design.md §6.2).
 * This asymmetry (monitor: no `_gen`; command: `_gen` required) is the
 * defining trait of this node within the IO-node batch.
 */
declare class ScreenOrientationCore extends EventTarget {
    static wcBindable: IWcBindable;
    private _target;
    private _snapshot;
    private _error;
    private _orientation;
    private _subscribed;
    private _gen;
    private _ready;
    constructor(target?: EventTarget);
    get ready(): Promise<void>;
    get type(): WcsScreenOrientationSnapshot["type"];
    get angle(): number | null;
    get portrait(): boolean;
    get landscape(): boolean;
    get error(): any;
    observe(): Promise<void>;
    dispose(): void;
    /**
     * Request a specific orientation lock. Best-effort (§5): most desktop
     * browsers reject with `NotSupportedError` outside a mobile / fullscreen
     * context. never-throw (§3.6) — failures land in `error`, never as a
     * rejected promise from the caller's perspective (the returned promise
     * always resolves). Validation is intentionally NOT performed (§4): the
     * value is passed through verbatim and an unrecognized string is left to
     * the browser to reject.
     */
    lock(orientation: OrientationLockType): Promise<void>;
    /**
     * Release a previously requested orientation lock. Synchronous (mirrors the
     * platform API) — no promise to await, no rejection to absorb. Bumps `_gen`
     * so an in-flight `lock()` cannot resolve after this call and overwrite the
     * state unlock() just established (§6.2).
     */
    unlock(): void;
    private _api;
    private _read;
    private _onChange;
    private _setError;
    private _apply;
}

/**
 * `<wcs-screen-orientation>` — declarative Screen Orientation API monitor +
 * command node.
 *
 * The Shell is as small as `<wcs-network>` (docs/screen-orientation-tag-design.md
 * §3, §10): no attributes at all. `screen.orientation` is a single global with
 * nothing to configure, unlike target-based nodes (`intersection`/`resize`) or
 * descriptor-based ones (`permission`). Unlike `network`, though, this Shell is
 * bidirectional: it also delegates the `lock()`/`unlock()` commands.
 */
declare class WcsScreenOrientation extends HTMLElement {
    static hasConnectedCallbackPromise: boolean;
    static wcBindable: IWcBindable;
    private _core;
    private _connectedCallbackPromise;
    constructor();
    get type(): WcsScreenOrientationSnapshot["type"];
    get angle(): number | null;
    get portrait(): boolean;
    get landscape(): boolean;
    get error(): any;
    get connectedCallbackPromise(): Promise<void>;
    lock(orientation: OrientationLockType): Promise<void>;
    unlock(): void;
    connectedCallback(): void;
    disconnectedCallback(): void;
}

export { ScreenOrientationCore, WcsScreenOrientation, bootstrapScreenOrientation, getConfig };
export type { IWritableConfig, IWritableTagNames, OrientationLockType, WcsScreenOrientationCoreValues, WcsScreenOrientationSnapshot, WcsScreenOrientationValues };
