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
    // Shell-level settable surface. No `attribute` hints: these setters reflect
    // to their attributes themselves, so a binding system that mirrors
    // inputs[].attribute would set the attribute twice. `start` / `stop` /
    // `reset` / `pause` / `resume` commands are inherited from the Core above.
    inputs: [
      { name: "interval" },
      { name: "once" },
      { name: "repeat" },
      { name: "immediate" },
      { name: "manual" },
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
    const parsed = attr ? parseInt(attr, 10) : 1000;
    // Fall back to the 1000ms default for any invalid period — not only NaN but
    // also 0 / negative values, which would otherwise reach setInterval as a hot
    // loop and break resume()'s modulo arithmetic in the Core.
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
    const parsed = attr ? parseInt(attr, 10) : 0;
    return Number.isNaN(parsed) ? 0 : parsed;
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
    // Live interval changes restart the underlying setInterval with the new
    // period (count/elapsed are preserved). Only act on a real change to a
    // running, declaratively-driven timer.
    if (name === "interval" && oldValue !== newValue && this.isConnected && !this.manual && this.running) {
      this._core.stop();
      this.start();
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
