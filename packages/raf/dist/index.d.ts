/**
 * Observation semantics of a `properties` entry.
 *
 *   "state"  — current value. A snapshot may cache it, and equality-based dedupe is safe.
 *   "event"  — occurrence. Repeated identical payloads are distinct occurrences; never dedupe.
 *   "handle" — live / opaque resource with its own lifecycle (e.g. MediaStream). Not
 *              snapshot-safe and not necessarily serializable; consumers need an explicit
 *              ref / callback surface rather than a value slot.
 */
type WcBindableSemantics = "state" | "event" | "handle";
interface IWcBindableProperty {
    readonly name: string;
    readonly event: string;
    readonly getter?: (event: Event) => any;
    /**
     * Optional, additive, forward-compatible. An absent value means **unspecified**, NOT
     * "state": a reader that finds no `semantics` MUST keep the behavior it had before this
     * field existed (deliver the update as-is; do not start deduping, caching or serializing
     * on assumption). Only an explicit value licenses a reader to change its handling.
     */
    readonly semantics?: WcBindableSemantics;
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
    readonly raf: string;
}
interface IWritableTagNames {
    raf?: string;
}
interface IConfig {
    readonly autoTrigger: boolean;
    readonly triggerAttribute: string;
    readonly tagNames: ITagNames;
}
interface IWritableConfig {
    autoTrigger?: boolean;
    triggerAttribute?: string;
    tagNames?: IWritableTagNames;
}

/**
 * Payload carried by the `wcs-raf:tick` event.
 * `count` is the number of frames fired since the last reset; `elapsed` is the
 * accumulated ACTIVE milliseconds (Σdt — interruptions contribute nothing);
 * `dt` is the delta to the previous frame within a continuous run, `0` on the
 * first frame after start / resume / a visibility interruption; `timestamp` is
 * the frame's `DOMHighResTimeStamp` (`0` for the reset() notification, which
 * is not a frame).
 */
interface WcsRafTickDetail {
    count: number;
    elapsed: number;
    dt: number;
    timestamp: number;
}
/**
 * Value types for RafCore (headless) — the observable state properties.
 * Use with `bind()` from a wc-bindable binding core for compile-time type checking.
 */
interface WcsRafCoreValues {
    tick: number;
    elapsed: number;
    dt: number;
    running: boolean;
    suspended: boolean;
}
/**
 * Value types for the Shell (`<wcs-raf>`) — identical observable surface to
 * the Core, plus the DOM-driven `trigger` command-property.
 */
interface WcsRafValues extends WcsRafCoreValues {
    trigger: boolean;
}
interface WcsRafInputs {
    once: boolean;
    repeat: number;
    manual: boolean;
    /** "pause" でだけ prefers-reduced-motion ゲートが効く。未知値は "run" 扱い */
    reducedMotion: string;
    trigger: boolean;
}
interface WcsRafCoreCommands {
    start(options?: {
        repeat?: number;
    }): void;
    stop(): void;
    reset(): void;
    pause(): void;
    resume(): void;
}
interface WcsRafCommands {
    start(): void;
    stop(): void;
    reset(): void;
    pause(): void;
    resume(): void;
}

declare function bootstrapRaf(userConfig?: IWritableConfig, registry?: CustomElementRegistry): void;

declare function getConfig(): IConfig;

interface RafStartOptions {
    repeat?: number;
}
/**
 * Injectable frame scheduler. The default resolves
 * `globalThis.requestAnimationFrame` / `cancelAnimationFrame` AT CALL TIME
 * (async-io-node-guidelines §3.7); tests inject a fake that pumps frames with
 * explicit timestamps (the `dt` contract is timestamp-derived, so tests must
 * control the clock, not just the callback order).
 *
 * Contract: `request()` MUST return a non-null handle. The core uses `null`
 * as its internal "not armed" sentinel, so a scheduler returning literal
 * `null` would silently corrupt the handle bookkeeping (re-entrancy guards
 * and cancel tracking). Native rAF returns a long, so this only concerns
 * custom scheduler injections — return a number, object, or any other
 * non-nullish token.
 */
interface RafScheduler {
    request(callback: (timestamp: number) => void): unknown;
    cancel(handle: unknown): void;
}
/**
 * Injectable matchMedia pair for the `prefers-reduced-motion` gate. The
 * default resolves `globalThis.matchMedia` at call time; tests inject a fake
 * whose `matches` and `change` dispatch they control directly (happy-dom's
 * MQL change delivery is not reliable enough to drive the gate transitions
 * a 100/97 coverage target needs).
 */
interface RafMediaQuery {
    readonly matches: boolean;
    addEventListener(type: "change", listener: () => void): void;
    removeEventListener(type: "change", listener: () => void): void;
}
type RafMatchMedia = (query: string) => RafMediaQuery;
/**
 * Headless requestAnimationFrame primitive — `TimerCore`'s sibling with the
 * time source swapped from `setInterval` (a period) to rAF (the browser's
 * rendering opportunity). Exposed through the wc-bindable protocol: it streams
 * `tick` (frame counter), `elapsed` (accumulated ACTIVE milliseconds), `dt`
 * (delta to the previous frame) and the `running` / `suspended` pair, and is
 * driven by the `start` / `stop` / `reset` / `pause` / `resume` commands.
 *
 * `tick` / `elapsed` / `dt` are all surfaced via the single `wcs-raf:tick`
 * event (read through getters, mirroring how FetchCore exposes value/status
 * from one `wcs-fetch:response` event).
 *
 * Contracts specific to this node (docs/raf-tag-design.md):
 *
 * - **dt describes continuous running only.** The first frame after `start()`,
 *   `resume()`, or a visibility interruption reports `dt = 0` — a value that
 *   spans an interruption never reaches observers. Like `suspended`, the
 *   visibility boundary is only detected once observe() has subscribed to
 *   `visibilitychange`; a headless setup that skips observe() will see the
 *   raw spanning delta on the first frame after a hidden gap. There is
 *   deliberately NO upper clamp: how to treat a slow frame is the consumer's
 *   domain decision.
 * - **elapsed is Σdt (active time).** Because interruption-spanning deltas are
 *   normalized to 0, summing dt yields exactly the time frames were actually
 *   being delivered — no separate segment bookkeeping is needed, and hidden /
 *   paused periods contribute nothing. Granularity is one frame: between
 *   frames the getter returns the value as of the last tick.
 * - **running / suspended are a desired/actual pair** (the wakelock split): in
 *   a hidden tab the browser delivers no frames at all, so `running` (the
 *   started intent) stays true while `suspended` reports that delivery is
 *   actually stopped. `suspended` is only meaningful after `observe()` has
 *   subscribed to `visibilitychange`; without a document it stays false.
 * - **`suspended` has two causes**: `running && (hidden || reducedGate)`.
 *   The second cause is the opt-in `prefers-reduced-motion` gate
 *   (`reducedMotion === "pause"` while the media query matches —
 *   docs/a11y-design.md §6). It is deliberately NOT a `pause()` reuse:
 *   `_paused` is user intent (cleared by `start()`/`stop()`), and mixing an
 *   environment condition into it would let `resume()` override the OS
 *   setting. Unlike visibility — where the browser itself stops delivering
 *   frames — the reduced gate is enforced by this core: gate ON cancels the
 *   armed frame, gate OFF re-arms with a dt=0 boundary (G3, the same shape
 *   as a visibility interruption).
 * - **No `error` surface.** rAF has no persistent failure mode; on a platform
 *   without it, `start()` is a silent no-op (never-throw, resize precedent).
 */
declare class RafCore extends EventTarget {
    static wcBindable: IWcBindable;
    private _target;
    private _injectedScheduler;
    private _handle;
    private _globalScheduler;
    private _gen;
    private _ready;
    private _tick;
    private _dt;
    private _elapsed;
    private _running;
    private _suspended;
    private _paused;
    private _lastTs;
    private _repeat;
    private _runStartTick;
    private _visibilityDoc;
    private _reducedMotion;
    private _mql;
    private _injectedMatchMedia;
    constructor(target?: EventTarget, scheduler?: RafScheduler, matchMedia?: RafMatchMedia);
    get tick(): number;
    get elapsed(): number;
    get dt(): number;
    get running(): boolean;
    get suspended(): boolean;
    get reducedMotion(): "run" | "pause";
    set reducedMotion(value: "run" | "pause");
    get ready(): Promise<void>;
    observe(): Promise<void>;
    dispose(): void;
    private _dispatchTick;
    private _setRunning;
    private _setSuspended;
    private _updateSuspended;
    private _reducedGate;
    private _onReducedMotionChange;
    private _applyReducedGate;
    start(options?: RafStartOptions): void;
    stop(): void;
    reset(): void;
    pause(): void;
    resume(): void;
    private _frame;
    private _onVisibilityChange;
    private _resolveScheduler;
    private _resolveMatchMedia;
    private _requestFrame;
    private _clearHandle;
}

declare class Raf extends HTMLElement {
    static hasConnectedCallbackPromise: boolean;
    static wcBindable: IWcBindable;
    static get observedAttributes(): string[];
    private _core;
    private _trigger;
    private _connectedCallbackPromise;
    private _internals;
    constructor();
    get debugStates(): string[];
    private _initInternals;
    private _wireStates;
    get connectedCallbackPromise(): Promise<void>;
    get once(): boolean;
    set once(value: boolean);
    get repeat(): number;
    set repeat(value: number);
    get manual(): boolean;
    set manual(value: boolean);
    get reducedMotion(): "run" | "pause";
    set reducedMotion(value: string);
    attributeChangedCallback(name: string, _oldValue: string | null, newValue: string | null): void;
    get tick(): number;
    get elapsed(): number;
    get dt(): number;
    get running(): boolean;
    get suspended(): boolean;
    get trigger(): boolean;
    set trigger(value: boolean);
    start(): void;
    stop(): void;
    reset(): void;
    pause(): void;
    resume(): void;
    connectedCallback(): void;
    disconnectedCallback(): void;
}

declare global {
    interface HTMLElementTagNameMap {
        "wcs-raf": Raf;
    }
}

export { RafCore, Raf as WcsRaf, bootstrapRaf, getConfig };
export type { IWritableConfig, IWritableTagNames, RafScheduler, RafStartOptions, WcsRafCommands, WcsRafCoreCommands, WcsRafCoreValues, WcsRafInputs, WcsRafTickDetail, WcsRafValues };
