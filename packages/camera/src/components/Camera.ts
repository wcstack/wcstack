import {
  IWcBindable, CameraConstraints, FacingMode, MediaDeviceSnapshot, MediaPermissionState,
  WcsMediaErrorDetail,
} from "../types.js";
import { CameraCore } from "../core/CameraCore.js";

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

  static observedAttributes = ["facing-mode", "device-id", "audio", "width", "height"];

  private _core: CameraCore;
  private _video: HTMLVideoElement;
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();
  private _connected: boolean = false;

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
    // Bind the live handle to the preview internally — never through state.
    this.addEventListener("wcs-camera:stream-ready", this._onStreamReady as EventListener);
    this.addEventListener("wcs-camera:active-changed", this._onActiveChanged as EventListener);
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

  get connectedCallbackPromise(): Promise<void> { return this._connectedCallbackPromise; }

  // --- Commands ---

  start(): void { this._core.start(); }
  stop(): void { this._core.stop(); }
  switchCamera(): void { this._core.switchCamera(); }

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
    // Track the new constraints (and reconcile the microphone watcher).
    this._core.observe(this._constraints());
    // A constraints change re-acquires (switchMap-style restart) only when active.
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
