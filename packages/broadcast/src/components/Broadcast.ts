import { config } from "../config.js";
import { IWcBindable, WcsBroadcastErrorDetail } from "../types.js";
import { BroadcastCore } from "../core/BroadcastCore.js";
import { registerAutoTrigger } from "../autoTrigger.js";

// Named WcsBroadcast (not `Broadcast`) to match the <wcs-clipboard> WcsClipboard
// / <wcs-ws> WcsWebSocket convention and avoid shadowing any global.
export class WcsBroadcast extends HTMLElement {
  // SSR (§4.4): the channel opens synchronously in connectedCallback, so the
  // Core's observe() resolves immediately; we still expose connectedCallbackPromise
  // so a state binder can uniformly await readiness before snapshotting.
  static hasConnectedCallbackPromise = true;
  static wcBindable: IWcBindable = {
    ...BroadcastCore.wcBindable,
    // Shell-level settable surface. `name` selects the channel; `manual`
    // suppresses auto-open on connect. There is no momentary `post` property:
    // posting needs an argument (the payload), so element actions run via
    // command-token (`command.post: $command.ping`) or the DOM autoTrigger, not
    // a value-derived setter — keeping `post` a plain command keeps the
    // command-token wiring (`command.post:`) readable.
    inputs: [
      { name: "name", attribute: "name" },
      { name: "manual", attribute: "manual" },
    ],
    // Commands are identical to the Core's — no rename needed since the `name` /
    // `manual` attribute accessors do not collide with open/post/close.
    commands: BroadcastCore.wcBindable.commands,
  };
  static get observedAttributes(): string[] { return ["name"]; }

  private _core: BroadcastCore;
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();
  private _internals: ElementInternals | null = null;

  constructor() {
    super();
    this._core = new BroadcastCore(this);
    this._internals = this._initInternals();
    this._wireStates({
      "wcs-broadcast:error": (d) => ({ error: d != null }),
    });
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

  get connectedCallbackPromise(): Promise<void> {
    return this._connectedCallbackPromise;
  }

  // --- Attribute accessors ---

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

  // --- Core delegated getters ---

  get message(): any {
    return this._core.message;
  }

  get error(): WcsBroadcastErrorDetail | null {
    return this._core.error;
  }

  // --- Commands ---

  open(): void {
    if (this.name) {
      this._core.open(this.name);
    }
  }

  post(data: any): void {
    this._core.post(data);
  }

  close(): void {
    this._core.close();
  }

  // --- Lifecycle ---

  attributeChangedCallback(name: string, _oldValue: string | null, newValue: string | null): void {
    if (name === "name" && this.isConnected && !this.manual && newValue) {
      this._core.open(newValue);
    }
  }

  connectedCallback(): void {
    this.style.display = "none";
    if (config.autoTrigger) {
      registerAutoTrigger();
    }
    if (!this.manual && this.name) {
      this._core.open(this.name);
    }
    // SSR (§4.4): expose the Core's readiness as connectedCallbackPromise. The
    // channel opens synchronously above, so observe() resolves immediately.
    this._connectedCallbackPromise = this._core.observe();
  }

  disconnectedCallback(): void {
    // Deliberately does NOT call unregisterAutoTrigger(). The autoTrigger click
    // listener is a single process-wide document listener (registerAutoTrigger
    // is idempotent), shared by every <wcs-broadcast> on the page — not owned by
    // this element. Tearing it down when the last element disconnects would
    // break a later-inserted trigger, so it is intentionally left installed for
    // the document's lifetime (one passive listener, negligible cost). This
    // mirrors <wcs-clipboard>, which registers but never unregisters either.
    // unregisterAutoTrigger stays exported purely as a symmetric teardown hook
    // for tests / advanced manual control; the production lifecycle never calls
    // it.
    this._core.dispose();
  }
}
