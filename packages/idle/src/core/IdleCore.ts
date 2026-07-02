import { IdleScreenState, IdleUserState, IWcBindable } from "../types.js";

interface IdleDetectorLike extends EventTarget {
  userState: IdleUserState;
  screenState: IdleScreenState;
  start(options: { threshold: number; signal: AbortSignal }): Promise<void>;
}

interface IdleDetectorCtor {
  new (): IdleDetectorLike;
  requestPermission(): Promise<"granted" | "denied">;
}

const MIN_THRESHOLD = 60000;

/**
 * Headless Idle Detection primitive. A thin, framework-agnostic wrapper around
 * `IdleDetector` exposed through the wc-bindable protocol.
 *
 * Reference implementation for batch2's "gesture-gated permission" archetype
 * (docs/idle-detection-tag-design.md). `requestPermission()` wraps the static,
 * user-gesture-gated `IdleDetector.requestPermission()` — this Core never
 * calls it automatically; the caller must invoke it from within a real
 * gesture handler.
 *
 * Deliberately does NOT track the 4-value permission state (prompt/granted/
 * denied/unsupported) itself: `navigator.permissions.query({name:
 * "idle-detection"})` exists, so compose with `<wcs-permission
 * name="idle-detection">` for that instead (§0). This Core only exposes the
 * actual idle state (userState/screenState) plus the one-time
 * requestPermission()/start()/stop() actions.
 */
export class IdleCore extends EventTarget {
  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [
      { name: "userState", event: "wcs-idle:change", getter: (e: Event) => (e as CustomEvent).detail.userState },
      { name: "screenState", event: "wcs-idle:change", getter: (e: Event) => (e as CustomEvent).detail.screenState },
      {
        name: "active",
        event: "wcs-idle:change",
        getter: (e: Event) => (e as CustomEvent).detail.userState === "active",
      },
      // never-throw (§3.6): requestPermission()/start() failures land here
      // instead of rejecting/throwing. Mirrors every other bidirectional IO
      // node in this batch (fetch, share, screen-orientation).
      { name: "error", event: "wcs-idle:error" },
    ],
    inputs: [
      { name: "threshold" },
    ],
    commands: [
      { name: "requestPermission", async: true },
      { name: "start", async: true },
      { name: "stop" },
    ],
  };

  private _target: EventTarget;
  private _userState: IdleUserState | null = null;
  private _screenState: IdleScreenState | null = null;
  private _error: any = null;
  private _detector: IdleDetectorLike | null = null;
  private _abortController: AbortController | null = null;

  // Generation guard (§3.4): bumped on dispose()/stop() and each start().
  private _gen = 0;

  // SSR (§3.8): never auto-starts on connect, so there is no probe to await —
  // readiness is always immediate (docs/idle-detection-tag-design.md §7).
  private _ready: Promise<void> = Promise.resolve();

  constructor(target?: EventTarget) {
    super();
    this._target = target ?? this;
  }

  get ready(): Promise<void> {
    return this._ready;
  }

  get userState(): IdleUserState | null {
    return this._userState;
  }

  get screenState(): IdleScreenState | null {
    return this._screenState;
  }

  get active(): boolean {
    return this._userState === "active";
  }

  get error(): any {
    return this._error;
  }

  // Lifecycle (§3.5). observe() is a synchronous no-op: unlike most IO nodes,
  // this Core deliberately does NOT auto-start on connect (§6) — permission
  // is gesture-gated, so attempting start() before it is granted is
  // guaranteed to fail.
  observe(): Promise<void> {
    return this._ready;
  }

  dispose(): void {
    this.stop();
  }

  private _api(): IdleDetectorCtor | undefined {
    const g = globalThis as any;
    return typeof g.IdleDetector === "function" ? g.IdleDetector : undefined;
  }

  private _setState(userState: IdleUserState, screenState: IdleScreenState): void {
    if (this._userState === userState && this._screenState === screenState) return;
    this._userState = userState;
    this._screenState = screenState;
    this._target.dispatchEvent(new CustomEvent("wcs-idle:change", {
      detail: { userState, screenState },
      bubbles: true,
    }));
  }

  private _setError(error: any): void {
    if (this._error === error) return;
    this._error = error;
    this._target.dispatchEvent(new CustomEvent("wcs-idle:error", {
      detail: error,
      bubbles: true,
    }));
  }

  /**
   * Wraps the static, user-gesture-gated `IdleDetector.requestPermission()`.
   * MUST be invoked from within a real user gesture handler by the caller —
   * this Core cannot manufacture one. never-throw: a gesture-context
   * rejection resolves to `"denied"` and lands in `error`. Gesture violation
   * and an actual "denied" outcome are not distinguished — both mean "not
   * usable right now" (§4.1).
   */
  async requestPermission(): Promise<"granted" | "denied"> {
    const Ctor = this._api();
    if (!Ctor) {
      this._setError({ message: "IdleDetector is not supported in this browser" });
      return "denied";
    }
    try {
      const result = await Ctor.requestPermission();
      return result === "granted" ? "granted" : "denied";
    } catch (e) {
      this._setError({ error: e });
      return "denied";
    }
  }

  /**
   * Start an idle-detection session. `threshold` (ms) must be >= 60000 per
   * spec — not validated here (§3): an out-of-range value is left to the
   * browser's own TypeError, which never-throw absorbs into `error`.
   */
  async start(threshold: number = MIN_THRESHOLD): Promise<void> {
    this.stop(); // supersede any in-flight session (mirrors FetchCore's "cancel then start")

    const Ctor = this._api();
    if (!Ctor) {
      this._setError({ message: "IdleDetector is not supported in this browser" });
      return;
    }

    const ac = new AbortController();
    this._abortController = ac;
    const gen = ++this._gen;

    try {
      const detector = new Ctor();
      detector.addEventListener("change", this._onChange);
      this._detector = detector;
      await detector.start({ threshold, signal: ac.signal });
      if (gen !== this._gen) return; // stale (stop()/dispose() ran during the await)
      this._setError(null);
      this._setState(detector.userState, detector.screenState);
    } catch (e: any) {
      // No separate AbortError check: stop()/dispose() bump `_gen` *before*
      // calling `ac.abort()` (see stop() below), so a stop()-triggered
      // AbortError always has a stale `gen` here and is already caught by
      // the check above. The signal is private and never exposed, so an
      // AbortError from any other source cannot occur.
      if (gen !== this._gen) return;
      this._setError({ error: e });
    }
  }

  /** Stop the current session (if any) and detach its listener. Safe to call when not started. */
  stop(): void {
    this._gen++;
    this._abortController?.abort();
    this._abortController = null;
    if (this._detector) {
      this._detector.removeEventListener("change", this._onChange);
      this._detector = null;
    }
  }

  private _onChange = (event: Event): void => {
    const detector = event.target as IdleDetectorLike;
    this._setState(detector.userState, detector.screenState);
  };
}
