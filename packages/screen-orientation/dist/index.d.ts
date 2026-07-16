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
 * properties (`type`/`angle`) plus the derived `portrait`/`landscape`
 * booleans and the `error` surface (the last `lock()`/`unlock()` failure, or
 * `null`). Use with `bind()` from a wc-bindable binding core for
 * compile-time type checking.
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
    /** Additive failure taxonomy derived from `error` (stable code / phase / recoverable). */
    errorInfo: WcsIoErrorInfo | null;
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
    private _errorInfo;
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
    /**
     * The last failure's serializable `WcsIoErrorInfo` (stable `code` / `phase` /
     * `recoverable`), or null. Additive wc-bindable property (event
     * `wcs-orientation:error-info-changed`), derived from `error`; the existing
     * `error` property/event are unchanged.
     */
    get errorInfo(): WcsIoErrorInfo | null;
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
    private _errorInfoMessage;
    private _commitErrorInfo;
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
    private _internals;
    constructor();
    get debugStates(): string[];
    private _initInternals;
    private _wireStates;
    get type(): WcsScreenOrientationSnapshot["type"];
    get angle(): number | null;
    get portrait(): boolean;
    get landscape(): boolean;
    get error(): any;
    get errorInfo(): WcsIoErrorInfo | null;
    get connectedCallbackPromise(): Promise<void>;
    lock(orientation: OrientationLockType): Promise<void>;
    unlock(): void;
    connectedCallback(): void;
    disconnectedCallback(): void;
}

/**
 * screenOrientationCapabilities.ts
 *
 * Screen Orientation node 固有の error code(taxonomy)と derivation。汎用の error info
 * 型は `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)から
 * import する。screen.orientation の監視(change 購読)は同期で競合する operation を持た
 * ないため lane は持たず、error taxonomy(errorInfo)のみを採用する。
 *
 * この node は bidirectional で、失敗は `lock()`/`unlock()` から来る。`_setError` は
 * 2 形態の入力を受ける:
 *   1. synthetic な `UNSUPPORTED_ERROR`(`{ message: "unsupported" }`、`.name` 無し)
 *      — API / メソッド自体が不在。
 *   2. caught された生の rejection / 例外(`.name` を持つ)。
 * 両者を message coupling 無しに弁別するため、呼び出し側が明示的な `name` ヒントを渡す
 * (storage の `deriveStorageErrorInfo(error, name)` と同じ discriminator 技法)。
 * unsupported 経路は `"unsupported"` を、caught 経路は `Error.name` を渡す。
 *
 * lock() の実 rejection 名は README.md §"lock() needs a fullscreen…" と Core JSDoc §5 の
 * とおり `NotAllowedError` / `NotSupportedError` / `SecurityError`(いずれも plain-tab で
 * lock が効かない同一の実務的結末=「name で分岐するな」)+ spec の `AbortError`(新しい
 * lock() に取って代わられた)。前者 3 名は同一 `not-allowed` に畳む(README のモデルに一致)。
 */

/** 安定した screen-orientation error code(taxonomy)。値は公開キーとして固定。 */
declare const WCS_SCREEN_ORIENTATION_ERROR_CODE: {
    /** `screen.orientation` / `lock()`・`unlock()` 自体が不在(synthetic "unsupported")。 */
    readonly CapabilityMissing: "capability-missing";
    /**
     * `NotAllowedError` / `NotSupportedError` / `SecurityError` — 非 fullscreen /
     * plain-tab / feature-policy / sandbox で lock が効かない。README のモデルどおり
     * 三者は同一の実務的結末なので 1 code に畳む。retry では回復しない。
     */
    readonly NotAllowed: "not-allowed";
    /** `AbortError` — より新しい `lock()` に取って代わられた。fresh lock は成功しうる。 */
    readonly Aborted: "aborted";
    /** その他の `lock()`/`unlock()` 失敗。 */
    readonly OrientationError: "orientation-error";
};

export { ScreenOrientationCore, WCS_SCREEN_ORIENTATION_ERROR_CODE, WcsScreenOrientation, bootstrapScreenOrientation, getConfig };
export type { IWritableConfig, IWritableTagNames, OrientationLockType, WcsIoErrorInfo, WcsIoErrorPhase, WcsScreenOrientationCoreValues, WcsScreenOrientationSnapshot, WcsScreenOrientationValues };
