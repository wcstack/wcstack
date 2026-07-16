/** operation error の phase(taxonomy)。 */
type WcsIoErrorPhase = "probe" | "start" | "execute" | "decode" | "commit" | "dispose";
/** serializable な error info(non-cloneable な cause とは分離。DevTools / remote へは info のみ)。 */
interface WcsIoErrorInfo {
    readonly code: string;
    readonly phase: WcsIoErrorPhase;
    readonly recoverable: boolean;
    readonly capabilityId?: string;
    readonly message: string;
}

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
    readonly fullscreen: string;
}
interface IWritableTagNames {
    fullscreen?: string;
}
interface IConfig {
    readonly tagNames: ITagNames;
}
interface IWritableConfig {
    tagNames?: IWritableTagNames;
}

/**
 * Value types for FullscreenCore (headless) — the Core's readable value
 * surface. `active`, `error`, and `errorInfo` are all *observable* (declared in
 * `wcBindable.properties` with change events: `wcs-fullscreen:change` /
 * `:error` / `:error-info-changed`), so a wc-bindable binding core delivers a
 * request/exit failure. `errorInfo` is the additive serializable failure
 * taxonomy derived from `error` (docs/fullscreen-tag-design.md §8, README).
 *
 * @example
 * ```typescript
 * const core = new FullscreenCore();
 * bind(core, (name: keyof WcsFullscreenCoreValues, value) => { ... });
 * ```
 */
interface WcsFullscreenCoreValues {
    active: boolean;
    error: any;
    /** Additive failure taxonomy derived from `error` (stable code / phase / recoverable). */
    errorInfo: WcsIoErrorInfo | null;
}
/**
 * Value types for the Shell (`<wcs-fullscreen target="...">`) — identical
 * value surface to the Core (`active` / `error` / `errorInfo` all observable).
 * The Shell adds the `target` input (attribute-mirrored) that resolves which
 * element requestFullscreen()/exitFullscreen() operate on
 * (docs/fullscreen-tag-design.md §1/§9).
 */
type WcsFullscreenValues = WcsFullscreenCoreValues;

declare function bootstrapFullscreen(userConfig?: IWritableConfig): void;

declare function getConfig(): IConfig;

/**
 * Headless Fullscreen API primitive. Unlike most wcstack IO nodes, this Core
 * does not operate on itself: it drives `requestFullscreen()` /
 * `exitFullscreen()` on a *referenced* Element that the Shell resolves via its
 * `target` attribute (docs/fullscreen-tag-design.md §0). The Core only ever
 * receives already-resolved `Element`s from its callers — it has no opinion on
 * how `target` selectors are parsed.
 *
 * `document.fullscreenElement` is a single document-wide value, so this Core
 * always compares against the *last element it resolved* (via
 * `requestFullscreen()`/`setTarget()`), never against "is the document
 * fullscreen at all" — that comparison is what keeps multiple concurrent
 * `<wcs-fullscreen>` instances from all reporting the same `active` value
 * (docs/fullscreen-tag-design.md §2.1, MUST).
 */
declare class FullscreenCore extends EventTarget {
    static wcBindable: IWcBindable;
    private _target;
    private _active;
    private _error;
    private _errorInfo;
    private _resolvedTarget;
    private _gen;
    private _subscribed;
    private _ready;
    constructor(target?: EventTarget);
    get ready(): Promise<void>;
    get active(): boolean;
    get error(): any;
    /**
     * The last failure's serializable `WcsIoErrorInfo` (stable `code` / `phase` /
     * `recoverable`), or null. Additive wc-bindable property (event
     * `wcs-fullscreen:error-info-changed`), derived from `error`; the existing
     * `error` value shape is unchanged.
     */
    get errorInfo(): WcsIoErrorInfo | null;
    /**
     * Update the resolved target without issuing a fullscreen request (e.g. the
     * Shell re-resolves `target` on attribute change / connect). Re-evaluates
     * `active` against the current `document.fullscreenElement` so the state
     * stays correct even if the target changed while already fullscreen.
     */
    setTarget(element: Element | null): void;
    observe(): Promise<void>;
    dispose(): void;
    /**
     * Request fullscreen on `element`. never-throw (§3/§6): a missing API or a
     * rejected promise (e.g. a `TypeError` from a call outside a user
     * gesture, per the WHATWG Fullscreen spec's transient-activation check) is
     * caught and surfaced via `error`, never thrown. The caller
     * (Shell) is responsible for resolving `target` and for ensuring this is
     * invoked from within an actual user gesture — this Core cannot manufacture
     * one (docs/fullscreen-tag-design.md §3).
     */
    requestFullscreen(element: Element | null): Promise<void>;
    /**
     * Exit fullscreen. Silent no-op (§7) when nothing is currently fullscreen or
     * the API is unsupported — both are treated as "already achieved the exit
     * intent", not as errors, keeping repeated calls safe and never-throw.
     */
    exitFullscreen(): Promise<void>;
    private _requestFullscreenFn;
    private _elementFullscreenFn;
    private _exitFullscreenFn;
    private _fullscreenElement;
    private _fullscreenChangeEventName;
    private _onFullscreenChange;
    private _applyActive;
    private _setActive;
    private _setError;
    private _commitErrorInfo;
}

/**
 * `<wcs-fullscreen target="...">` — declarative Fullscreen API control.
 *
 * Like `intersection`/`resize`, this Shell operates on a *referenced* element,
 * not itself (docs/fullscreen-tag-design.md §0): `target` resolves which
 * element `requestFullscreen()`/`exitFullscreen()` are invoked on, using the
 * exact same 3-mode resolution as `<wcs-intersect>`
 * (docs/fullscreen-tag-design.md §1):
 *
 * | `target`        | operates on            | display     | use case                |
 * |-----------------|-------------------------|-------------|--------------------------|
 * | omitted         | first element child     | `contents`  | wrap a gallery image/video |
 * | `"#hero"` / sel | the matched element      | `none`      | point at a distant node  |
 * | `"self"`        | the element itself       | `block`     | fullscreen the wrapper   |
 *
 * `requestFullscreen()` requires an active user gesture — this element cannot
 * manufacture one. Invoke the command from within a real click handler
 * (typically via the command-token protocol: this element subscribes with
 * `command.requestFullscreen: $command.<token>`, and a button emits the
 * token from its own click handler, e.g. `onclick: $command.<token>`).
 */
declare class WcsFullscreen extends HTMLElement {
    static hasConnectedCallbackPromise: boolean;
    static observedAttributes: string[];
    static wcBindable: IWcBindable;
    private _core;
    private _connectedCallbackPromise;
    private _internals;
    constructor();
    get debugStates(): string[];
    private _initInternals;
    private _wireStates;
    get connectedCallbackPromise(): Promise<void>;
    get target(): string;
    set target(value: string);
    get active(): boolean;
    get error(): any;
    get errorInfo(): WcsIoErrorInfo | null;
    /**
     * Resolve `target` and request fullscreen on it. never-throw: an
     * unresolvable target or an unsupported/rejected API call are both
     * surfaced via `error`, never thrown (docs/fullscreen-tag-design.md §3/§6).
     */
    requestFullscreen(): Promise<void>;
    exitFullscreen(): Promise<void>;
    private _resolveTarget;
    private _safeQuery;
    private _reresolve;
    connectedCallback(): void;
    disconnectedCallback(): void;
    attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null): void;
}

/**
 * fullscreenCapabilities.ts
 *
 * Fullscreen node 固有の error code(taxonomy)と derivation。汎用の error info 型は
 * `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)から
 * import する。fullscreen は referenced element を操作するモニタ的ノードで競合 operation
 * を持たないため lane は無く、error taxonomy(errorInfo)のみを採用する。
 *
 * `_setError` は合成 `{ message }`(target 未解決 / API 非対応)と caught 例外
 * (`NotAllowedError` / `TypeError` = user gesture 外の requestFullscreen 拒否)を混在
 * 受理する。呼出側が明示 `code` を渡して合成側を曖昧さ無く分類し、caught は `.name` で
 * 分類する(storage / screen-orientation と同じ discriminator 方式)。
 */

/** 安定した fullscreen error code(taxonomy)。値は公開キーとして固定。 */
declare const WCS_FULLSCREEN_ERROR_CODE: {
    /** Fullscreen API 非対応。 */
    readonly CapabilityMissing: "capability-missing";
    /** target selector が要素に解決しない等の入力不備。 */
    readonly InvalidArgument: "invalid-argument";
    /** `NotAllowedError` / `TypeError` — user gesture 外での要求拒否。 */
    readonly NotAllowed: "not-allowed";
    /** その他の caught 例外。 */
    readonly FullscreenError: "fullscreen-error";
};

export { FullscreenCore, WCS_FULLSCREEN_ERROR_CODE, WcsFullscreen, bootstrapFullscreen, getConfig };
export type { IWritableConfig, IWritableTagNames, WcsFullscreenCoreValues, WcsFullscreenValues, WcsIoErrorInfo, WcsIoErrorPhase };
