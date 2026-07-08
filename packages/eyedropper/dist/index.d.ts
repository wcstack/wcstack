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
    readonly eyedropper: string;
}
interface IWritableTagNames {
    eyedropper?: string;
}
interface IConfig {
    readonly tagNames: ITagNames;
}
interface IWritableConfig {
    tagNames?: IWritableTagNames;
}

/**
 * The result of a successful `new EyeDropper().open()` call — the platform's
 * own return shape, used verbatim (no synthesis needed, unlike
 * `@wcstack/share`'s `value`; see docs/eyedropper-tag-design.md §3).
 */
interface WcsEyedropperData {
    sRGBHex: string;
}
/**
 * Value types for EyedropperCore (headless) — the observable state properties.
 * Use with `bind()` from a wc-bindable binding core for compile-time type checking.
 *
 * @example
 * ```typescript
 * const core = new EyedropperCore();
 * bind(core, (name: keyof WcsEyedropperCoreValues, value) => { ... });
 * ```
 */
interface WcsEyedropperCoreValues {
    value: WcsEyedropperData | null;
    loading: boolean;
    error: any;
    cancelled: boolean;
}
/**
 * Value types for the Shell (`<wcs-eyedropper>`) — identical observable
 * surface to the Core. The Shell adds no inputs: `open()` takes no per-call
 * argument (docs/eyedropper-tag-design.md §5).
 */
type WcsEyedropperValues = WcsEyedropperCoreValues;

declare function bootstrapEyedropper(userConfig?: IWritableConfig): void;

declare function getConfig(): IConfig;

/**
 * Headless EyeDropper primitive. A thin, framework-agnostic wrapper around
 * `new EyeDropper().open(options)` exposed through the wc-bindable protocol.
 *
 * This is a simplified derivative of `FetchCore._doFetch`
 * (docs/eyedropper-tag-design.md §1, docs/web-share-tag-design.md §2): it
 * keeps the single `_gen` generation guard, the same-value-guarded private
 * setters, and the never-throw try/catch wrapper — the same skeleton
 * `@wcstack/share`'s `ShareCore` uses.
 *
 * Unlike `ShareCore`, this Core **does** restore `AbortController`/`abort()`
 * (docs/eyedropper-tag-design.md §2): `EyeDropper.open()` accepts a `{signal}`
 * option, so — unlike Web Share — a caller has a real platform mechanism to
 * cancel an in-flight color pick. The shape mirrors `FetchCore.abort()`
 * (packages/fetch/src/core/FetchCore.ts:159-164) including the identity check
 * on the locally-held `AbortController` in the `finally` block
 * (packages/fetch/src/core/FetchCore.ts:312-314), so a fast abort()→open()
 * sequence never lets a stale controller null out the new call's controller.
 *
 * Both the user dismissing the picker with Escape and the caller invoking
 * `abort()` reject `open()` with the same `AbortError` — both land on
 * `cancelled` without distinction (docs/eyedropper-tag-design.md §2).
 */
declare class EyedropperCore extends EventTarget {
    static wcBindable: IWcBindable;
    private _target;
    private _value;
    private _loading;
    private _error;
    private _cancelled;
    private _abortController;
    private _gen;
    private _ready;
    constructor(target?: EventTarget);
    get ready(): Promise<void>;
    get value(): WcsEyedropperData | null;
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
    /**
     * Cancels an in-flight `open()` call, if any. A no-op when no open() is in
     * flight (no AbortController has been created yet, or the previous one has
     * already settled) — mirrors `FetchCore.abort()`
     * (packages/fetch/src/core/FetchCore.ts:159-164).
     */
    abort(): void;
    open(): Promise<WcsEyedropperData | null>;
}

/**
 * `<wcs-eyedropper>` — declarative EyeDropper API primitive.
 *
 * The smallest command-only Shell in the batch (docs/eyedropper-tag-design.md
 * §5), mirroring `<wcs-share>`: no attributes at all. `open()` takes no
 * per-call argument — the `{signal}` option is supplied internally by the
 * Core's own AbortController, never via the command-token surface.
 */
declare class WcsEyedropper extends HTMLElement {
    static hasConnectedCallbackPromise: boolean;
    static wcBindable: IWcBindable;
    private _core;
    private _connectedCallbackPromise;
    private _internals;
    constructor();
    get debugStates(): string[];
    private _initInternals;
    private _wireStates;
    get value(): WcsEyedropperData | null;
    get loading(): boolean;
    get error(): any;
    get cancelled(): boolean;
    get connectedCallbackPromise(): Promise<void>;
    open(): Promise<WcsEyedropperData | null>;
    abort(): void;
    connectedCallback(): void;
    disconnectedCallback(): void;
}

export { EyedropperCore, WcsEyedropper, bootstrapEyedropper, getConfig };
export type { IWritableConfig, IWritableTagNames, WcsEyedropperCoreValues, WcsEyedropperData, WcsEyedropperValues };
