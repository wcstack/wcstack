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
 * Value types for PointerLockCore (headless) — the observable state properties.
 * Use with `bind()` from a wc-bindable binding core for compile-time type checking.
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
}
/**
 * Value types for the Shell (`<wcs-pointer-lock>`) — identical observable
 * surface to the Core. The Shell additionally accepts a `target` attribute
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
    private _resolvedTarget;
    private _subscribed;
    private _gen;
    private _ready;
    constructor(target?: EventTarget);
    get ready(): Promise<void>;
    get active(): boolean;
    get error(): any;
    observe(target: Element | null): Promise<void>;
    dispose(): void;
    /**
     * Request pointer lock on `element`. Never-throw: a missing API or a
     * rejected promise (e.g. called outside a user-gesture context —
     * `NotAllowedError`, docs/fullscreen-tag-design.md §3) is captured into
     * `error` rather than propagated.
     */
    requestPointerLock(element: Element): Promise<void>;
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
 * (`command.click:$command.requestPointerLock` on a button), not an
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
    constructor();
    get connectedCallbackPromise(): Promise<void>;
    get target(): string;
    set target(value: string);
    get active(): boolean;
    get error(): any;
    /** Request pointer lock on the resolved target. Requires a user-gesture context. */
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

export { PointerLockCore, WcsPointerLock, bootstrapPointerLock, getConfig };
export type { IWritableConfig, IWritableTagNames, WcsPointerLockCoreValues, WcsPointerLockValues };
