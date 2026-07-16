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
    readonly pointerLock: string;
}
interface IWritableTagNames {
    pointerLock?: string;
}
interface IConfig {
    readonly tagNames: ITagNames;
}
interface IWritableConfig {
    tagNames?: IWritableTagNames;
}

/**
 * Value types for PointerLockCore (headless) — the Core's readable value
 * surface. `active`, `error`, and `errorInfo` are all *observable* (declared in
 * `wcBindable.properties` with change events: `wcs-pointer-lock:change` /
 * `:error` / `:error-info-changed`), so a wc-bindable binding core delivers a
 * request/exit failure. `errorInfo` is the additive serializable failure
 * taxonomy derived from `error` (docs/pointer-lock-tag-design.md §2, README).
 *
 * @example
 * ```typescript
 * const core = new PointerLockCore();
 * bind(core, (name: keyof WcsPointerLockCoreValues, value) => { ... });
 * ```
 */
interface WcsPointerLockCoreValues {
    active: boolean;
    error: any;
    /** Additive failure taxonomy derived from `error` (stable code / phase / recoverable). */
    errorInfo: WcsIoErrorInfo | null;
}
/**
 * Value types for the Shell (`<wcs-pointer-lock>`) — identical value surface
 * to the Core (`active` / `error` / `errorInfo` all observable). The Shell
 * additionally accepts a `target` attribute
 * (see docs/pointer-lock-tag-design.md / docs/fullscreen-tag-design.md §1).
 */
type WcsPointerLockValues = WcsPointerLockCoreValues;

declare function bootstrapPointerLock(userConfig?: IWritableConfig): void;

declare function getConfig(): IConfig;

/**
 * Headless Pointer Lock primitive. A thin, framework-agnostic wrapper around
 * the Pointer Lock API (`Element.requestPointerLock()` /
 * `document.exitPointerLock()` / `document.pointerLockElement` / the
 * `document`-scoped `pointerlockchange` event) exposed through the
 * wc-bindable protocol.
 *
 * This Core follows the same basic pattern as `FullscreenCore`
 * (docs/fullscreen-tag-design.md, referenced by docs/pointer-lock-tag-design.md
 * §1): target resolution happens in the Shell, `pointerlockchange` is
 * subscribed on `document` (not on the target element) and each instance
 * self-filters by comparing `document.pointerLockElement` against its own
 * resolved target, API resolution is call-time (never cached) and probes the
 * standard name before the legacy (`webkit`-prefixed) name, and a single
 * Core-level `_gen` generation guard protects the asynchronous
 * `requestPointerLock()` call from stale resolution after dispose().
 *
 * Key difference from Fullscreen (docs/pointer-lock-tag-design.md §2):
 * `exitPointerLock()` is a *synchronous* platform API (it returns `void`, not
 * a `Promise`), so the Core's `exitPointerLock()` command is synchronous too
 * and carries no `_gen` guard of its own — it is wrapped in `try/catch` only
 * as a defensive measure (never-throw), not because it can go stale.
 *
 * Scope note (docs/pointer-lock-tag-design.md §3): `movementX`/`movementY`
 * are intentionally NOT exposed by this Core (v1 scope). They are
 * high-frequency `mousemove` data unsuited to the same-value-guarded
 * declarative `properties` surface; see the design doc for the rationale and
 * the planned `debounce`/`throttle`-based opt-in for a future version.
 */
declare class PointerLockCore extends EventTarget {
    static wcBindable: IWcBindable;
    private _target;
    private _active;
    private _error;
    private _errorInfo;
    private _resolvedTarget;
    private _subscribed;
    private _gen;
    private _ready;
    constructor(target?: EventTarget);
    get ready(): Promise<void>;
    get active(): boolean;
    get error(): any;
    /**
     * The last failure's serializable `WcsIoErrorInfo` (stable `code` / `phase` /
     * `recoverable`), or null. Additive wc-bindable property (event
     * `wcs-pointer-lock:error-info-changed`), derived from `error`; the existing
     * `error` value shape is unchanged.
     */
    get errorInfo(): WcsIoErrorInfo | null;
    observe(target: Element | null): Promise<void>;
    dispose(): void;
    /**
     * Request pointer lock on `element`. Never-throw: a missing API or a
     * rejected promise (e.g. called outside a user-gesture context —
     * `NotAllowedError`, docs/fullscreen-tag-design.md §3) is captured into
     * `error` rather than propagated. `element` may be `null` when the Shell's
     * `target` selector did not resolve (docs/pointer-lock-tag-design.md §1
     * defers error representation to FullscreenCore verbatim — this null-target
     * case mirrors `FullscreenCore.requestFullscreen(null)`,
     * docs/fullscreen-tag-design.md §6): distinct from "API is not supported"
     * below, so a typo'd selector doesn't masquerade as an unsupported platform.
     */
    requestPointerLock(element: Element | null): Promise<void>;
    /**
     * Exit pointer lock. Synchronous platform API (docs/pointer-lock-tag-design.md
     * §2) — returns `void`, not a `Promise`. Silent no-op when nothing is
     * currently locked or the API is unsupported (mirrors
     * `FullscreenCore.exitFullscreen()`'s no-op contract,
     * docs/fullscreen-tag-design.md §7). Wrapped in try/catch defensively: even
     * though the platform API is synchronous and documented as not throwing in
     * this case, a synchronous throw from a non-conformant/fake implementation
     * must never escape (never-throw).
     */
    exitPointerLock(): void;
    private _requestPointerLockFn;
    private _exitPointerLockFn;
    private _pointerLockElement;
    private _pointerLockChangeEventName;
    private _onChange;
    private _applyActive;
    private _setActive;
    private _setError;
    private _commitErrorInfo;
}

/**
 * `<wcs-pointer-lock target="...">` — declarative Pointer Lock API control.
 *
 * Like `<wcs-fullscreen>` (docs/fullscreen-tag-design.md §0), this Shell does
 * not lock itself — it operates on a *referenced* element via the `target`
 * attribute, using the same 3-mode resolution rule as `intersection`
 * (`_resolveTarget()`/`_safeQuery()`, copied verbatim per
 * docs/pointer-lock-tag-design.md §1 / docs/fullscreen-tag-design.md §1):
 *
 * | `target`        | operates on            | display     |
 * |-----------------|-------------------------|-------------|
 * | omitted         | first element child     | `contents`  |
 * | `"#selector"`    | the matched element      | `none`      |
 * | `"self"`         | the element itself       | `block`     |
 *
 * `requestPointerLock()` requires a user-gesture context (docs/fullscreen-tag-design.md
 * §3) — the primary activation path is the command-token protocol
 * (`command.requestPointerLock: $command.<token>` on `<wcs-pointer-lock>`,
 * emitted by a button's `onclick: $command.<token>`), not an
 * autoTrigger attribute (none is provided in v1,
 * docs/pointer-lock-tag-design.md §4).
 *
 * `movementX`/`movementY` are intentionally out of scope for v1
 * (docs/pointer-lock-tag-design.md §3) — do not add them without revisiting
 * the design doc.
 */
declare class WcsPointerLock extends HTMLElement {
    static hasConnectedCallbackPromise: boolean;
    static observedAttributes: string[];
    static wcBindable: IWcBindable;
    private _core;
    private _connectedCallbackPromise;
    private _internals;
    constructor();
    get connectedCallbackPromise(): Promise<void>;
    get debugStates(): string[];
    private _initInternals;
    private _wireStates;
    get target(): string;
    set target(value: string);
    get active(): boolean;
    get error(): any;
    get errorInfo(): WcsIoErrorInfo | null;
    /**
     * Resolve `target` and request pointer lock on it. Requires a user-gesture
     * context. never-throw: an unresolvable target or an unsupported/rejected
     * API call are both surfaced via `error`, never thrown (mirrors
     * `<wcs-fullscreen>`'s `requestFullscreen()`, docs/fullscreen-tag-design.md
     * §3/§6 — the Shell passes the (possibly `null`) resolved element straight
     * through and lets the Core set `error`, rather than silently no-op'ing
     * here).
     */
    requestPointerLock(): Promise<void>;
    /** Exit pointer lock. Synchronous command — silent no-op if nothing is locked. */
    exitPointerLock(): void;
    connectedCallback(): void;
    disconnectedCallback(): void;
    attributeChangedCallback(name: string): void;
    private _applyDisplayAndObserve;
    private _resolveTarget;
    private _safeQuery;
}

/**
 * pointerLockCapabilities.ts
 *
 * Pointer Lock node 固有の error code(taxonomy)と derivation。汎用の error info 型は
 * `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)から
 * import する。pointer-lock は referenced element を操作するモニタ的ノードで競合 operation
 * を持たないため lane は無く、error taxonomy(errorInfo)のみを採用する。
 *
 * `_setError` は合成 `{ message }`(target 未解決 / API 非対応)と caught 例外
 * (`NotAllowedError` / `TypeError` = user gesture 外の requestPointerLock 拒否)を混在
 * 受理する。呼出側が明示 `kind` を渡して合成側を曖昧さ無く分類し、caught は `.name` で
 * 分類する(fullscreen と同じ discriminator 方式)。
 */

/** 安定した pointer-lock error code(taxonomy)。値は公開キーとして固定。 */
declare const WCS_POINTER_LOCK_ERROR_CODE: {
    /** Pointer Lock API 非対応。 */
    readonly CapabilityMissing: "capability-missing";
    /** target selector が要素に解決しない等の入力不備。 */
    readonly InvalidArgument: "invalid-argument";
    /** `NotAllowedError` / `TypeError` — user gesture 外での要求拒否。 */
    readonly NotAllowed: "not-allowed";
    /** その他の caught 例外。 */
    readonly PointerLockError: "pointer-lock-error";
};

export { PointerLockCore, WCS_POINTER_LOCK_ERROR_CODE, WcsPointerLock, bootstrapPointerLock, getConfig };
export type { IWritableConfig, IWritableTagNames, WcsIoErrorInfo, WcsIoErrorPhase, WcsPointerLockCoreValues, WcsPointerLockValues };
