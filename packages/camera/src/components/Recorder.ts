import {
  IWcBindable, RecorderOptions, WcsMediaErrorDetail,
} from "../types.js";
import { RecorderCore } from "../core/RecorderCore.js";
import { WcsIoErrorInfo } from "../core/platformCapability.js";

/**
 * `<wcs-recorder>` — declarative media recording. Wraps RecorderCore and records a
 * borrowed `MediaStream` received via the `attachStream` command (the direct
 * channel from `<wcs-camera>`'s `stream-ready`). It never owns or stops the stream.
 *
 * Recording parameters (`mime-type` / `timeslice` / bitrates) are mirrored
 * attributes. The assembled clip is published as `wcs-recorder:recorded`
 * (`{ blob, objectURL, mimeType, duration }`) and the `blob` / `objectURL` value
 * properties — a settled `Blob` is a value and may flow through state.
 */
export class WcsRecorder extends HTMLElement {
  static hasConnectedCallbackPromise = true;
  static wcBindable: IWcBindable = {
    ...RecorderCore.wcBindable,
    // `mimeType` deliberately appears on TWO surfaces: as an output `property`
    // (inherited from RecorderCore — the browser-resolved recording type, event
    // `mimetype-changed`) and as an `input` (the `mime-type` request attribute). They
    // share a base name but are distinct directions: the property is read-only output
    // (getter → Core), the input is the write-only request (setter → attribute, read
    // back in _options()). See README "request vs. resolved".
    inputs: [
      { name: "mimeType", attribute: "mime-type" },
      { name: "timeslice", attribute: "timeslice" },
      { name: "audioBitsPerSecond", attribute: "audio-bits" },
      { name: "videoBitsPerSecond", attribute: "video-bits" },
    ],
    commands: RecorderCore.wcBindable.commands,
  };

  private _core: RecorderCore;
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();
  private _internals: ElementInternals | null = null;

  constructor() {
    super();
    this._core = new RecorderCore(this);
    this._internals = this._initInternals();
    this._wireStates({
      "wcs-recorder:recording-changed": (d) => ({ recording: d === true }),
      "wcs-recorder:paused-changed":    (d) => ({ paused: d === true }),
      "wcs-recorder:error":             (d) => ({ error: d != null }),
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

  get connectedCallbackPromise(): Promise<void> {
    return this._connectedCallbackPromise;
  }

  // --- Attribute accessors ---

  // `mimeType` is an OUTPUT value property (the Core-resolved recording type,
  // published via `wcs-recorder:mimetype-changed`), so the getter delegates to the
  // Core — NOT the `mime-type` input attribute. The attribute is a *request*: the
  // browser may pick a different type, or fill one in when none was requested, and
  // bindings must read the actual value. The input side is read straight from the
  // attribute in `_options()`. The setter still writes the request attribute.
  get mimeType(): string { return this._core.mimeType; }
  set mimeType(value: string) { this.setAttribute("mime-type", value); }

  get timeslice(): number { return this._numberAttr("timeslice"); }
  set timeslice(value: number) { this.setAttribute("timeslice", String(value)); }

  get audioBitsPerSecond(): number { return this._numberAttr("audio-bits"); }
  set audioBitsPerSecond(value: number) { this.setAttribute("audio-bits", String(value)); }

  get videoBitsPerSecond(): number { return this._numberAttr("video-bits"); }
  set videoBitsPerSecond(value: number) { this.setAttribute("video-bits", String(value)); }

  // --- Core delegated getters ---

  get recording(): boolean { return this._core.recording; }
  get paused(): boolean { return this._core.paused; }
  get duration(): number { return this._core.duration; }
  get blob(): Blob | null { return this._core.blob; }
  get objectURL(): string | null { return this._core.objectURL; }
  get error(): WcsMediaErrorDetail | null { return this._core.error; }
  /** The last failure's serializable `WcsIoErrorInfo` (Phase 6 taxonomy), or null. */
  get errorInfo(): WcsIoErrorInfo | null { return this._core.errorInfo; }

  // --- Commands ---

  /** Borrow a stream (the direct-channel sink). */
  attachStream(stream: MediaStream): void {
    this._core.attachStream(stream);
  }

  start(): void {
    this._core.start(this._options());
  }

  stop(): void { this._core.stop(); }
  pause(): void { this._core.pause(); }
  resume(): void { this._core.resume(); }

  // --- Internal ---

  private _numberAttr(name: string): number {
    const attr = this.getAttribute(name);
    if (attr === null || attr.trim() === "") return NaN;
    const parsed = Number(attr);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  private _options(): RecorderOptions {
    const o: RecorderOptions = {};
    // Read the requested type from the input attribute directly — `get mimeType()` is
    // the resolved OUTPUT value, not the request.
    const requested = this.getAttribute("mime-type") ?? "";
    if (requested) o.mimeType = requested;
    if (Number.isFinite(this.timeslice)) o.timeslice = this.timeslice;
    if (Number.isFinite(this.audioBitsPerSecond)) o.audioBitsPerSecond = this.audioBitsPerSecond;
    if (Number.isFinite(this.videoBitsPerSecond)) o.videoBitsPerSecond = this.videoBitsPerSecond;
    return o;
  }

  // --- Lifecycle ---

  connectedCallback(): void {
    this.style.display = "none";
    this._connectedCallbackPromise = this._core.observe();
  }

  disconnectedCallback(): void {
    this._core.dispose();
  }
}
