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
    readonly pip: string;
}
interface IWritableTagNames {
    pip?: string;
}
interface IConfig {
    readonly tagNames: ITagNames;
}
interface IWritableConfig {
    tagNames?: IWritableTagNames;
}

/**
 * Value types for PipCore (headless) — the Core's readable value surface.
 * `active`, `error`, and `errorInfo` are all *observable* (declared in
 * `wcBindable.properties` with change events: `wcs-pip:change` / `:error` /
 * `:error-info-changed`), so a wc-bindable binding core delivers a request/exit
 * failure. `errorInfo` is the additive serializable failure taxonomy derived
 * from `error` (README "Output state").
 *
 * @example
 * ```typescript
 * const core = new PipCore();
 * bind(core, (name: keyof WcsPipCoreValues, value) => { ... });
 * ```
 */
interface WcsPipCoreValues {
    active: boolean;
    error: any;
    /** Additive failure taxonomy derived from `error` (stable code / phase / recoverable). */
    errorInfo: WcsIoErrorInfo | null;
}
/**
 * Value types for the Shell (`<wcs-pip>`) — identical value surface to the
 * Core (`active` / `error` / `errorInfo` all observable). The Shell adds the
 * `target` input (attribute-mirrored) and no additional observable
 * properties.
 */
type WcsPipValues = WcsPipCoreValues;

declare function bootstrapPip(userConfig?: IWritableConfig): void;

declare function getConfig(): IConfig;

/**
 * Headless Picture-in-Picture primitive. A thin, framework-agnostic wrapper
 * around the classic Picture-in-Picture API
 * (`HTMLVideoElement.requestPictureInPicture()` / `document.exitPictureInPicture()` /
 * `document.pictureInPictureElement`) exposed through the wc-bindable protocol.
 *
 * This Core follows the same basic pattern as `@wcstack/fullscreen`'s
 * `FullscreenCore` (docs/fullscreen-tag-design.md): target resolution is done
 * by the Shell (this Core receives the resolved element at call time), API
 * resolution is call-time/non-cached, `_gen` is a single Core-level generation
 * guard, and `error` is a simple single field (no permission-style 4-value
 * state). See docs/picture-in-picture-tag-design.md for the differences from
 * Fullscreen:
 *
 * - **§2 target constraint**: the resolved target MUST be a `<video>` element.
 *   Picture-in-Picture is only defined as an instance method of
 *   `HTMLVideoElement` — unlike Fullscreen, which any `Element` supports. A
 *   non-`<video>` target is a never-throw failure: it is treated the same as
 *   an unresolved target and reported via `error`.
 * - **§3 event subscription target**: `enterpictureinpicture` /
 *   `leavepictureinpicture` fire on the `<video>` element itself, not on
 *   `document` (the reverse of Fullscreen's `document`-level
 *   `fullscreenchange`). The Core attaches/detaches these listeners directly
 *   on the resolved `<video>` element, re-wiring them whenever the target is
 *   re-resolved (e.g. the Shell's `target` attribute changes).
 */
declare class PipCore extends EventTarget {
    static wcBindable: IWcBindable;
    private _target;
    private _active;
    private _error;
    private _errorInfo;
    private _video;
    private _gen;
    private _ready;
    constructor(target?: EventTarget);
    get ready(): Promise<void>;
    get active(): boolean;
    get error(): any;
    /**
     * The last failure's serializable `WcsIoErrorInfo` (stable `code` / `phase` /
     * `recoverable`), or null. Additive wc-bindable property (event
     * `wcs-pip:error-info-changed`), derived from `error`; the existing `error`
     * value shape is unchanged.
     */
    get errorInfo(): WcsIoErrorInfo | null;
    /**
     * (Re-)subscribe to `enterpictureinpicture`/`leavepictureinpicture` on
     * `element` (the Shell's resolved `<video>` target). Idempotent when called
     * again with the same element; re-wires the listeners when the element
     * changes (e.g. the `target` attribute was changed), detaching from the
     * previous element first so no stale listener lingers.
     */
    observe(element: HTMLVideoElement | null): Promise<void>;
    dispose(): void;
    /**
     * Request Picture-in-Picture for `element`. `element` must be a `<video>`
     * (checked before the gesture-context failure path, since a type mismatch is
     * an environment-independent, permanent error — docs/picture-in-picture-tag-design.md §2).
     * Never throws: all failures (wrong tag, unsupported API, gesture-context
     * rejection) are funneled into `error` and the returned promise resolves.
     */
    requestPictureInPicture(element: HTMLVideoElement | null): Promise<void>;
    /**
     * Exit Picture-in-Picture. Mirrors FullscreenCore.exitFullscreen(): a
     * silent no-op (resolve, no error) when nothing is currently in
     * Picture-in-Picture — see fullscreen-tag-design.md §7.
     */
    exitPictureInPicture(): Promise<void>;
    private _requestPictureInPictureFn;
    private _exitPictureInPictureFn;
    private _pictureInPictureElement;
    private _onEnter;
    private _onLeave;
    private _syncActive;
    private _detach;
    private _setActive;
    private _setError;
    private _commitErrorInfo;
}

/**
 * `<wcs-pip target="...">` — declarative Picture-in-Picture control.
 *
 * Like `<wcs-fullscreen>` (docs/fullscreen-tag-design.md §0/§1), this Shell
 * does not operate on itself: it is a non-visible control tag that resolves a
 * `target` element and invokes Picture-in-Picture commands against it. The
 * `target` attribute resolves in the same 3 modes as `intersection`/`fullscreen`
 * (`self` / a selector / the first element child), reused verbatim from
 * `@wcstack/intersection`'s `_resolveTarget()`/`_safeQuery()`
 * (packages/intersection/src/components/Intersect.ts).
 *
 * Picture-in-Picture-specific difference (docs/picture-in-picture-tag-design.md
 * §2): the resolved target must be a `<video>` element. This Shell resolves the
 * DOM element and hands it to the Core; the Core performs the `tagName ===
 * "VIDEO"` validation (never-throw — a mismatch is treated as an unresolved
 * target and reported via `error`, not thrown).
 */
declare class WcsPip extends HTMLElement {
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
    requestPictureInPicture(): Promise<void>;
    exitPictureInPicture(): Promise<void>;
    /**
     * `_resolveTarget()`/`_safeQuery()` copied verbatim from `@wcstack/intersection`
     * (packages/intersection/src/components/Intersect.ts:243-267, 281-287) per the
     * fullscreen/picture-in-picture batch's shared target-resolution archetype
     * (docs/fullscreen-tag-design.md §1).
     */
    private _resolveTarget;
    private _safeQuery;
    /**
     * Layers the Picture-in-Picture-specific `tagName === "VIDEO"` check on top
     * of `_resolveTarget()` (docs/picture-in-picture-tag-design.md §2). A
     * resolved-but-wrong-tag element is treated as unresolved (`element: null`)
     * so it flows into the same "target not found" failure path as Fullscreen's
     * missing-target case — never-throw, no exception escapes.
     */
    private _resolveVideoTarget;
    private _observe;
    connectedCallback(): void;
    disconnectedCallback(): void;
    attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null): void;
}

/**
 * pictureInPictureCapabilities.ts
 *
 * Picture-in-Picture node 固有の error code(taxonomy)と derivation。汎用の error
 * info 型は `./platformCapability.js`(/io-core/ から copy-distribution される生成
 * ファイル)から import する。Picture-in-Picture は referenced `<video>` を操作する
 * ノードで競合 operation を持たないため lane は無く、error taxonomy(errorInfo)のみを
 * 採用する(fullscreen と同型)。
 *
 * `_setError` は合成 `{ message }`(target が `<video>` に解決しない / API 非対応)と
 * caught 例外(`NotAllowedError` = user gesture 外の requestPictureInPicture 拒否等)を
 * 混在受理する。呼出側が明示 `kind` を渡して合成側を曖昧さ無く分類し、caught は `.name`
 * で分類する(fullscreen / storage / screen-orientation と同じ discriminator 方式)。
 */

/** 安定した Picture-in-Picture error code(taxonomy)。値は公開キーとして固定。 */
declare const WCS_PICTURE_IN_PICTURE_ERROR_CODE: {
    /** Picture-in-Picture API 非対応。 */
    readonly CapabilityMissing: "capability-missing";
    /** target が `<video>` に解決しない等の入力不備。 */
    readonly InvalidArgument: "invalid-argument";
    /** `NotAllowedError` / `TypeError` — user gesture 外での要求拒否。 */
    readonly NotAllowed: "not-allowed";
    /** その他の caught 例外。 */
    readonly PipError: "pip-error";
};

export { PipCore, WCS_PICTURE_IN_PICTURE_ERROR_CODE, WcsPip, bootstrapPip, getConfig };
export type { IWritableConfig, IWritableTagNames, WcsIoErrorInfo, WcsIoErrorPhase, WcsPipCoreValues, WcsPipValues };
