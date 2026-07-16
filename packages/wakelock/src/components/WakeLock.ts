import { IWcBindable, WakeLockKind } from "../types.js";
import { WakeLockCore } from "../core/WakeLockCore.js";
import { WcsIoErrorInfo } from "../core/platformCapability.js";

/**
 * `<wcs-wakelock>` — declarative Screen Wake Lock.
 *
 * The first @wcstack tag that is a pure *sink*: every other sensor is an
 * element→state producer, but the wake lock is state→element. The headline
 * binding is `active@isPlaying` — hold the screen awake while a bound boolean is
 * true. `active` is the single input knob (a mirrored attribute); `held` and
 * `error` are the observable outputs.
 *
 * The OS auto-releases the lock when the page is hidden; the Core re-acquires it
 * on the next return to visibility while `active` is still set, so the binding
 * means "keep awake *while* active", not just "acquire once".
 */
export class WcsWakeLock extends HTMLElement {
  // SSR contract (§4.1/@wcstack/server): the renderer awaits elements declaring
  // `hasConnectedCallbackPromise = true` before snapshotting. The wake lock has no
  // connect-time async probe to await (acquire is fire-and-forget and meaningless
  // server-side), so `connectedCallbackPromise` is backed by the Core's no-op
  // `observe()`, which resolves immediately. The flag is still declared `true` so
  // the renderer reads it via `ctor.hasConnectedCallbackPromise` and the Shell
  // participates uniformly in the SSR await protocol.
  static hasConnectedCallbackPromise = true;
  // `active` drives request/release; `type` propagates to the Core's next acquire.
  // `manual` is intentionally excluded: it is a connect-time policy ("don't auto-
  // acquire on connect"), not a live switch.
  static observedAttributes = ["active", "type"];

  static wcBindable: IWcBindable = {
    ...WakeLockCore.wcBindable,
    // Settable surface. `active` is the declarative intent; `type` selects the lock
    // kind; `manual` opts out of auto-acquire on connect. The request / release
    // commands are inherited from the Core via the spread above.
    inputs: [
      { name: "active", attribute: "active" },
      { name: "type", attribute: "type" },
      { name: "manual", attribute: "manual" },
    ],
    // Core の commands をそのまま継承（単一情報源）。<wcs-intersect>/<wcs-sse> と同型。
    // spread でも継承されるが、Core に command 追加時の追従漏れを防ぐため明示参照する。
    commands: WakeLockCore.wcBindable.commands,
  };

  private _core: WakeLockCore;
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();
  private _internals: ElementInternals | null = null;

  constructor() {
    super();
    this._core = new WakeLockCore(this);
    this._internals = this._initInternals();
    this._wireStates({
      "wcs-wakelock:held-changed": (d) => ({ held: d === true }),
      "wcs-wakelock:error":        (d) => ({ error: d != null }),
    });
  }

  // SSR (§4.1): the renderer awaits this before snapshotting. Backed by the Core's
  // observe() (a no-op resolving immediately for this command-driven sink).
  get connectedCallbackPromise(): Promise<void> {
    return this._connectedCallbackPromise;
  }

  // CSS state reflection (:state()) — debug-only snapshot getter. NOT part of
  // wc-bindable (not a bind target); see README "CSS styling with :state()".
  // MUST NOT return the live CustomStateSet (that would let callers write
  // states from outside, defeating the point of :state() being read-only).
  get debugStates(): string[] {
    return this._internals ? [...this._internals.states] : [];
  }

  private _initInternals(): ElementInternals | null {
    // never-throw (async-io-node-guidelines.md §3.6): attachInternals is absent
    // in happy-dom / older environments, and pre-125 Chromium rejects
    // non-dashed state names from states.add() (probed and discarded here).
    // Either case silently disables reflection — the component still works,
    // it just doesn't expose :state() selectors.
    try {
      if (typeof this.attachInternals !== "function") return null;
      const internals = this.attachInternals();
      internals.states.add("wcs-probe");
      internals.states.delete("wcs-probe");
      return internals;
    } catch {
      return null;
    }
  }

  private _wireStates(map: Record<string, (detail: any) => Record<string, boolean>>): void {
    if (this._internals === null) return;
    const states = this._internals.states;
    for (const [event, toStates] of Object.entries(map)) {
      this.addEventListener(event, (e) => {
        const debug = this.hasAttribute("debug-states");
        for (const [name, on] of Object.entries(toStates((e as CustomEvent).detail))) {
          try {
            // The ternary expression-statement form trips ESLint no-unused-expressions.
            if (on) { states.add(name); } else { states.delete(name); }
          } catch { /* never-throw */ }
          if (debug) this.toggleAttribute(`data-wcs-state-${name}`, on);
        }
      });
    }
  }

  // --- Attribute accessors ---

  get active(): boolean {
    // Reflects the *attribute*, not the Core's desired intent (`_core.active`). These
    // can diverge: invoking the `request` / `release` commands directly (e.g. via a
    // command-token binding) flips the Core's desired flag without touching the
    // attribute, so `el.active` may read false while `el.held` is true (or vice
    // versa). The attribute is the declarative input surface; the commands are an
    // imperative side door. Bind via `active@...` for a single source of truth.
    return this.hasAttribute("active");
  }

  set active(value: boolean) {
    if (value) {
      this.setAttribute("active", "");
    } else {
      this.removeAttribute("active");
    }
  }

  get type(): WakeLockKind {
    // Only "screen" is standardized; an absent/empty attribute defaults to it.
    return (this.getAttribute("type") as WakeLockKind) || "screen";
  }

  set type(value: WakeLockKind) {
    this.setAttribute("type", value);
  }

  get manual(): boolean {
    return this.hasAttribute("manual");
  }

  set manual(value: boolean) {
    if (value) {
      this.setAttribute("manual", "");
    } else {
      this.removeAttribute("manual");
    }
  }

  // --- Core delegated getters ---

  get held(): boolean {
    return this._core.held;
  }

  get error(): Error | null {
    return this._core.error;
  }

  get errorInfo(): WcsIoErrorInfo | null {
    return this._core.errorInfo;
  }

  // --- Commands ---

  /** Acquire (and keep) the wake lock. Never rejects — see the `error` property. */
  request(): Promise<void> {
    return this._core.request();
  }

  /** Release the wake lock and stop re-acquiring it. */
  release(): void {
    this._core.release();
  }

  // --- Lifecycle ---

  connectedCallback(): void {
    // Headless resource: no layout box (mirrors the @wcstack sensor convention).
    this.style.display = "none";
    // Propagate the requested lock type to the Core. Currently a no-op in effect:
    // "screen" is the only standardized type, so `type` is always "screen". Wired
    // up as a forward-compatible seam (observedAttributes + setter + this line) for
    // when the spec adds lock types; until then it carries a constant.
    this._core.type = this.type;
    // Establish monitoring (§3.5) and expose readiness for SSR (§4.1). observe()
    // is a no-op that resolves immediately for this command-driven sink.
    this._connectedCallbackPromise = this._core.observe();
    if (!this.manual && this.active) {
      void this._core.request();
    }
  }

  disconnectedCallback(): void {
    this._core.dispose();
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue === newValue) return;
    // Ignore changes applied before connect (e.g. createElement + setAttribute);
    // connectedCallback applies the initial state. Acquiring a lock for a detached
    // element would be wrong.
    if (!this.isConnected) return;
    if (name === "type") {
      this._core.type = this.type;
      return;
    }
    // name === "active": a live toggle always drives request/release. `manual` only
    // gates the connect-time auto-acquire, not an explicit author toggle.
    if (this.active) {
      void this._core.request();
    } else {
      this._core.release();
    }
  }
}
