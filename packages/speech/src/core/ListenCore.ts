import {
  IWcBindable, ListenOptions, ListenPermissionState,
  WcsListenResultDetail, WcsListenAlternative, WcsListenErrorDetail,
} from "../types.js";

// The vendor-prefixed constructor is not in the DOM lib types; declare a minimal
// shape so we can feature-detect and construct it.
// Minimal structural shapes for the recognition result/error events. The DOM lib
// does not ship the prefixed API's types, so we declare just the fields read here
// instead of using `any`, keeping the handlers type-checked and consistent with
// the typed state fields. All fields are optional/loose because real engines vary
// (resultIndex / charLength omitted, malformed events) and the handlers already
// defend against that at runtime.
interface RecognitionAlternativeLike {
  transcript?: string;
  confidence?: number;
}
interface RecognitionResultLike {
  readonly length: number;
  isFinal?: boolean;
  [index: number]: RecognitionAlternativeLike;
}
interface RecognitionResultListLike {
  readonly length: number;
  [index: number]: RecognitionResultLike;
}
interface RecognitionResultEventLike {
  results: RecognitionResultListLike;
  resultIndex?: number;
}
interface RecognitionErrorEventLike {
  error?: string;
}

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: ((event: Event) => void) | null;
  onend: ((event: Event) => void) | null;
  onresult: ((event: RecognitionResultEventLike) => void) | null;
  onerror: ((event: RecognitionErrorEventLike) => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

/**
 * Headless speech-to-text primitive. A thin, framework-agnostic wrapper around
 * the SpeechRecognition API (vendor-prefixed `webkitSpeechRecognition` in
 * Chrome) exposed through the wc-bindable protocol.
 *
 * It is the "event" half of the speech package (the synthesis half is
 * SpeakCore): recognition results flow element → state.
 *
 * Two phases mirror geolocation:
 * - **one-shot** (`continuous = false`) — recognize until the first `end`.
 * - **continuous** (`continuous = true`) — keep a single session open across
 *   phrases. The browser still ends a session on silence; auto-restart bridges
 *   that gap **but is opt-in via `maxRestarts`**: with the default `maxRestarts
 *   = 0` a continuous session is *not* restarted on `end` (the safe default —
 *   unbounded restart is the infinite-loop risk we guard against). Set
 *   `maxRestarts > 0` to bridge N silences. The cap also stops a persistent
 *   failure (e.g. `not-allowed`) from spinning forever or exhausting quota; a
 *   real result resets the budget so only consecutive empty restarts count.
 *
 * A microphone permission gate (like geolocation's) reflects
 * `navigator.permissions.query({ name: "microphone" })`. Failures never throw —
 * they surface through the `error` property.
 */
export class ListenCore extends EventTarget {
  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [
      { name: "interimTranscript", event: "wcs-listen:interim-changed" },
      { name: "finalTranscript", event: "wcs-listen:final-changed" },
      { name: "result", event: "wcs-listen:result" },
      { name: "listening", event: "wcs-listen:listening-changed" },
      { name: "permission", event: "wcs-listen:permission-changed" },
      { name: "error", event: "wcs-listen:error" },
      { name: "unsupported", event: "wcs-listen:unsupported-changed" },
    ],
    commands: [
      { name: "start" },
      { name: "stop" },
      { name: "abort" },
    ],
  };

  private _target: EventTarget;
  private _recognition: SpeechRecognitionLike | null = null;

  private _interimTranscript: string = "";
  private _finalTranscript: string = "";
  private _result: WcsListenResultDetail | null = null;
  private _listening: boolean = false;
  private _permission: ListenPermissionState = "prompt";
  private _error: WcsListenErrorDetail | null = null;
  private _unsupported: boolean = false;

  // Intent flag: true between start() and stop()/abort()/terminal-error. Gates
  // the auto-restart loop so a session that ended because the user stopped it
  // does not restart.
  private _active: boolean = false;
  private _continuous: boolean = false;
  private _maxRestarts: number = 0;
  private _restartCount: number = 0;

  // Permission tracking — same machinery as GeolocationCore.
  private _permissionStatus: PermissionStatus | null = null;
  private _permissionSubscribed: boolean = false;
  private _permGen: number = 0;

  // SSR: feature detection (`_setUnsupported`) is synchronous and the permission
  // `change` subscription is established eagerly in the constructor, so there is
  // no asynchronous probe to await before snapshotting — readiness is immediate.
  // The Shell exposes this as connectedCallbackPromise.
  private _ready: Promise<void> = Promise.resolve();

  constructor(target?: EventTarget) {
    super();
    this._target = target ?? this;
    const Ctor = this._getCtor();
    this._setUnsupported(!Ctor);
    if (Ctor) {
      this._recognition = new Ctor();
      this._attachHandlers(this._recognition);
    }
    this._initPermission();
  }

  get interimTranscript(): string {
    return this._interimTranscript;
  }

  get finalTranscript(): string {
    return this._finalTranscript;
  }

  get result(): WcsListenResultDetail | null {
    return this._result;
  }

  get listening(): boolean {
    return this._listening;
  }

  get permission(): ListenPermissionState {
    return this._permission;
  }

  get error(): WcsListenErrorDetail | null {
    return this._error;
  }

  // Resolved once in the constructor (`_setUnsupported(!Ctor)`) and never
  // re-evaluated: the SpeechRecognition API's presence is immutable for the
  // lifetime of a document, so there's nothing to re-check.
  get unsupported(): boolean {
    return this._unsupported;
  }

  /** Resolves once the first probe settles (immediate — see `_ready`). */
  get ready(): Promise<void> {
    return this._ready;
  }

  // --- State setters with event dispatch ---

  private _setInterim(value: string): void {
    if (this._interimTranscript === value) return;
    this._interimTranscript = value;
    this._target.dispatchEvent(new CustomEvent("wcs-listen:interim-changed", { detail: value, bubbles: true }));
  }

  private _setFinal(value: string): void {
    if (this._finalTranscript === value) return;
    this._finalTranscript = value;
    this._target.dispatchEvent(new CustomEvent("wcs-listen:final-changed", { detail: value, bubbles: true }));
  }

  private _setResult(value: WcsListenResultDetail): void {
    this._result = value;
    this._target.dispatchEvent(new CustomEvent("wcs-listen:result", { detail: value, bubbles: true }));
  }

  private _setListening(value: boolean): void {
    if (this._listening === value) return;
    this._listening = value;
    this._target.dispatchEvent(new CustomEvent("wcs-listen:listening-changed", { detail: value, bubbles: true }));
  }

  private _setPermission(value: ListenPermissionState): void {
    if (this._permission === value) return;
    this._permission = value;
    this._target.dispatchEvent(new CustomEvent("wcs-listen:permission-changed", { detail: value, bubbles: true }));
  }

  private _setError(value: WcsListenErrorDetail | null): void {
    if (this._error === value) return;
    this._error = value;
    this._target.dispatchEvent(new CustomEvent("wcs-listen:error", { detail: value, bubbles: true }));
  }

  private _setUnsupported(value: boolean): void {
    if (this._unsupported === value) return;
    this._unsupported = value;
    this._target.dispatchEvent(new CustomEvent("wcs-listen:unsupported-changed", { detail: value, bubbles: true }));
  }

  // --- Public API ---

  /**
   * Begin a recognition session. Resets the transcripts (a fresh, user-initiated
   * listen), applies options, and starts. Idempotent while already listening: a
   * redundant start() is ignored so the browser does not throw "recognition has
   * already started".
   */
  start(options: ListenOptions = {}): void {
    if (!this._recognition) {
      this._setError(this._unsupportedError());
      return;
    }
    if (this._active) return;

    this._continuous = options.continuous ?? false;
    // `maxRestarts` is a restart *count*, so floor any fractional input to an
    // integer (e.g. 2.5 → 2). `_restartCount` increments by 1, so a fractional
    // cap would otherwise compare inconsistently. Non-finite/negative → 0.
    this._maxRestarts = typeof options.maxRestarts === "number" && options.maxRestarts >= 0
      ? Math.floor(options.maxRestarts)
      : 0;
    this._restartCount = 0;
    this._recognition.lang = options.lang ?? "";
    this._recognition.continuous = this._continuous;
    this._recognition.interimResults = options.interimResults ?? false;
    if (typeof options.maxAlternatives === "number") {
      this._recognition.maxAlternatives = options.maxAlternatives;
    }

    // Fresh session: clear prior transcripts and error.
    this._setInterim("");
    this._setFinal("");
    this._setError(null);
    this._active = true;
    this._safeStart();
  }

  stop(): void {
    if (!this._recognition) return;
    // Clear intent first so the end handler does not auto-restart.
    this._active = false;
    this._recognition.stop();
  }

  abort(): void {
    if (!this._recognition) return;
    this._active = false;
    this._recognition.abort();
  }

  /**
   * Re-establish the permission `change` subscription after a dispose().
   */
  reinitPermission(): void {
    if (!this._permissionSubscribed) {
      this._initPermission();
    }
  }

  /**
   * Establish monitoring (§3.5). Recognition is command-driven (start/stop), so
   * observe() only (re-)establishes the live permission subscription — idempotent
   * via reinitPermission()'s `_permissionSubscribed` guard, so the first connect
   * after construction does not double-subscribe while a reconnect after dispose()
   * does. Returns the `ready` promise for SSR. Call from the Shell's
   * connectedCallback.
   */
  observe(): Promise<void> {
    this.reinitPermission();
    return this._ready;
  }

  /**
   * Stop recognition and detach the live permission listener. Call from the
   * Shell's `disconnectedCallback`.
   */
  dispose(): void {
    // Only the live subscriptions and the listening shadow are reset here. The
    // observable snapshot (transcripts / result / error) is intentionally *kept*
    // so a reparented element preserves its last state, mirroring how
    // GeolocationCore.dispose() leaves `position` / `error` intact. The next
    // start() clears the transcripts and error for its fresh session anyway.
    this._active = false;
    this._permissionSubscribed = false;
    this._permGen++;
    if (this._recognition) {
      // abort() is the immediate teardown; guard against environments where it
      // throws on an idle recognizer.
      try {
        this._recognition.abort();
      } catch {
        // ignore — teardown is best-effort.
      }
    }
    // Reset the listening shadow silently (no dispatch on a disposed element),
    // mirroring GeolocationCore's `_loading` reset. The abort() above neutralizes
    // the recognizer but its `end` (which would clear listening via the setter)
    // may not have fired yet; forcing false here means a reconnect+start's
    // `onstart` still transitions false→true through the same-value guard, so the
    // state never desyncs to a stale `true`.
    this._listening = false;
    if (this._permissionStatus) {
      this._permissionStatus.removeEventListener("change", this._onPermissionChange);
      this._permissionStatus = null;
    }
  }

  // --- Internal: recognition lifecycle ---

  private _attachHandlers(recognition: SpeechRecognitionLike): void {
    recognition.onstart = (): void => {
      this._setListening(true);
    };
    recognition.onresult = (event: RecognitionResultEventLike): void => {
      try {
        this._handleResult(event);
      } catch {
        // A malformed result event must not escape the browser callback.
      }
    };
    recognition.onerror = (event: RecognitionErrorEventLike): void => {
      this._setError(this._normalizeError(event));
      // Terminal errors must not be retried — they would spin the restart loop.
      // The set is deliberately limited to the permission-class errors that can
      // never self-recover within a session. Transient failures
      // (`network` / `audio-capture` / `no-speech`) are intentionally *not*
      // terminal: they are recoverable, so a continuous session restarts through
      // them, bounded by `maxRestarts` (the cap is the guard against a persistent
      // transient failure spinning forever).
      if (event && (event.error === "not-allowed" || event.error === "service-not-allowed")) {
        this._active = false;
      }
    };
    recognition.onend = (): void => {
      if (this._active && this._continuous && this._restartCount < this._maxRestarts) {
        // Auto-restart bridges a silence-induced `end`. Keep `listening` true
        // across the gap rather than flickering true→false→true: from the
        // consumer's perspective the continuous session never stopped. The
        // immediately-following start()'s `onstart` re-sets true (same-value
        // guarded → no-op), so the flag stays steady. A genuine stop (no
        // restart) still drops to false below.
        this._restartCount++;
        this._safeStart();
        // _safeStart() clears _active if the restart threw; in that case the
        // session is over, so reflect listening=false rather than leaving it
        // stuck true.
        if (!this._active) this._setListening(false);
        return;
      }
      // No restart: the session is fully over.
      this._setListening(false);
      this._active = false;
    };
  }

  private _handleResult(event: RecognitionResultEventLike): void {
    const results = event.results;
    let interim = "";
    let finalChunk = "";
    // Per the Web Speech spec, `resultIndex` is the lowest index in `results`
    // that changed in this event, so we only fold in `[resultIndex, length)` and
    // accumulate finals (`this._finalTranscript + finalChunk`). This assumes the
    // engine advances `resultIndex` past already-finalized results. A nonconforming
    // engine that omits `resultIndex` (`?? 0`) or re-reports finalized results at
    // index 0 on every event could double-accumulate the same final chunk; standard
    // browser engines don't, so this is not hardened against here.
    for (let i = event.resultIndex ?? 0; i < results.length; i++) {
      const res = results[i];
      const transcript = res?.[0]?.transcript ?? "";
      if (res?.isFinal) {
        finalChunk += transcript;
      } else {
        interim += transcript;
      }
    }
    if (finalChunk !== "") {
      this._setFinal(this._finalTranscript + finalChunk);
    }
    this._setInterim(interim);
    // Any result is progress — reset the restart budget so only *consecutive*
    // empty restarts count toward the cap.
    this._restartCount = 0;

    const last = results[results.length - 1];
    if (last) {
      this._setResult(this._normalizeResult(last));
    }
  }

  private _normalizeResult(result: RecognitionResultLike): WcsListenResultDetail {
    const alternatives: WcsListenAlternative[] = [];
    for (let i = 0; i < result.length; i++) {
      alternatives.push({
        transcript: result[i]?.transcript ?? "",
        confidence: result[i]?.confidence ?? 0,
      });
    }
    const top = alternatives[0] ?? { transcript: "", confidence: 0 };
    return {
      transcript: top.transcript,
      confidence: top.confidence,
      isFinal: !!result.isFinal,
      alternatives,
    };
  }

  private _safeStart(): void {
    try {
      this._recognition!.start();
    } catch {
      // start() throws if already started; surface nothing — the live session
      // continues. Reset intent so state stays consistent.
      this._active = false;
    }
  }

  // --- Internal: feature detection & permission (mirrors GeolocationCore) ---

  private _getCtor(): SpeechRecognitionCtor | null {
    // Guard window access without a separate (in-browser unreachable) early
    // return, mirroring SpeakCore's `_hasApi` style.
    const w = (typeof window === "undefined" ? undefined : window) as unknown as {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    } | undefined;
    return w?.SpeechRecognition ?? w?.webkitSpeechRecognition ?? null;
  }

  private _initPermission(): void {
    if (typeof navigator === "undefined" || !navigator.permissions || typeof navigator.permissions.query !== "function") {
      this._setPermission("unsupported");
      return;
    }
    this._permissionSubscribed = true;
    const gen = ++this._permGen;
    navigator.permissions.query({ name: "microphone" as PermissionName }).then(
      (status) => {
        if (gen !== this._permGen) return;
        this._permissionStatus = status;
        this._setPermission(status.state as ListenPermissionState);
        status.addEventListener("change", this._onPermissionChange);
      },
      () => {
        if (gen !== this._permGen) return;
        this._setPermission("unsupported");
      },
    );
  }

  private _onPermissionChange = (event: Event): void => {
    const status = event.target as PermissionStatus;
    this._setPermission(status.state as ListenPermissionState);
  };

  private _normalizeError(event: RecognitionErrorEventLike): WcsListenErrorDetail {
    const error = (event && event.error) ? event.error : "aborted";
    return { error, message: `Speech recognition failed: ${error}.` };
  }

  private _unsupportedError(): WcsListenErrorDetail {
    return { error: "unsupported", message: "SpeechRecognition API is not available in this environment." };
  }
}
