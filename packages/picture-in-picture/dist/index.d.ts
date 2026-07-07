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
 * Note that only `active` is *observable* (declared in
 * `wcBindable.properties` with a change event); `error` is an
 * imperative-read-only getter with no event of its own — a wc-bindable
 * binding core will never deliver it, so read it after a command settles
 * (docs/picture-in-picture-tag-design.md, README "Notes & limitations").
 *
 * @example
 * ```typescript
 * const core = new PipCore();
 * // bind() only ever delivers "active" — see the note above about "error".
 * bind(core, (name: keyof WcsPipCoreValues, value) => { ... });
 * ```
 */
interface WcsPipCoreValues {
    active: boolean;
    error: any;
}
/**
 * Value types for the Shell (`<wcs-pip>`) — identical value surface to the
 * Core (same caveat: only `active` is observable). The Shell adds the
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
    private _video;
    private _gen;
    private _ready;
    constructor(target?: EventTarget);
    get ready(): Promise<void>;
    get active(): boolean;
    get error(): any;
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
    constructor();
    get connectedCallbackPromise(): Promise<void>;
    get target(): string;
    set target(value: string);
    get active(): boolean;
    get error(): any;
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

export { PipCore, WcsPip, bootstrapPip, getConfig };
export type { IWritableConfig, IWritableTagNames, WcsPipCoreValues, WcsPipValues };
