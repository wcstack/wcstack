import {
  IMidiDevice, IMidiMessage, IMidiOptions, IWcBindable, MidiMessageType,
  MidiPermissionState, WcsIoErrorInfo,
} from "../types.js";
import { MidiCore } from "../core/MidiCore.js";
import { upgradeProperties } from "../protocol/upgradeProperties.js";

/**
 * `<wcs-midi>` — declarative Web MIDI input/output.
 *
 * Nothing happens on connect: `requestMIDIAccess()` can raise a permission
 * prompt, so access is command-driven (`command.request`). Add the `auto`
 * attribute to opt into requesting as soon as the element connects.
 */
export class WcsMidi extends HTMLElement {
  static hasConnectedCallbackPromise = true;
  static observedAttributes = ["input", "output", "channel"];

  static wcBindable: IWcBindable = {
    ...MidiCore.wcBindable,
    inputs: [
      { name: "input", attribute: "input" },
      { name: "output", attribute: "output" },
      { name: "channel", attribute: "channel" },
      { name: "sysex", attribute: "sysex" },
      { name: "auto", attribute: "auto" },
    ],
  };

  private _core: MidiCore;
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();
  private _internals: ElementInternals | null = null;

  constructor() {
    super();
    this._core = new MidiCore(null, this);
    this._internals = this._initInternals();
    this._wireStates({
      "wcs-midi:permission": (d) => ({
        granted: d === "granted",
        denied: d === "denied",
        unsupported: d === "unsupported",
      }),
      "wcs-midi:statechange": (d) => ({ connected: d === true }),
      "wcs-midi:error": (d) => ({ error: d !== null }),
    });
  }

  // CSS state reflection (:state()) — debug-only snapshot getter. NOT part of
  // wc-bindable (not a bind target); see README "CSS styling with :state()".
  get debugStates(): string[] {
    return this._internals ? [...this._internals.states] : [];
  }

  private _initInternals(): ElementInternals | null {
    // never-throw (async-io-node-guidelines.md §3.6): attachInternals is absent
    // in happy-dom / older environments, and pre-125 Chromium rejects non-dashed
    // state names. Either case silently disables reflection.
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

  get input(): string { return this.getAttribute("input") ?? ""; }
  set input(value: string) { this.setAttribute("input", value); }

  get output(): string { return this.getAttribute("output") ?? ""; }
  set output(value: string) { this.setAttribute("output", value); }

  get channel(): number | null {
    const raw = this.getAttribute("channel");
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  set channel(value: number | null) {
    if (value === null) {
      this.removeAttribute("channel");
    } else {
      this.setAttribute("channel", String(value));
    }
  }

  get sysex(): boolean { return this.hasAttribute("sysex"); }
  set sysex(value: boolean) { this.toggleAttribute("sysex", value); }

  get auto(): boolean { return this.hasAttribute("auto"); }
  set auto(value: boolean) { this.toggleAttribute("auto", value); }

  // --- Core delegated getters ---

  get message(): IMidiMessage | null { return this._core.message; }
  get type(): MidiMessageType | null { return this._core.type; }
  get note(): number | null { return this._core.note; }
  get velocity(): number | null { return this._core.velocity; }
  get control(): number | null { return this._core.control; }
  get value(): number | null { return this._core.value; }
  get devices(): IMidiDevice[] { return this._core.devices; }
  get connected(): boolean { return this._core.connected; }
  get permission(): MidiPermissionState { return this._core.permission; }
  get granted(): boolean { return this._core.granted; }
  get denied(): boolean { return this._core.denied; }
  get unsupported(): boolean { return this._core.unsupported; }
  get error(): string | null { return this._core.error; }
  get errorInfo(): WcsIoErrorInfo | null { return this._core.errorInfo; }

  /** Headless escape hatch: the Core backing this element. */
  get core(): MidiCore { return this._core; }

  get connectedCallbackPromise(): Promise<void> {
    return this._connectedCallbackPromise;
  }

  // --- Commands ---

  request(): Promise<void> { return this._core.request(); }
  close(): void { this._core.close(); }
  send(data: number[] | Uint8Array, timestamp?: number): void { this._core.send(data, timestamp); }

  // --- Internal ---

  private _options(): IMidiOptions {
    return {
      input: this.input,
      output: this.output,
      channel: this.channel,
      sysex: this.sysex,
      auto: this.auto,
    };
  }

  // --- Lifecycle ---

  connectedCallback(): void {
    // upgrade 前に代入された input を取り込み直す（doc 13 §1.2 / Phase A1）
    upgradeProperties(this);
    this.style.display = "none";
    this._connectedCallbackPromise = this._core.observe(this._options());
  }

  disconnectedCallback(): void {
    this._core.dispose();
  }

  attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue === newValue) return;
    // Port selection and channel filtering are live: they re-hook the existing
    // access rather than re-requesting it (no second permission prompt).
    if (this.isConnected) this._core.setOptions(this._options());
  }
}
