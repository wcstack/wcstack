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
    readonly share: string;
}
interface IWritableTagNames {
    share?: string;
}
interface IConfig {
    readonly tagNames: ITagNames;
}
interface IWritableConfig {
    tagNames?: IWritableTagNames;
}

/**
 * The data object passed to `navigator.share(data)` / `navigator.canShare(data)`.
 * All fields are optional per the Web Share API; a caller typically supplies a
 * subset (e.g. just `url`, or `title` + `text` + `url`, or `files`).
 */
interface WcsShareData {
    title?: string;
    text?: string;
    url?: string;
    files?: File[];
}
/**
 * Value types for ShareCore (headless) — the observable state properties.
 * Use with `bind()` from a wc-bindable binding core for compile-time type checking.
 *
 * @example
 * ```typescript
 * const core = new ShareCore();
 * bind(core, (name: keyof WcsShareCoreValues, value) => { ... });
 * ```
 */
interface WcsShareCoreValues {
    /**
     * The success signal: an echo of the `data` object passed to the `share()`
     * call that just completed successfully (navigator.share() itself resolves
     * `Promise<void>`, so `value` is synthesized rather than read off the API —
     * see docs/web-share-tag-design.md §4). `null` before any successful share.
     */
    value: WcsShareData | null;
    loading: boolean;
    /**
     * A true platform failure (anything other than the user cancelling the
     * share sheet). `null` when there has been no failure yet or after a reset.
     */
    error: any;
    /**
     * `true` when the user dismissed the share sheet (AbortError). Kept
     * separate from `error` so a binding gated on `error` does not react to a
     * routine cancellation (docs/web-share-tag-design.md §3).
     */
    cancelled: boolean;
}
/**
 * Value types for the Shell (`<wcs-share>`) — identical observable surface to
 * the Core. The Shell adds no inputs: `share(data)`'s `data` is a per-call
 * argument, not a declarative attribute (docs/web-share-tag-design.md §10).
 */
type WcsShareValues = WcsShareCoreValues;

declare function bootstrapShare(userConfig?: IWritableConfig): void;

declare function getConfig(): IConfig;

/**
 * Headless Web Share primitive. A thin, framework-agnostic wrapper around
 * `navigator.share(data)` exposed through the wc-bindable protocol.
 *
 * This is a simplified derivative of `FetchCore._doFetch`
 * (docs/web-share-tag-design.md §2): it keeps the single `_gen` generation
 * guard, the same-value-guarded private setters, and the never-throw
 * try/catch wrapper, but drops `AbortController`/`abort()` entirely —
 * `navigator.share()` accepts no `AbortSignal` and there is no platform
 * mechanism for a caller to cancel an in-flight share dialog. A share dialog
 * is also a single system-modal surface (at most one open at a time), so the
 * "a new call supersedes the previous one" plumbing that `FetchCore` needs
 * has no counterpart here either.
 */
declare class ShareCore extends EventTarget {
    static wcBindable: IWcBindable;
    private _target;
    private _value;
    private _loading;
    private _error;
    private _cancelled;
    private _gen;
    private _ready;
    constructor(target?: EventTarget);
    get ready(): Promise<void>;
    get value(): WcsShareData | null;
    get loading(): boolean;
    get error(): any;
    get cancelled(): boolean;
    observe(): Promise<void>;
    dispose(): void;
    private _setLoading;
    private _setValue;
    private _setError;
    private _setCancelled;
    private _api;
    share(data?: WcsShareData): Promise<WcsShareData | null>;
}

/**
 * `<wcs-share>` — declarative Web Share API primitive.
 *
 * The smallest command-only Shell in the batch (docs/web-share-tag-design.md
 * §10): no attributes at all. `share(data)`'s `data` is a per-call argument,
 * not a declarative setting to park on the element ahead of time.
 */
declare class WcsShare extends HTMLElement {
    static hasConnectedCallbackPromise: boolean;
    static wcBindable: IWcBindable;
    private _core;
    private _connectedCallbackPromise;
    constructor();
    get value(): WcsShareData | null;
    get loading(): boolean;
    get error(): any;
    get cancelled(): boolean;
    get connectedCallbackPromise(): Promise<void>;
    share(data?: WcsShareData): Promise<WcsShareData | null>;
    /**
     * Synchronous, side-effect-free delegation to `navigator.canShare(data)`
     * (docs/web-share-tag-design.md §6). Deliberately outside `wcBindable`
     * (not a `properties`/`commands` entry): the platform method takes an
     * argument that varies per call, which does not fit the "observe with no
     * arguments" shape of a bindable property, and is synchronous, which does
     * not fit the fire-and-observe-via-event shape of a command.
     *
     * No never-throw wrapping: the platform method itself is synchronous and
     * side-effect-free, so a throw here would indicate a browser bug rather
     * than a condition this Shell should paper over. `navigator.canShare` is
     * still resolved defensively (some environments lack it even when `share`
     * exists), returning `false` rather than throwing in that case.
     */
    canShare(data?: WcsShareData): boolean;
    connectedCallback(): void;
    disconnectedCallback(): void;
}

export { ShareCore, WcsShare, bootstrapShare, getConfig };
export type { IWritableConfig, IWritableTagNames, WcsShareCoreValues, WcsShareData, WcsShareValues };
