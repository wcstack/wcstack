import {
  IWcBindable, RecorderOptions, WcsMediaErrorDetail, WcsRecordedDetail,
} from "../types.js";
import { hasMediaRecorder, normalizeMediaError } from "../media/getUserMedia.js";

/**
 * Headless media-recording primitive. Wraps MediaRecorder, consuming a borrowed
 * `MediaStream` (received via `attachStream` over the direct channel — see
 * docs/camera-recorder-tag-design.md §2) and producing a `Blob` clip.
 *
 * Ownership: the stream is BORROWED, never owned. The Core never stops its tracks
 * — that is the camera's job (the acquirer owns release). Stopping here would tear
 * down a stream that may still be previewing.
 *
 * Output: `dataavailable` chunks are collected and assembled into one `Blob` on
 * stop, published via `wcs-recorder:recorded`. The `Blob` is structured-clone
 * friendly (a settled value, unlike MediaStream) so it may flow through state.
 * `objectURL` is a managed string — the Core revokes the previous URL before
 * issuing a new one and on dispose. Failures never throw.
 */
export class RecorderCore extends EventTarget {
  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [
      { name: "recording", event: "wcs-recorder:recording-changed" },
      { name: "paused", event: "wcs-recorder:paused-changed" },
      { name: "duration", event: "wcs-recorder:duration-changed" },
      { name: "mimeType", event: "wcs-recorder:mimetype-changed" },
      { name: "blob", event: "wcs-recorder:recorded", getter: (e: Event) => (e as CustomEvent).detail?.blob ?? null },
      { name: "objectURL", event: "wcs-recorder:recorded", getter: (e: Event) => (e as CustomEvent).detail?.objectURL ?? null },
      { name: "error", event: "wcs-recorder:error" },
      // event-token: detail = the assembled clip { blob, objectURL, mimeType, duration }.
      { name: "recorded", event: "wcs-recorder:recorded", getter: (e: Event) => (e as CustomEvent).detail },
      // event-token (timeslice mode): detail = the streamed Blob chunk.
      { name: "dataavailable", event: "wcs-recorder:dataavailable", getter: (e: Event) => (e as CustomEvent).detail },
    ],
    commands: [
      { name: "attachStream" },
      { name: "start" },
      { name: "stop" },
      { name: "pause" },
      { name: "resume" },
    ],
  };

  private _target: EventTarget;

  private _recording: boolean = false;
  private _paused: boolean = false;
  private _duration: number = 0;
  private _mimeType: string = "";
  private _blob: Blob | null = null;
  private _objectURL: string | null = null;
  private _error: WcsMediaErrorDetail | null = null;

  private _recorder: MediaRecorder | null = null;
  private _stream: MediaStream | null = null; // borrowed — never stopped here
  private _chunks: Blob[] = [];
  private _timeslice: boolean = false;
  private _startTime: number = 0;

  // Monotonic id of the current recording lifecycle. Bumped by every start() and
  // dispose(); each MediaRecorder callback bails if stale so a torn-down/restarted
  // recorder's late event cannot mutate state.
  private _gen: number = 0;

  constructor(target?: EventTarget) {
    super();
    this._target = target ?? this;
  }

  get recording(): boolean { return this._recording; }
  get paused(): boolean { return this._paused; }
  get duration(): number { return this._duration; }
  get mimeType(): string { return this._mimeType; }
  get blob(): Blob | null { return this._blob; }
  get objectURL(): string | null { return this._objectURL; }
  get error(): WcsMediaErrorDetail | null { return this._error; }

  // --- State setters ---

  private _setRecording(v: boolean): void {
    if (this._recording === v) return;
    this._recording = v;
    this._dispatch("wcs-recorder:recording-changed", v);
  }

  private _setPaused(v: boolean): void {
    if (this._paused === v) return;
    this._paused = v;
    this._dispatch("wcs-recorder:paused-changed", v);
  }

  private _setDuration(v: number): void {
    if (this._duration === v) return;
    this._duration = v;
    this._dispatch("wcs-recorder:duration-changed", v);
  }

  private _setMimeType(v: string): void {
    if (this._mimeType === v) return;
    this._mimeType = v;
    this._dispatch("wcs-recorder:mimetype-changed", v);
  }

  private _setError(error: WcsMediaErrorDetail | null): void {
    if (this._error === error) return;
    this._error = error;
    this._dispatch("wcs-recorder:error", error);
  }

  private _dispatch(type: string, detail: unknown): void {
    this._target.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }));
  }

  // --- Public API ---

  /**
   * Borrow a stream for recording (the direct-channel sink). Synchronous, no
   * await: the live handle is captured by reference and never stored in state.
   * Does NOT stop any previously-borrowed stream — ownership stays with the camera.
   */
  attachStream(stream: MediaStream): void {
    this._stream = stream;
  }

  /** Start recording the borrowed stream. Never throws — surfaces `error`. */
  start(options: RecorderOptions = {}): void {
    if (!hasMediaRecorder()) {
      this._setError({ name: "unsupported", message: "MediaRecorder is not available in this environment." });
      return;
    }
    if (!this._stream) {
      this._setError({ name: "NoStreamError", message: "No stream attached. Wire a camera's stream-ready to attachStream first." });
      return;
    }
    if (this._recording) return;

    const recOptions: MediaRecorderOptions = {};
    if (options.mimeType && this._isTypeSupported(options.mimeType)) {
      recOptions.mimeType = options.mimeType;
    }
    if (typeof options.audioBitsPerSecond === "number") recOptions.audioBitsPerSecond = options.audioBitsPerSecond;
    if (typeof options.videoBitsPerSecond === "number") recOptions.videoBitsPerSecond = options.videoBitsPerSecond;

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(this._stream, recOptions);
    } catch (error) {
      this._setError(normalizeMediaError(error));
      return;
    }

    const gen = ++this._gen;
    this._chunks = [];
    this._timeslice = typeof options.timeslice === "number" && options.timeslice > 0;

    recorder.ondataavailable = (event: BlobEvent): void => {
      if (gen !== this._gen) return;
      if (event.data && event.data.size > 0) {
        this._chunks.push(event.data);
        if (this._timeslice) {
          this._dispatch("wcs-recorder:dataavailable", event.data);
        }
      }
    };
    recorder.onstop = (): void => {
      if (gen !== this._gen) return;
      // When stopped while paused, `_duration` was already finalized in onpause —
      // recomputing _elapsed() here would wrongly include the paused gap (the
      // clock kept running but `_startTime` was not advanced). Keep the held value.
      if (!this._paused) this._setDuration(this._elapsed());
      this._assembleBlob();
      this._setPaused(false);
      this._setRecording(false);
    };
    recorder.onerror = (event: Event): void => {
      if (gen !== this._gen) return;
      const err = (event as unknown as { error?: unknown }).error;
      this._setError(normalizeMediaError(err ?? { name: "RecorderError" }));
    };
    recorder.onpause = (): void => {
      if (gen !== this._gen) return;
      this._setDuration(this._elapsed());
      this._setPaused(true);
    };
    recorder.onresume = (): void => {
      if (gen !== this._gen) return;
      this._startTime = this._now() - this._duration;
      this._setPaused(false);
    };

    this._recorder = recorder;
    this._setError(null);
    this._setMimeType(recorder.mimeType || recOptions.mimeType || "");
    this._startTime = this._now();
    this._setDuration(0);
    recorder.start(this._timeslice ? options.timeslice : undefined);
    this._setRecording(true);
  }

  /** Stop recording; the assembled Blob is published from the recorder's onstop. */
  stop(): void {
    if (this._recorder && this._recorder.state !== "inactive") {
      this._recorder.stop();
    }
  }

  pause(): void {
    if (this._recorder && this._recorder.state === "recording") {
      this._recorder.pause();
    }
  }

  resume(): void {
    if (this._recorder && this._recorder.state === "paused") {
      this._recorder.resume();
    }
  }

  /** Stop in-flight recording, revoke the last object URL, drop the borrowed stream. */
  dispose(): void {
    // Bump the generation first so the native stop()'s onstop (gen-guarded) does
    // not run on a disposed Core — then reset the recording flags directly here.
    this._gen++;
    if (this._recorder && this._recorder.state !== "inactive") {
      try {
        this._recorder.stop();
      } catch {
        // A recorder already torn down by the environment must not throw here.
      }
    }
    this._recorder = null;
    this._revokeUrl();
    // Drop the borrowed reference WITHOUT stopping its tracks — the camera owns it.
    this._stream = null;
    // Reset transient recording state silently (onstop was gen-guarded out above).
    this._recording = false;
    this._paused = false;
  }

  // --- Internal ---

  private _assembleBlob(): void {
    const blob = new Blob(this._chunks, this._mimeType ? { type: this._mimeType } : undefined);
    this._chunks = [];
    this._revokeUrl();
    const objectURL = this._createUrl(blob);
    this._blob = blob;
    this._objectURL = objectURL;
    const detail: WcsRecordedDetail = {
      blob,
      objectURL,
      mimeType: this._mimeType,
      duration: this._duration,
    };
    this._dispatch("wcs-recorder:recorded", detail);
  }

  private _revokeUrl(): void {
    if (this._objectURL && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
      URL.revokeObjectURL(this._objectURL);
    }
    this._objectURL = null;
  }

  private _createUrl(blob: Blob): string {
    if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
      return URL.createObjectURL(blob);
    }
    return "";
  }

  // Only called after hasMediaRecorder() has confirmed the API, so MediaRecorder
  // and its isTypeSupported are present.
  private _isTypeSupported(type: string): boolean {
    const MR = (globalThis as { MediaRecorder: { isTypeSupported(t: string): boolean } }).MediaRecorder;
    return MR.isTypeSupported(type);
  }

  // performance.now() is universally available wherever MediaRecorder runs
  // (browsers and the happy-dom test env), so no fallback guard is needed.
  private _now(): number {
    return performance.now();
  }

  private _elapsed(): number {
    return Math.max(0, Math.round(this._now() - this._startTime));
  }
}
