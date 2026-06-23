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
    readonly resize: string;
}
interface IWritableTagNames {
    resize?: string;
}
interface IConfig {
    readonly tagNames: ITagNames;
}
interface IWritableConfig {
    tagNames?: IWritableTagNames;
}

/**
 * Which box-size CSS-side ResizeObserver reports. Mirrors `ResizeObserverBoxOptions`.
 * `device-pixel-content-box` is Chromium-only; the Core falls back to `content-box`
 * if the runtime rejects it (never-throw).
 */
type ResizeBoxOption = "content-box" | "border-box" | "device-pixel-content-box";
/**
 * Plain snapshot of a `DOMRectReadOnly` (`contentRect`). Unlike the live DOM rect,
 * every field is a plain number so it can flow through data binding and serialize.
 */
interface WcsResizeRect {
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
 * Plain snapshot of a `ResizeObserverSize` (one fragment of `contentBoxSize` /
 * `borderBoxSize` / `devicePixelContentBoxSize`). Logical sizes (inline/block),
 * correct under vertical writing modes.
 */
interface WcsResizeBoxSize {
    inlineSize: number;
    blockSize: number;
}
/**
 * Payload carried by the `wcs-resize:change` event — a structured-clone-friendly
 * snapshot of `ResizeObserverEntry`, plus the live `target` Element.
 *
 * `width` / `height` are the headline values derived from the box that the `box`
 * option selected (border-box / device-pixel / content-box), falling back to
 * `contentRect` when the matching boxSize fragment is absent. They are rounded to
 * integers when the `round` option is set.
 *
 * `contentBoxSize` / `borderBoxSize` / `devicePixelContentBoxSize` keep the first
 * fragment only (single-element observers never produce multiple fragments here);
 * `null` when the runtime did not report that box.
 */
interface WcsResizeEntry {
    width: number;
    height: number;
    contentRect: WcsResizeRect;
    contentBoxSize: WcsResizeBoxSize | null;
    borderBoxSize: WcsResizeBoxSize | null;
    devicePixelContentBoxSize: WcsResizeBoxSize | null;
    /** The observed element. Not serializable — kept for consumers needing the node. */
    target: Element;
}
/**
 * Options accepted by `ResizeCore.observe`. `box` mirrors `ResizeObserverOptions`;
 * `round` rounds the headline `width` / `height` to integers to absorb sub-pixel
 * jitter (the nested boxSize fragments stay raw).
 */
interface ResizeOptions {
    box?: ResizeBoxOption;
    round?: boolean;
}
/**
 * Value types for ResizeCore (headless) — the observable state properties.
 * Use with `bind()` from `a wc-bindable binding core` for compile-time type checking.
 *
 * @example
 * ```typescript
 * const core = new ResizeCore();
 * bind(core, (name: keyof WcsResizeCoreValues, value) => { ... });
 * core.observe(document.querySelector("#panel")!);
 * ```
 */
interface WcsResizeCoreValues {
    entry: WcsResizeEntry | null;
    width: number;
    height: number;
    observing: boolean;
}
/**
 * Value types for the Shell (`<wcs-resize>`) — identical observable surface to the
 * Core, plus the DOM-driven `trigger` command-property.
 */
interface WcsResizeValues extends WcsResizeCoreValues {
    trigger: boolean;
}
interface WcsResizeInputs {
    /**
     * What to observe. Omitted → the first element child (the element itself renders
     * as `display:contents`). A selector (`"#panel"`, `".card"`) → the matched
     * element (`display:none`). The literal `"self"` → the element itself, which as a
     * `display:block` zero-height box stretches to the parent's available inline size
     * — a container-width probe.
     */
    target: string;
    /**
     * Which box to report: `content-box` (default), `border-box`,
     * `device-pixel-content-box`. Typed as `string` because the Shell's `box`
     * accessor returns the raw attribute (`""` when unset, and any unrecognized
     * value verbatim); `_parseBox()` falls back to `content-box` at observe time.
     */
    box: string;
    /** Round the headline `width` / `height` to integers (absorbs sub-pixel jitter). */
    round: boolean;
    /** Disconnect after the first size observation (ResizeObserver always fires once on observe). */
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
interface WcsResizeCoreCommands {
    observe(element: Element, options?: ResizeOptions): void;
    unobserve(element: Element): void;
    disconnect(): void;
}
interface WcsResizeCommands {
    /** Re-resolve the target from the DOM and (re)start observing. */
    observe(): void;
    unobserve(): void;
    disconnect(): void;
}

declare function bootstrapResize(userConfig?: IWritableConfig): void;

declare function getConfig(): IConfig;

/**
 * Headless element-size primitive. A thin, framework-agnostic wrapper around the
 * ResizeObserver API exposed through the wc-bindable protocol.
 *
 * Like IntersectionCore, the thing being observed is a *DOM element* — so
 * `observe()` takes the target node. The Core stays DOM-resolution-agnostic: it
 * observes whatever element it is handed (the Shell resolves the `target` selector
 * before calling). It is a read-only producer — element/layout → state only.
 *
 * Every observer callback is published via the single `wcs-resize:change` event;
 * `width` / `height` are read from it through getters (mirroring how
 * IntersectionCore derives `intersecting` / `ratio` from one event), so an observer
 * binding any of them is notified on every change.
 *
 * `width` / `height` follow the observed `box` (border-box / device-pixel /
 * content-box) and are rounded to integers when `round` is set — `round` absorbs
 * the sub-pixel jitter that would otherwise let a size→layout→size loop oscillate.
 *
 * Single-target by design: the Shell observes exactly one element, so the state
 * reflects that element. Multi-target observation is intentionally out of scope.
 */
declare class ResizeCore extends EventTarget {
    static wcBindable: IWcBindable;
    private _target;
    private _observer;
    private _observed;
    private _options;
    private _effectiveBox;
    private _entry;
    private _observing;
    private _ready;
    constructor(target?: EventTarget);
    /** Resolves once the first probe settles. Synchronous here, so already resolved. */
    get ready(): Promise<void>;
    /**
     * Lifecycle entry point (§3.5). When called with no element it is an idempotent
     * no-op that resolves once ready — resize is command-driven (the Shell resolves
     * the target and calls observe(element)), so connect-time monitoring is started
     * via that command, not here. The Shell backs `connectedCallbackPromise` with
     * this no-arg form. When called with an element it delegates to the element
     * observe command below and still returns `ready` for a uniform return shape.
     */
    observe(): Promise<void>;
    observe(element: Element, options?: ResizeOptions): Promise<void>;
    /**
     * Tear down the observer and invalidate the lifecycle (§3.5). Mirrors disconnect()
     * but is the lifecycle-named counterpart the Shell calls from disconnectedCallback;
     * a later observe() rebuilds the observer.
     */
    dispose(): void;
    get entry(): WcsResizeEntry | null;
    get width(): number;
    get height(): number;
    get observing(): boolean;
    private _setEntry;
    private _setObserving;
    /**
     * Start observing `element`. Idempotent while already observing the same element
     * with the same options. Changing the element or options tears down the current
     * observer and builds a new one (re-observing also re-delivers the initial size,
     * which is how a `round` toggle re-fires with the new rounding).
     *
     * If ResizeObserver is unavailable (SSR) this is a silent no-op — `observing`
     * stays false. If the requested `box` is unsupported, it retries once with
     * `content-box` before giving up; both giving-up paths leave `observing` false,
     * consistent with the never-throw design of the other @wcstack sensors.
     */
    private _observeElement;
    /**
     * Stop observing `element`. A no-op if it is not the currently observed element.
     * The observer instance is torn down (single-target Core), so a later observe()
     * rebuilds it.
     */
    unobserve(element: Element): void;
    /** Stop all observation and release the observer. */
    disconnect(): void;
    private _teardownObserver;
    private _createObserver;
    /**
     * Start observing with the requested `box`, retrying once with `content-box` if
     * the runtime rejects the box (e.g. `device-pixel-content-box` on engines that do
     * not support it). Returns the box actually in effect, or `null` if observation
     * could not start at all.
     */
    private _beginObserve;
    private _onResize;
    private _normalizeEntry;
    /**
     * Pick the headline width/height from the boxSize matching the observed `box`,
     * falling back to `contentRect` when that fragment is absent (older engines only
     * fill contentRect). `inlineSize`/`blockSize` map to width/height (correct for
     * horizontal writing modes). Rounds to integers when `round` is set.
     */
    private _headlineSize;
    private _firstBoxSize;
    private _normalizeRect;
    private _optionsEqual;
}

/**
 * `<wcs-resize>` — declarative ResizeObserver.
 *
 * The `target` attribute is the single knob that decides both *what* is observed
 * and how the element renders (it never injects a layout box unless asked):
 *
 * | `target`        | observes              | display     | use case             |
 * |-----------------|-----------------------|-------------|----------------------|
 * | omitted         | first element child   | `contents`  | size a wrapped child |
 * | `"#panel"` / sel| the matched element   | `none`      | size an existing node|
 * | `"self"`        | the element itself    | `block`     | container-width probe|
 *
 * `display:contents` means wrapping a child injects no box of its own (so a
 * `<wcs-resize><div></wcs-resize>` does not disturb a flex/grid parent); the
 * `target="self"` form takes a `display:block` box that, as a zero-height element,
 * stretches to the parent's available inline size — a container-width probe.
 *
 * Note: a `display:contents` / `display:none` element generates no box, so the
 * observed node must be the child / selector target (which do have boxes), never
 * the `<wcs-resize>` host itself except in the `self` form.
 */
declare class WcsResize extends HTMLElement {
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
    get box(): string;
    set box(value: string);
    get round(): boolean;
    set round(value: boolean);
    get once(): boolean;
    set once(value: boolean);
    get manual(): boolean;
    set manual(value: boolean);
    get entry(): WcsResizeEntry | null;
    get width(): number;
    get height(): number;
    get observing(): boolean;
    get trigger(): boolean;
    set trigger(value: boolean);
    /** Re-resolve the target from the DOM and (re)start observing. */
    observe(): void;
    unobserve(): void;
    disconnect(): void;
    private _resolveTarget;
    private _safeQuery;
    private _parseBox;
    private _options;
    private _onChange;
    connectedCallback(): void;
    disconnectedCallback(): void;
    attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null): void;
}

export { ResizeCore, WcsResize, bootstrapResize, getConfig };
export type { IWritableConfig, IWritableTagNames, ResizeBoxOption, ResizeOptions, WcsResizeBoxSize, WcsResizeCommands, WcsResizeCoreCommands, WcsResizeCoreValues, WcsResizeEntry, WcsResizeInputs, WcsResizeRect, WcsResizeValues };
