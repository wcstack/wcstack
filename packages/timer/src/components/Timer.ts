import { config } from "../config.js";
import { IWcBindable } from "../types.js";
import { TimerCore } from "../core/TimerCore.js";
import { registerAutoTrigger } from "../autoTrigger.js";

export class Timer extends HTMLElement {
  static hasConnectedCallbackPromise = false;
  static wcBindable: IWcBindable = {
    ...TimerCore.wcBindable,
    properties: [
      ...TimerCore.wcBindable.properties,
      { name: "trigger", event: "wcs-timer:trigger-changed" },
    ],
    // Shell-level settable surface. `attribute` is a purely descriptive hint
    // (per SPEC-extensions.md the binding core does not act on it) naming the
    // mirrored HTML attribute, matching <wcs-geo> / <wcs-debounce>. `trigger` is a
    // momentary command-property with no backing attribute, so it carries no hint
    // (same as those packages). `start` / `stop` / `reset` / `pause` / `resume`
    // commands are inherited from the Core above.
    inputs: [
      { name: "interval", attribute: "interval" },
      { name: "once", attribute: "once" },
      { name: "repeat", attribute: "repeat" },
      { name: "immediate", attribute: "immediate" },
      { name: "manual", attribute: "manual" },
      { name: "trigger" },
    ],
  };
  static get observedAttributes(): string[] { return ["interval"]; }

  private _core: TimerCore;
  private _trigger: boolean = false;

  constructor() {
    super();
    this._core = new TimerCore(this);
  }

  // --- Attribute accessors ---

  get interval(): number {
    const attr = this.getAttribute("interval");
    if (attr === null || attr.trim() === "") return 1000;
    // Strict parse via Number() (unlike parseInt, "100px" -> NaN, not 100),
    // matching <wcs-geo> / <wcs-debounce>. Fall back to the 1000ms default for any
    // invalid period — not only NaN but also 0 / negative values, which would
    // otherwise reach setInterval as a hot loop and break resume()'s modulo
    // arithmetic in the Core.
    const parsed = Number(attr);
    return (Number.isFinite(parsed) && parsed > 0) ? parsed : 1000;
  }

  set interval(value: number) {
    this.setAttribute("interval", String(value));
  }

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
    // Strict parse via Number() ("3px" -> NaN, not 3), matching <wcs-geo> /
    // <wcs-debounce>. Normalise any non-positive / non-numeric value to 0
    // (= unlimited), mirroring the `interval` getter. Without this a negative
    // `repeat="-3"` would leak through to start(); harmless today (Core treats
    // `_repeat <= 0` as unlimited) but the asymmetry is a trap.
    const parsed = Number(attr);
    return (Number.isFinite(parsed) && parsed > 0) ? parsed : 0;
  }

  set repeat(value: number) {
    this.setAttribute("repeat", String(value));
  }

  get immediate(): boolean {
    return this.hasAttribute("immediate");
  }

  set immediate(value: boolean) {
    if (value) {
      this.setAttribute("immediate", "");
    } else {
      this.removeAttribute("immediate");
    }
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

  get running(): boolean {
    return this._core.running;
  }

  // --- Command property ---

  get trigger(): boolean {
    return this._trigger;
  }

  set trigger(value: boolean) {
    // Momentary command-property: a false→true write starts the timer. Mirrors
    // the trigger flag on <wcs-fetch> / <wcs-ws>. Prefer the command-token
    // protocol (`command.start: $command.tick`) for state-driven starts; this
    // exists mainly for the DOM click trigger and simple boolean bindings.
    const v = !!value;
    if (v) {
      this._trigger = true;
      this.start();
      this._trigger = false;
      // The `trigger-changed` event reports the momentary flag returning to
      // false, i.e. that the trigger property *changed* — it is deliberately not
      // gated on whether start() actually began a new run. This keeps the
      // wcBindable `trigger` property's change-notification semantics consistent
      // (every false→true write produces exactly one change-back event), even
      // when start() was a no-op because the timer was already running.
      this.dispatchEvent(new CustomEvent("wcs-timer:trigger-changed", {
        detail: false,
        bubbles: true,
      }));
    }
  }

  // --- Commands ---

  start(): void {
    // `once` is sugar for "fire exactly one tick": map it to repeat=1, but let an
    // explicit repeat attribute win when both are present.
    const repeat = this.repeat > 0 ? this.repeat : (this.once ? 1 : 0);
    this._core.start({
      interval: this.interval,
      repeat,
      immediate: this.immediate,
    });
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

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    // Live interval changes swap the underlying setInterval period in place.
    // `tick` / `elapsed` and the per-run `repeat` progress are preserved — we
    // deliberately do NOT stop()+start(), which would re-run start() and
    // re-evaluate per-run options (re-firing `immediate` and re-baselining
    // `repeat`). `running` alone gates this: swapping the period is orthogonal to
    // *how* the timer was started, so a `manual` timer the user has explicitly
    // started gets live period changes too. A non-running timer needs no swap —
    // its next start() picks up the new attribute as plain config.
    if (name === "interval" && oldValue !== newValue && this.isConnected && this.running) {
      this._core.changeInterval(this.interval);
    }
  }

  connectedCallback(): void {
    this.style.display = "none";
    if (config.autoTrigger) {
      registerAutoTrigger();
    }
    if (!this.manual) {
      this.start();
    }
  }

  disconnectedCallback(): void {
    this._core.stop();
  }
}
