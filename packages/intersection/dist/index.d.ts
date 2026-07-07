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
    readonly intersect: string;
}
interface IWritableTagNames {
    intersect?: string;
}
interface IConfig {
    readonly tagNames: ITagNames;
}
interface IWritableConfig {
    tagNames?: IWritableTagNames;
}

/**
 * Plain snapshot of a `DOMRectReadOnly` (e.g. `boundingClientRect`,
 * `intersectionRect`, `rootBounds`). Unlike the live DOM rect, every field is a
 * plain number so it can flow through data binding and be serialized.
 */
interface WcsIntersectRect {
    x: number;
    y: number;
    width: number;
    height: number;
    top: number;
    right: number;
    bottom: number;
    left: number;
}
/**
 * Payload carried by the `wcs-intersect:change` event — a structured-clone-friendly
 * snapshot of `IntersectionObserverEntry`, plus the live `target` Element for
 * consumers that need the actual node.
 *
 * `boundingClientRect` / `intersectionRect` are always present; `rootBounds` is
 * `null` when the root is a cross-origin document (mirroring the native API).
 */
interface WcsIntersectEntry {
    isIntersecting: boolean;
    intersectionRatio: number;
    time: number;
    boundingClientRect: WcsIntersectRect;
    intersectionRect: WcsIntersectRect;
    rootBounds: WcsIntersectRect | null;
    /** The observed element. Not serializable — kept for consumers needing the node. */
    target: Element;
}
/**
 * Options accepted by `IntersectionCore.observe`, mirroring
 * `IntersectionObserverInit`. `root` is an already-resolved Element (the Shell
 * resolves a selector to a node before calling), or `null` for the viewport.
 */
interface IntersectOptions {
    root?: Element | null;
    rootMargin?: string;
    threshold?: number | number[];
}
/**
 * Value types for IntersectionCore (headless) — the observable state properties.
 * Use with `bind()` from `a wc-bindable binding core` for compile-time type checking.
 *
 * @example
 * ```typescript
 * const core = new IntersectionCore();
 * bind(core, (name: keyof WcsIntersectCoreValues, value) => { ... });
 * core.observe(document.querySelector("#hero")!);
 * ```
 */
interface WcsIntersectCoreValues {
    entry: WcsIntersectEntry | null;
    intersecting: boolean;
    ratio: number;
    visible: boolean;
    observing: boolean;
}
/**
 * Value types for the Shell (`<wcs-intersect>`) — identical observable surface to
 * the Core, plus the DOM-driven `trigger` command-property.
 */
interface WcsIntersectValues extends WcsIntersectCoreValues {
    trigger: boolean;
}
interface WcsIntersectInputs {
    /**
     * What to observe. Omitted → the first element child (the element itself
     * renders as `display:contents`). A selector (`"#hero"`, `".section"`) → the
     * matched element (`display:none`). The literal `"self"` → the element itself
     * as a zero-height marker (`display:block`).
     */
    target: string;
    /** Selector for the scroll root. Omitted → the viewport. */
    root: string;
    rootMargin: string;
    /** A single ratio or a comma list (`"0,0.5,1"`) of 0..1 thresholds. */
    threshold: string;
    /** Disconnect after the first time the target becomes intersecting. */
    once: boolean;
    /** Do not auto-observe on connect; observe is driven manually instead. */
    manual: boolean;
    /**
     * Momentary command-property (no mirrored attribute): a `false`→`true` write
     * re-runs `observe()`, then the flag immediately resets to `false`. Unlike the
     * other inputs it does not reflect to an HTML attribute.
     */
    trigger: boolean;
}
interface WcsIntersectCoreCommands {
    observe(element: Element, options?: IntersectOptions): Promise<void>;
    /** Force a fresh observation even when target+options are unchanged (rebuilds the observer). */
    reobserve(element: Element, options?: IntersectOptions): void;
    unobserve(element: Element): void;
    disconnect(): void;
    /** Clear the `visible` latch so it can be set again by a later intersection. */
    reset(): void;
}
interface WcsIntersectCommands {
    /** Re-resolve the target/root from the DOM and (re)start observing. */
    observe(): void;
    /** Re-resolve the target/root and force a fresh observation (rebuilds the observer). */
    reobserve(): void;
    unobserve(): void;
    disconnect(): void;
    reset(): void;
}

declare function bootstrapIntersection(userConfig?: IWritableConfig): void;

declare function getConfig(): IConfig;

/**
 * Headless visibility primitive. A thin, framework-agnostic wrapper around the
 * IntersectionObserver API exposed through the wc-bindable protocol.
 *
 * Unlike the other @wcstack sensors (geolocation / timer / websocket), the thing
 * being observed is a *DOM element* — so `observe()` takes the target node. The
 * Core stays DOM-resolution-agnostic: it observes whatever element it is handed
 * (the Shell resolves `target` / `root` selectors before calling). It is a
 * read-only producer — element/layout → state only, with no element-bound path.
 *
 * Every observer callback is published via the single `wcs-intersect:change`
 * event; `intersecting` / `ratio` are read from it through getters (mirroring how
 * GeolocationCore exposes latitude/longitude from one `wcs-geo:position` event),
 * so an observer that binds any of them is notified on every change.
 *
 * `visible` is a latch: it flips to `true` the first time the target intersects
 * and stays `true` until `reset()` — ideal for one-way lazy-load bindings
 * (`src@visible`). `observing` reflects whether an observation is currently
 * active (like TimerCore's `running`).
 *
 * Single-target by design: the Shell observes exactly one element, so the state
 * reflects that element. Multi-target observation is intentionally out of scope.
 */
declare class IntersectionCore extends EventTarget {
    static wcBindable: IWcBindable;
    private _target;
    private _observer;
    private _observed;
    private _options;
    private _entry;
    private _visible;
    private _observing;
    private _gen;
    private _ready;
    constructor(target?: EventTarget);
    /** Resolves immediately — there is no asynchronous probe to await (§3.8). */
    get ready(): Promise<void>;
    get entry(): WcsIntersectEntry | null;
    get intersecting(): boolean;
    get ratio(): number;
    get visible(): boolean;
    get observing(): boolean;
    private _setEntry;
    private _setVisible;
    private _setObserving;
    /**
     * Start observing `element`. Idempotent while already observing the same
     * element with the same options. Changing the element or options tears down the
     * current observer and builds a new one (IntersectionObserver options are fixed
     * at construction, so reconfiguring requires a fresh observer).
     *
     * If IntersectionObserver is unavailable (SSR) or the options are invalid (e.g.
     * a malformed `rootMargin`, which the constructor rejects), this is a silent
     * no-op — `observing` stays false, consistent with the never-throw design of
     * the other @wcstack sensors.
     */
    observe(element: Element, options?: IntersectOptions): Promise<void>;
    /**
     * Force a fresh observation of `element`, even when it matches the currently
     * observed target+options. Unlike observe() — which is idempotent and
     * early-returns for an unchanged target+options *without* re-delivering a
     * callback — this always tears the observer down and rebuilds it, so a new
     * IntersectionObserver delivers an initial callback for the element's CURRENT
     * visibility.
     *
     * This is the way to re-arm an edge-driven consumer (e.g. infinite scroll) after
     * the layout changed without a visibility *transition*: IntersectionObserver only
     * fires on a change, so appending a short page that leaves the sentinel visible
     * yields no new callback — a bare observe() can't help (idempotent), but a
     * reobserve() re-reads the current state. Same never-throw guarantees as
     * observe(); `observing` stays true across a successful re-arm (no false blip).
     */
    reobserve(element: Element, options?: IntersectOptions): void;
    /**
     * Stop observing `element`. A no-op if it is not the currently observed
     * element. The observer instance is torn down (single-target Core), so a later
     * observe() rebuilds it.
     */
    unobserve(element: Element): void;
    /** Stop all observation and release the observer. */
    disconnect(): void;
    /** Clear the `visible` latch so a later intersection can set it again. */
    reset(): void;
    /**
     * `observe()` (the IntersectionObserver-style command above) establishes
     * monitoring, so there is no separate idempotent monitoring entry point — only
     * teardown. `dispose()` invalidates any in-flight observer callback (`_gen++`)
     * and releases the observer. A later observe() revives it (the Shell calls this
     * from `disconnectedCallback`).
     */
    dispose(): void;
    private _teardownObserver;
    private _createObserver;
    private _onIntersect;
    private _normalizeEntry;
    private _normalizeRect;
    private _optionsEqual;
    private _thresholdKey;
}

/**
 * `<wcs-intersect>` — declarative IntersectionObserver.
 *
 * The `target` attribute is the single knob that decides both *what* is observed
 * and how the element renders (it never injects a layout box unless asked):
 *
 * | `target`        | observes              | display     | use case          |
 * |-----------------|-----------------------|-------------|-------------------|
 * | omitted         | first element child   | `contents`  | lazy-load wrapper |
 * | `"#hero"` / sel | the matched element   | `none`      | scrollspy (single)|
 * | `"self"`        | the element itself    | `block`     | infinite-scroll   |
 *
 * `display:contents` means wrapping a child injects no box of its own (so a
 * `<wcs-intersect><img></wcs-intersect>` does not disturb a flex/grid parent);
 * only the explicit `target="self"` sentinel takes a box.
 */
declare class WcsIntersect extends HTMLElement {
    static hasConnectedCallbackPromise: boolean;
    static observedAttributes: string[];
    static wcBindable: IWcBindable;
    private _core;
    private _trigger;
    private _connectedCallbackPromise;
    constructor();
    get connectedCallbackPromise(): Promise<void>;
    get target(): string;
    set target(value: string);
    get root(): string;
    set root(value: string);
    get rootMargin(): string;
    set rootMargin(value: string);
    get threshold(): string;
    set threshold(value: string);
    get once(): boolean;
    set once(value: boolean);
    get manual(): boolean;
    set manual(value: boolean);
    get entry(): WcsIntersectEntry | null;
    get intersecting(): boolean;
    get ratio(): number;
    get visible(): boolean;
    get observing(): boolean;
    get trigger(): boolean;
    set trigger(value: boolean);
    /** Re-resolve the target/root from the DOM and (re)start observing. */
    observe(): void;
    /**
     * Force a fresh observation: re-resolve target/root from the DOM and re-observe
     * even when nothing changed. Unlike observe() (idempotent for an unchanged
     * target+options), this rebuilds the observer so a new initial callback fires for
     * the current visibility — the way to re-arm an edge-driven consumer after the
     * layout shifted without a visibility transition (e.g. infinite scroll appended a
     * short page that left this sentinel in view). Resolution/teardown rules match
     * observe(): an unresolvable target tears down any stale observation.
     */
    reobserve(): void;
    unobserve(): void;
    disconnect(): void;
    reset(): void;
    private _resolveTarget;
    private _resolveRoot;
    private _safeQuery;
    private _parseThreshold;
    private _options;
    private _onChange;
    connectedCallback(): void;
    disconnectedCallback(): void;
    attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null): void;
}

export { IntersectionCore, WcsIntersect, bootstrapIntersection, getConfig };
export type { IWritableConfig, IWritableTagNames, IntersectOptions, WcsIntersectCommands, WcsIntersectCoreCommands, WcsIntersectCoreValues, WcsIntersectEntry, WcsIntersectInputs, WcsIntersectRect, WcsIntersectValues };
