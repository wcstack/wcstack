import {
  IWcBindable, CameraConstraints, FacingMode, MediaDeviceSnapshot, MediaPermissionState,
  WcsMediaErrorDetail,
} from "../types.js";
import { CameraCore } from "../core/CameraCore.js";
import { WcsIoErrorInfo } from "../core/platformCapability.js";

/**
 * `<wcs-camera>` — declarative camera capture with a built-in preview.
 *
 * The element owns a `<video>` in its shadow root and assigns the live
 * `MediaStream` to `video.srcObject` internally, so the non-serializable handle
 * never crosses the state boundary (design §1, case B). For consumers (a
 * `<wcs-recorder>`, an external `<video>`), the stream is also published via the
 * `wcs-camera:stream-ready` event-token for the direct element→element channel
 * (design §2).
 *
 * Acquisition is explicit: `start()` / the `autostart` attribute prompt and
 * acquire; merely connecting does not. While the page is hidden the stream is
 * suspended (clearing the camera indicator) and re-acquired on return, unless
 * `keep-alive` is set (e.g. during recording).
 */
export class WcsCamera extends HTMLElement {
  static hasConnectedCallbackPromise = true;
  static wcBindable: IWcBindable = {
    ...CameraCore.wcBindable,
    inputs: [
      { name: "audio", attribute: "audio" },
      { name: "facingMode", attribute: "facing-mode" },
      { name: "deviceId", attribute: "device-id" },
      { name: "width", attribute: "width" },
      { name: "height", attribute: "height" },
      { name: "autostart", attribute: "autostart" },
      { name: "keepAlive", attribute: "keep-alive" },
    ],
    commands: CameraCore.wcBindable.commands,
  };

  // `autostart` and `keep-alive` are intentionally NOT observed: `autostart` is a
  // connect-time-only acquire trigger (read once in connectedCallback; flipping it
  // later is meaningless), and `keep-alive` is read fresh on every visibilitychange
  // (_onVisibilityChange), so it never needs to drive a re-acquire. The observed set
  // is exactly the constraints that reshape the requested track.
  static observedAttributes = ["facing-mode", "device-id", "audio", "width", "height"];

  private _core: CameraCore;
  private _video: HTMLVideoElement;
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();
  private _connected: boolean = false;
  // True while switchCamera() rewrites several attributes at once. Each setAttribute /
  // removeAttribute fires its own attributeChangedCallback synchronously; without this
  // guard the FIRST change would re-acquire with the not-yet-updated constraints (and
  // tear active down so the later change's re-acquire is skipped). We suppress the
  // per-attribute re-acquire and drive a single one with the final constraints.
  private _batchingAttrs: boolean = false;
  private _internals: ElementInternals | null = null;

  constructor() {
    super();
    this._core = new CameraCore(this);
    const root = this.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = ":host{display:inline-block}video{display:block;width:100%;height:100%}";
    this._video = document.createElement("video");
    this._video.autoplay = true;
    this._video.muted = true;
    this._video.setAttribute("playsinline", "");
    this._video.setAttribute("part", "video");
    root.append(style, this._video);
    // Bind the live handle to the preview internally — never through state. These
    // self-listeners are intentionally not removed on disconnect (asymmetric with the
    // document-level `visibilitychange` in connect/disconnectedCallback): the target
    // is `this`, so the listeners are collected together with the element — there is
    // no external reference to leak. The visibility listener, by contrast, lives on
    // `document` (outlives the element) and MUST be detached.
    this.addEventListener("wcs-camera:stream-ready", this._onStreamReady as EventListener);
    this.addEventListener("wcs-camera:active-changed", this._onActiveChanged as EventListener);
    this._internals = this._initInternals();
    this._wireStates({
      "wcs-camera:active-changed": (d) => ({ active: d === true }),
      "wcs-camera:error":          (d) => ({ error: d != null }),
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
    // never-throw (docs/custom-state-reflection-design.md §3.4): attachInternals is
    // absent in happy-dom / older environments, and pre-125 Chromium rejects
    // non-dashed state names from states.add() (probed and discarded here). Either
    // case silently disables reflection — the component still works, it just doesn't
    // expose :state() selectors.
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
            // 式文の三項演算子は ESLint no-unused-expressions に抵触するため if/else。
            if (on) { states.add(name); } else { states.delete(name); }
          } catch { /* never-throw */ }
          if (debug) this.toggleAttribute(`data-wcs-state-${name}`, on);
        }
      });
    }
  }

  // --- Attribute accessors ---

  get audio(): boolean { return this.hasAttribute("audio"); }
  set audio(value: boolean) { this._toggleAttr("audio", value); }

  get facingMode(): FacingMode {
    return this.getAttribute("facing-mode") === "environment" ? "environment" : "user";
  }
  set facingMode(value: FacingMode) { this.setAttribute("facing-mode", value); }

  get deviceId(): string { return this.getAttribute("device-id") ?? ""; }
  set deviceId(value: string) { this.setAttribute("device-id", value); }

  get width(): number { return this._numberAttr("width"); }
  set width(value: number) { this.setAttribute("width", String(value)); }

  get height(): number { return this._numberAttr("height"); }
  set height(value: number) { this.setAttribute("height", String(value)); }

  get autostart(): boolean { return this.hasAttribute("autostart"); }
  set autostart(value: boolean) { this._toggleAttr("autostart", value); }

  get keepAlive(): boolean { return this.hasAttribute("keep-alive"); }
  set keepAlive(value: boolean) { this._toggleAttr("keep-alive", value); }

  /** The internal preview `<video>` (for advanced styling/measurement). */
  get videoElement(): HTMLVideoElement { return this._video; }

  // --- Core delegated getters ---

  get active(): boolean { return this._core.active; }
  get permission(): MediaPermissionState { return this._core.permission; }
  get audioPermission(): MediaPermissionState | null { return this._core.audioPermission; }
  get devices(): MediaDeviceSnapshot[] { return this._core.devices; }
  get error(): WcsMediaErrorDetail | null { return this._core.error; }
  /** The last failure's serializable `WcsIoErrorInfo` (Phase 6 taxonomy), or null. */
  get errorInfo(): WcsIoErrorInfo | null { return this._core.errorInfo; }

  get connectedCallbackPromise(): Promise<void> { return this._connectedCallbackPromise; }

  // --- Commands ---

  start(): void { this._core.start(); }
  stop(): void { this._core.stop(); }

  /**
   * Toggle the front/back camera by updating the DOM attributes (the single source
   * of truth), not just the Core's internal constraints. Deliberately does NOT call
   * `CameraCore.switchCamera()` (which would mutate the Core's constraints behind the
   * DOM's back, leaving the declared attributes stale). `device-id` is removed because
   * it would otherwise take precedence over `facing-mode` (see buildConstraints) —
   * leaving it pinned would silently undo the switch on the next re-acquire. Both
   * attribute writes are batched (see `_batchingAttrs`) so they drive exactly ONE
   * re-acquire here, with the final constraints — never an early acquire on a
   * half-updated state. The DOM and the live camera stay in agreement.
   */
  switchCamera(): void {
    const next: FacingMode = this.facingMode === "environment" ? "user" : "environment";
    this._batchingAttrs = true;
    try {
      this.removeAttribute("device-id");
      this.setAttribute("facing-mode", next);
    } finally {
      this._batchingAttrs = false;
    }
    // Sync the (now-final) constraints and re-acquire once when a stream is live —
    // the same `active`-guarded restart attributeChangedCallback performs.
    this._core.observe(this._constraints());
    if (this._core.active) {
      this._core.start();
    }
  }

  // --- Internal ---

  private _toggleAttr(name: string, value: boolean): void {
    if (value) {
      this.setAttribute(name, "");
    } else {
      this.removeAttribute(name);
    }
  }

  private _numberAttr(name: string): number {
    const attr = this.getAttribute(name);
    if (attr === null || attr.trim() === "") return NaN;
    const parsed = Number(attr);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  private _constraints(): CameraConstraints {
    const c: CameraConstraints = { audio: this.audio, facingMode: this.facingMode };
    if (this.deviceId) c.deviceId = this.deviceId;
    if (Number.isFinite(this.width)) c.width = this.width;
    if (Number.isFinite(this.height)) c.height = this.height;
    return c;
  }

  private _onStreamReady = (event: CustomEvent): void => {
    this._video.srcObject = event.detail as MediaStream;
  };

  private _onActiveChanged = (event: CustomEvent): void => {
    // Clear the preview when the stream is released so the last frame does not stick.
    if (event.detail === false) {
      this._video.srcObject = null;
    }
  };

  // --- Lifecycle ---

  connectedCallback(): void {
    this._connected = true;
    this._connectedCallbackPromise = this._core.observe(this._constraints());
    if (this.autostart) {
      this._core.start();
    }
    document.addEventListener("visibilitychange", this._onVisibilityChange);
  }

  disconnectedCallback(): void {
    this._connected = false;
    document.removeEventListener("visibilitychange", this._onVisibilityChange);
    this._core.dispose();
  }

  attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null): void {
    if (!this._connected || oldValue === newValue) return;
    // While switchCamera() batches several attribute writes, defer to its single
    // post-batch re-acquire — otherwise the first write would acquire on stale
    // constraints (see `_batchingAttrs`).
    if (this._batchingAttrs) return;
    // Track the new constraints (and reconcile the microphone watcher).
    this._core.observe(this._constraints());
    // A constraints change re-acquires (switchMap-style restart) only when a stream
    // is actually live. `active` is the deliberate guard (not `desired`): `active`
    // implies `desired` (a stream only goes live under desired), so re-acquiring
    // cannot spuriously re-`desired` a stopped camera. Guarding on `active` rather
    // than `desired` also avoids force-acquiring while suspended/hidden (desired but
    // not active) — the visibility handler owns resume there.
    if (this._core.active) {
      this._core.start();
    }
  }

  private _onVisibilityChange = (): void => {
    if (this.keepAlive) return;
    if (document.visibilityState === "hidden") {
      this._core.suspend();
    } else {
      this._core.resume();
    }
  };
}
