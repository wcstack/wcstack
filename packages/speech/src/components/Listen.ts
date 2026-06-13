import { config } from "../config.js";
import {
  IWcBindable, ListenOptions, ListenPermissionState, WcsListenResultDetail, WcsListenErrorDetail,
} from "../types.js";
import { ListenCore } from "../core/ListenCore.js";
import { registerListenAutoTrigger } from "../listenAutoTrigger.js";

/**
 * `<wcs-listen>` — declarative speech-to-text. Wraps ListenCore and exposes the
 * recognition surface (interim/final transcripts, structured result, listening
 * flag, microphone permission, error) plus the two-phase start/stop/abort
 * commands and a momentary `trigger` for DOM-driven starts.
 *
 * Mirrors `<wcs-geo>`: `manual` suppresses the connect-time auto-start, and the
 * `continuous` attribute selects the auto-restarting session phase.
 */
export class WcsListen extends HTMLElement {
  static wcBindable: IWcBindable = {
    ...ListenCore.wcBindable,
    properties: [
      ...ListenCore.wcBindable.properties,
      { name: "trigger", event: "wcs-listen:trigger-changed" },
    ],
    inputs: [
      { name: "lang", attribute: "lang" },
      { name: "continuous", attribute: "continuous" },
      { name: "interim", attribute: "interim" },
      { name: "maxRestarts", attribute: "max-restarts" },
      { name: "manual", attribute: "manual" },
      { name: "trigger" },
    ],
    commands: ListenCore.wcBindable.commands,
  };

  private _core: ListenCore;
  private _trigger: boolean = false;

  constructor() {
    super();
    this._core = new ListenCore(this);
  }

  // --- Attribute accessors ---

  get lang(): string {
    return this.getAttribute("lang") ?? "";
  }

  set lang(value: string | null) {
    if (value == null) {
      this.removeAttribute("lang");
    } else {
      this.setAttribute("lang", String(value));
    }
  }

  get continuous(): boolean {
    return this.hasAttribute("continuous");
  }

  set continuous(value: boolean) {
    if (value) {
      this.setAttribute("continuous", "");
    } else {
      this.removeAttribute("continuous");
    }
  }

  get interim(): boolean {
    return this.hasAttribute("interim");
  }

  set interim(value: boolean) {
    if (value) {
      this.setAttribute("interim", "");
    } else {
      this.removeAttribute("interim");
    }
  }

  get maxRestarts(): number {
    const attr = this.getAttribute("max-restarts");
    if (attr === null || attr.trim() === "") return 0;
    const parsed = Number(attr);
    // A restart *count* is an integer, so floor fractional input (e.g. 1.9 → 1)
    // here too, keeping the getter's value identical to the effective cap the
    // Core applies (ListenCore.start floors it as well). Non-finite/negative → 0.
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
  }

  set maxRestarts(value: number) {
    this.setAttribute("max-restarts", String(value));
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

  get interimTranscript(): string {
    return this._core.interimTranscript;
  }

  get finalTranscript(): string {
    return this._core.finalTranscript;
  }

  get result(): WcsListenResultDetail | null {
    return this._core.result;
  }

  get listening(): boolean {
    return this._core.listening;
  }

  get permission(): ListenPermissionState {
    return this._core.permission;
  }

  get error(): WcsListenErrorDetail | null {
    return this._core.error;
  }

  get unsupported(): boolean {
    return this._core.unsupported;
  }

  // --- Command property ---

  get trigger(): boolean {
    return this._trigger;
  }

  set trigger(value: boolean) {
    // Momentary command-property: a false→true write starts a session. Mirrors
    // <wcs-geo>'s trigger. Prefer the command-token protocol (`command.start:
    // $command.listen`) for state-driven starts; this exists for DOM triggers and
    // simple boolean bindings.
    const v = !!value;
    if (v) {
      this._trigger = true;
      this.start();
      this._trigger = false;
      this.dispatchEvent(new CustomEvent("wcs-listen:trigger-changed", { detail: false, bubbles: true }));
    }
  }

  // --- Commands ---

  start(): void {
    this._core.start(this._options());
  }

  stop(): void {
    this._core.stop();
  }

  abort(): void {
    this._core.abort();
  }

  // --- Internal ---

  private _options(): ListenOptions {
    return {
      lang: this.lang,
      continuous: this.continuous,
      interimResults: this.interim,
      maxRestarts: this.maxRestarts,
    };
  }

  // --- Lifecycle ---

  connectedCallback(): void {
    this.style.display = "none";
    if (config.autoTrigger) {
      registerListenAutoTrigger();
    }
    this._core.reinitPermission();
    if (!this.manual) {
      // Non-blocking auto-start, mirroring <wcs-geo>: start() is fired
      // unconditionally without first awaiting/inspecting the (async) permission
      // state. A `denied` mic surfaces as a `not-allowed` error via the `error`
      // property (and stops auto-restart), rather than the connect path silently
      // suppressing the start. This keeps the permission model declarative and
      // consistent with geolocation. Use `manual` to require an explicit start.
      this.start();
    }
  }

  disconnectedCallback(): void {
    this._core.dispose();
  }
}
