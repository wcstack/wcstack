import { IWcBindable, WakeLockKind } from "../types.js";
import { WakeLockCore } from "../core/WakeLockCore.js";

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
  // SSR contract (@wcstack/server): the renderer awaits elements declaring
  // `hasConnectedCallbackPromise = true` before snapshotting. The wake lock has no
  // connect-time async fix to await (acquire is fire-and-forget and meaningless
  // server-side), so this is `false` — same as the other synchronous sensor Shells
  // (sse / intersection / worker). Kept (not deleted) because it is the protocol
  // contract surface the server renderer reads via `ctor.hasConnectedCallbackPromise`.
  static hasConnectedCallbackPromise = false;
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

  constructor() {
    super();
    this._core = new WakeLockCore(this);
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
