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
 * surface. Note that only `active` is *observable* (declared in
 * `wcBindable.properties` with a change event); `error` is an
 * imperative-read-only getter with no event of its own — a wc-bindable
 * binding core will never deliver it, so read it after a command settles
 * (docs/fullscreen-tag-design.md §8, README "Notes & limitations").
 *
 * @example
 * ```typescript
 * const core = new FullscreenCore();
 * // bind() only ever delivers "active" — see the note above about "error".
 * bind(core, (name: keyof WcsFullscreenCoreValues, value) => { ... });
 * ```
 */
interface WcsFullscreenCoreValues {
    active: boolean;
    error: any;
}
/**
 * Value types for the Shell (`<wcs-fullscreen target="...">`) — identical
 * value surface to the Core (same caveat: only `active` is observable).
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
    private _resolvedTarget;
    private _gen;
    private _subscribed;
    private _ready;
    constructor(target?: EventTarget);
    get ready(): Promise<void>;
    get active(): boolean;
    get error(): any;
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
    constructor();
    get connectedCallbackPromise(): Promise<void>;
    get target(): string;
    set target(value: string);
    get active(): boolean;
    get error(): any;
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

export { FullscreenCore, WcsFullscreen, bootstrapFullscreen, getConfig };
export type { IWritableConfig, IWritableTagNames, WcsFullscreenCoreValues, WcsFullscreenValues };
