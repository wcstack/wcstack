import { config } from "../config.js";
import { IWcBindable } from "../types.js";
import { RafCore } from "../core/RafCore.js";
import { registerAutoTrigger } from "../autoTrigger.js";

export class Raf extends HTMLElement {
  static hasConnectedCallbackPromise = true;
  static wcBindable: IWcBindable = {
    ...RafCore.wcBindable,
    properties: [
      ...RafCore.wcBindable.properties,
      { name: "trigger", event: "wcs-raf:trigger-changed" },
    ],
    // Shell-level settable surface. `attribute` is a purely descriptive hint
    // (per SPEC-extensions.md the binding core does not act on it) naming the
    // mirrored HTML attribute, matching <wcs-timer>. `trigger` is a momentary
    // command-property with no backing attribute, so it carries no hint.
    // `start` / `stop` / `reset` / `pause` / `resume` commands are inherited
    // from the Core above. Deliberately absent vs <wcs-timer>: `interval`
    // (rAF has no period) and `immediate` (the first frame already IS the
    // next rendering opportunity — no earlier meaningful moment exists).
    inputs: [
      { name: "once", attribute: "once" },
      { name: "repeat", attribute: "repeat" },
      { name: "manual", attribute: "manual" },
      { name: "trigger" },
    ],
  };

  private _core: RafCore;
  private _trigger: boolean = false;
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();
  private _internals: ElementInternals | null = null;

  constructor() {
    super();
    this._core = new RafCore(this);
    this._internals = this._initInternals();
    this._wireStates({
      "wcs-raf:running-changed": (d) => ({ running: d === true }),
      "wcs-raf:suspended-changed": (d) => ({ suspended: d === true }),
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

  // SSR (§4.1/§4.4): the Shell exposes the Core's readiness so a server-side
  // renderer can await the connect-time probe before snapshotting. There is no
  // async probe here (observe() resolves immediately), but the contract is
  // uniform across IO nodes.
  get connectedCallbackPromise(): Promise<void> {
    return this._connectedCallbackPromise;
  }

  // --- Attribute accessors ---

  get once(): boolean {
    return this.hasAttribute("once");
  }

  set once(value: boolean) {
    if (value) {
      this.setAttribute("once", "");
    } else {
      this.removeAttribute("once");
    }
  }

  get repeat(): number {
    const attr = this.getAttribute("repeat");
    if (attr === null || attr.trim() === "") return 0;
    // Strict parse via Number() ("3px" -> NaN, not 3), matching <wcs-timer>.
    // Normalise any non-positive / non-numeric value to 0 (= unlimited).
    const parsed = Number(attr);
    return (Number.isFinite(parsed) && parsed > 0) ? parsed : 0;
  }

  set repeat(value: number) {
    this.setAttribute("repeat", String(value));
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

  get tick(): number {
    return this._core.tick;
  }

  get elapsed(): number {
    return this._core.elapsed;
  }

  get dt(): number {
    return this._core.dt;
  }

  get running(): boolean {
    return this._core.running;
  }

  get suspended(): boolean {
    return this._core.suspended;
  }

  // --- Command property ---

  get trigger(): boolean {
    return this._trigger;
  }

  set trigger(value: boolean) {
    // Momentary command-property: a false→true write starts the loop. Mirrors
    // <wcs-timer>. Prefer the command-token protocol (`command.start:
    // $command.begin`) for state-driven starts; this exists mainly for the DOM
    // click trigger and simple boolean bindings.
    const v = !!value;
    if (v) {
      this._trigger = true;
      this.start();
      this._trigger = false;
      // The `trigger-changed` event reports the momentary flag returning to
      // false, i.e. that the trigger property *changed* — it is deliberately
      // not gated on whether start() actually began a new run (same contract
      // as <wcs-timer>).
      this.dispatchEvent(new CustomEvent("wcs-raf:trigger-changed", {
        detail: false,
        bubbles: true,
      }));
    }
  }

  // --- Commands ---

  start(): void {
    // `once` is sugar for "fire exactly one frame": map it to repeat=1, but
    // let an explicit repeat attribute win when both are present.
    const repeat = this.repeat > 0 ? this.repeat : (this.once ? 1 : 0);
    this._core.start({ repeat });
  }

  stop(): void {
    this._core.stop();
  }

  reset(): void {
    this._core.reset();
  }

  pause(): void {
    this._core.pause();
  }

  resume(): void {
    this._core.resume();
  }

  // --- Lifecycle ---

  connectedCallback(): void {
    this.style.display = "none";
    if (config.autoTrigger) {
      registerAutoTrigger();
    }
    // Establish monitoring (§3.5): observe() subscribes visibilitychange (the
    // `suspended` output) and resolves once ready; expose it as
    // connectedCallbackPromise for SSR. Note for SSR pages: an auto-started
    // frame loop keeps scheduling — prefer `manual` in server-rendered markup
    // (see README).
    this._connectedCallbackPromise = this._core.observe();
    if (!this.manual) {
      this.start();
    }
  }

  disconnectedCallback(): void {
    // dispose() stops the loop, releases the visibility subscription and bumps
    // the generation so a frame already queued cannot fire onto a disconnected
    // element (§3.5 / §4.4).
    this._core.dispose();
  }
}
