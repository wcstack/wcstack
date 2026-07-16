import { config } from "../config.js";
import { IWcBindable, WcsWorkerErrorDetail } from "../types.js";
import { WorkerCore } from "../core/WorkerCore.js";
import { WcsIoErrorInfo } from "../core/platformCapability.js";
import { registerAutoTrigger } from "../autoTrigger.js";

// Named WcsWorker (not `Worker`) to avoid shadowing the global `Worker`
// constructor and to match the <wcs-broadcast> WcsBroadcast / <wcs-ws>
// WcsWebSocket convention.
export class WcsWorker extends HTMLElement {
  // SSR (§4.1/§4.4): expose connectedCallbackPromise backed by _core.observe()
  // so a shell renderer can await first-connect readiness uniformly across all
  // IO nodes. The worker still spawns synchronously in connectedCallback; the
  // Core's observe() resolves immediately (command-driven, no async probe), so
  // the promise is effectively already-resolved but the contract is honored.
  static hasConnectedCallbackPromise = true;
  static wcBindable: IWcBindable = {
    ...WorkerCore.wcBindable,
    // Shell-level settable surface. `src` selects the script; `manual` suppresses
    // auto-spawn; `keep-alive` keeps the worker past disconnect; the restart-*
    // inputs configure opt-in restart-on-error. There is no momentary `post`
    // property: posting needs an argument (the payload), so element actions run
    // via command-token (`command.post: $command.ping`) or the DOM autoTrigger,
    // keeping `post` a plain command and the `command.post:` wiring readable.
    inputs: [
      { name: "src", attribute: "src" },
      { name: "type", attribute: "type" },
      { name: "name", attribute: "name" },
      { name: "manual", attribute: "manual" },
      { name: "keepAlive", attribute: "keep-alive" },
      { name: "restartOnError", attribute: "restart-on-error" },
      { name: "maxRestarts", attribute: "max-restarts" },
      { name: "restartInterval", attribute: "restart-interval" },
    ],
    // Commands are identical to the Core's — the attribute accessors (src, type,
    // name, ...) do not collide with start/post/terminate.
    commands: WorkerCore.wcBindable.commands,
  };
  static get observedAttributes(): string[] { return ["src"]; }

  private _core: WorkerCore;
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();
  private _internals: ElementInternals | null = null;

  constructor() {
    super();
    this._core = new WorkerCore(this);
    this._internals = this._initInternals();
    this._wireStates({
      "wcs-worker:running-changed": (d) => ({ running: d === true }),
      "wcs-worker:error":           (d) => ({ error: d != null }),
    });
  }

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
            if (on) { states.add(name); } else { states.delete(name); }
          } catch { /* never-throw */ }
          if (debug) this.toggleAttribute(`data-wcs-state-${name}`, on);
        }
      });
    }
  }

  // --- Attribute accessors ---

  get src(): string {
    return this.getAttribute("src") || "";
  }

  set src(value: string) {
    this.setAttribute("src", value);
  }

  get type(): WorkerType {
    return this.getAttribute("type") === "classic" ? "classic" : "module";
  }

  set type(value: WorkerType) {
    this.setAttribute("type", value);
  }

  get name(): string {
    return this.getAttribute("name") || "";
  }

  set name(value: string) {
    this.setAttribute("name", value);
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

  get keepAlive(): boolean {
    return this.hasAttribute("keep-alive");
  }

  set keepAlive(value: boolean) {
    if (value) {
      this.setAttribute("keep-alive", "");
    } else {
      this.removeAttribute("keep-alive");
    }
  }

  get restartOnError(): boolean {
    return this.hasAttribute("restart-on-error");
  }

  set restartOnError(value: boolean) {
    if (value) {
      this.setAttribute("restart-on-error", "");
    } else {
      this.removeAttribute("restart-on-error");
    }
  }

  get maxRestarts(): number {
    const attr = this.getAttribute("max-restarts");
    // `max-restarts="Infinity"` is the documented default-equivalent for an
    // unbounded restart budget. parseInt("Infinity", 10) is NaN, so match it
    // explicitly rather than leaning on the NaN fallback (which would silently
    // break if that fallback ever changed). Any other non-numeric value still
    // falls back to Infinity via the NaN guard.
    if (attr === "Infinity") return Infinity;
    const parsed = attr ? parseInt(attr, 10) : Infinity;
    return Number.isNaN(parsed) ? Infinity : parsed;
  }

  set maxRestarts(value: number) {
    this.setAttribute("max-restarts", String(value));
  }

  get restartInterval(): number {
    const attr = this.getAttribute("restart-interval");
    const parsed = attr ? parseInt(attr, 10) : 0;
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  set restartInterval(value: number) {
    this.setAttribute("restart-interval", String(value));
  }

  // --- Core delegated getters ---

  get message(): any {
    return this._core.message;
  }

  get error(): WcsWorkerErrorDetail | null {
    return this._core.error;
  }

  get errorInfo(): WcsIoErrorInfo | null {
    return this._core.errorInfo;
  }

  get running(): boolean {
    return this._core.running;
  }

  // --- Commands ---

  start(): void {
    // Delegate unconditionally — including the empty-`src` case — so the Core's
    // never-throw contract holds at the Shell boundary too: start("") raises a
    // TypeError through `error` rather than failing silently. The auto-spawn
    // paths (connectedCallback / attributeChangedCallback) already gate on a
    // non-empty `src`, so this only affects an explicit `el.start()` call.
    this._core.start(this.src, {
      type: this.type,
      name: this.name,
      restartOnError: this.restartOnError,
      maxRestarts: this.maxRestarts,
      restartInterval: this.restartInterval,
    });
  }

  post(data: any, transfer?: Transferable[]): void {
    this._core.post(data, transfer);
  }

  terminate(): void {
    this._core.terminate();
  }

  // --- Lifecycle ---

  attributeChangedCallback(name: string, _oldValue: string | null, newValue: string | null): void {
    if (name === "src" && this.isConnected && !this.manual && newValue) {
      this.start();
    }
  }

  connectedCallback(): void {
    this.style.display = "none";
    if (config.autoTrigger) {
      registerAutoTrigger();
    }
    // SSR (§4.4): back connectedCallbackPromise with the Core's observe(). It
    // resolves immediately for this command-driven node, but wiring it keeps the
    // readiness contract uniform with the async-init IO nodes.
    this._connectedCallbackPromise = this._core.observe();
    if (!this.manual && this.src) {
      this.start();
    }
  }

  disconnectedCallback(): void {
    // Deliberately does NOT call unregisterAutoTrigger(). The autoTrigger click
    // listener is a single process-wide document listener (registerAutoTrigger
    // is idempotent), shared by every <wcs-worker> on the page — not owned by
    // this element. Tearing it down when the last element disconnects would
    // break a later-inserted trigger, so it is intentionally left installed for
    // the document's lifetime (one passive listener, negligible cost). This
    // mirrors <wcs-broadcast> / <wcs-clipboard>, which register but never
    // unregister either; unregisterAutoTrigger stays exported purely as a
    // symmetric teardown hook for tests / advanced manual control.
    //
    // keep-alive intentionally leaves the worker running past disconnect: the
    // worker outlives the element and ownership transfers to the caller, who must
    // call terminate() to free the thread. Without keep-alive the worker is torn
    // down like <wcs-ws> / <wcs-broadcast> close on disconnect.
    if (!this.keepAlive) {
      this._core.dispose();
    }
  }
}
