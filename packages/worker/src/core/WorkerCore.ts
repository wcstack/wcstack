import { IWcBindable, WcsWorkerErrorDetail, WcsWorkerStartOptions } from "../types.js";

/**
 * Headless Dedicated Worker primitive. A thin, framework-agnostic wrapper around
 * the `Worker` API exposed through the wc-bindable protocol.
 *
 * A Worker is a "headless async message-passing resource that owns a child
 * thread" — structurally identical to BroadcastCore (structured-clone payloads,
 * no wire encoding, `post` is a `state → element` command-token and an incoming
 * `message` is an `element → state` event-token) with one extra axis: this Core
 * *owns* the underlying resource, so `start()` / `terminate()` spawn and tear
 * down the thread, mirroring how WebSocketCore owns its socket.
 *
 * Message model is bus-style (fire-and-forget `post`, observe `message`), not
 * RPC: there is no request/response correlation. Payloads ride structured clone
 * with NO JSON round-trip (symmetrical with BroadcastCore, deliberately unlike
 * WebSocketCore). The Core never throws — a spawn failure (bad URL, CSP block,
 * absent `Worker`), a non-cloneable `post` (`DataCloneError`), a `post` with no
 * running worker (`InvalidStateError`), an uncaught worker error, and a
 * `messageerror` all flow through the `error` property.
 */
export class WorkerCore extends EventTarget {
  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [
      { name: "message", event: "wcs-worker:message" },
      { name: "error", event: "wcs-worker:error" },
      { name: "running", event: "wcs-worker:running-changed" },
    ],
    commands: [
      { name: "start" },
      { name: "post" },
      { name: "terminate" },
    ],
  };

  private _target: EventTarget;
  private _worker: Worker | null = null;
  private _message: any = null;
  private _error: WcsWorkerErrorDetail | null = null;
  private _running: boolean = false;

  // Spawn configuration, retained so an automatic restart can re-spawn the same
  // script with the same options.
  private _src: string = "";
  private _type: WorkerType = "module";
  private _name: string = "";

  // Restart-on-error bookkeeping (opt-in; bounded like WebSocketCore reconnect).
  // `_restartCount` is CUMULATIVE over the worker's lifetime: it counts every
  // restart since the last start() and is NOT reset by a period of stable
  // operation, so `_maxRestarts` bounds total restarts, not consecutive crashes.
  // It is reset to 0 only by start() (a fresh spawn / src switch).
  private _restartOnError: boolean = false;
  private _maxRestarts: number = Infinity;
  private _restartInterval: number = 0;
  private _restartCount: number = 0;
  private _restartTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(target?: EventTarget) {
    super();
    this._target = target ?? this;
  }

  get message(): any {
    return this._message;
  }

  get error(): WcsWorkerErrorDetail | null {
    return this._error;
  }

  get running(): boolean {
    return this._running;
  }

  // --- State setters with event dispatch ---

  // Deliberately NO same-value guard. An incoming message is an event, not
  // idempotent state: the worker posting the same value twice is two distinct
  // occurrences and must re-fire wcs-worker:message each time so a `message:`
  // binding and any `eventToken.message:` subscriber see both.
  private _setMessage(message: any): void {
    this._message = message;
    this._target.dispatchEvent(new CustomEvent("wcs-worker:message", {
      detail: message,
      bubbles: true,
    }));
  }

  // Same-value guard. `error` has no derived state, so suppressing redundant
  // null→null dispatches (e.g. a successful spawn clearing an already-null error)
  // avoids spurious events. Reference identity suffices: each failure builds a
  // fresh object and the clear path always passes null.
  private _setError(error: WcsWorkerErrorDetail | null): void {
    if (this._error === error) return;
    this._error = error;
    this._target.dispatchEvent(new CustomEvent("wcs-worker:error", {
      detail: error,
      bubbles: true,
    }));
  }

  // No same-value guard needed: every spawn (`start`, restart) goes through
  // `_spawn` (false→true) only after `_terminateWorker` (true→false, guarded by
  // `_worker`), so `running` only ever moves on a real transition.
  private _setRunning(running: boolean): void {
    this._running = running;
    this._target.dispatchEvent(new CustomEvent("wcs-worker:running-changed", {
      detail: running,
      bubbles: true,
    }));
  }

  // --- Public API ---

  /**
   * Spawn the worker from `src`. Any previously-spawned worker is terminated
   * first, so calling `start()` again with a different `src` switches scripts.
   * Idempotent on the same `src` (re-spawning the script we are already running
   * is pure churn) — this also absorbs the custom-element upgrade path where a
   * connected element with a `src` attribute triggers both
   * attributeChangedCallback and connectedCallback, calling start() twice. A
   * consequence of this guard: changing only the options (`type`, `name`,
   * restart-*) while running the same `src` is ignored — call `terminate()`
   * then `start()` to re-spawn with new options. Never throws: a spawn failure
   * surfaces through `error`.
   */
  start(src: string, options: WcsWorkerStartOptions = {}): void {
    if (!src) {
      this._setError({ name: "TypeError", message: "src is required." });
      return;
    }
    if (this._worker && this._src === src) return;

    this._clearRestartTimer();
    this._terminateWorker();

    this._src = src;
    this._type = options.type ?? "module";
    this._name = options.name ?? "";
    this._restartOnError = options.restartOnError ?? false;
    this._maxRestarts = options.maxRestarts ?? Infinity;
    this._restartInterval = options.restartInterval ?? 0;
    this._restartCount = 0;

    this._setError(null);
    this._spawn();
  }

  /**
   * Post a structured-cloneable value to the worker. The optional `transfer`
   * list moves ownership of `Transferable`s (ArrayBuffer, MessagePort, ...) — the
   * escape hatch the declarative layer cannot express. Never throws: a
   * non-cloneable value surfaces as `DataCloneError` and posting with no running
   * worker surfaces an `InvalidStateError`, both through `error`.
   */
  post(data: any, transfer?: Transferable[]): void {
    if (!this._worker) {
      this._setError({
        name: "InvalidStateError",
        message: "Worker is not running. Call start(src) before post().",
      });
      return;
    }
    try {
      if (transfer && transfer.length > 0) {
        this._worker.postMessage(data, transfer);
      } else {
        this._worker.postMessage(data);
      }
    } catch (err) {
      this._setError(this._normalizeError(err));
    }
  }

  /** Terminate the worker. Idempotent — a no-op when none is running. */
  terminate(): void {
    this._clearRestartTimer();
    this._terminateWorker();
  }

  /**
   * Tear the Core down for a disconnected Shell: terminate the worker and reset
   * the error shadow. Only the `error` clear is silent — it mutates the shadow
   * without dispatching. Terminating a *running* worker still dispatches
   * `wcs-worker:running-changed` (true→false) via `_terminateWorker`, so a
   * dispose on a worker that was live does emit one event on the (now
   * disconnected) element; only a no-op dispose (no worker running) is fully
   * silent.
   *
   * Asymmetry by design: `_message` is deliberately NOT reset. `error` is
   * transient state — a stale error from a previous worker would mislead after a
   * reconnect, so it is cleared. `message` is the last value received (an event
   * payload); it is retained as the Core's last-known datum and is naturally
   * overwritten by the next incoming message.
   */
  dispose(): void {
    this._clearRestartTimer();
    this._terminateWorker();
    this._error = null;
  }

  // --- Internal ---

  private _spawn(): void {
    try {
      this._worker = new Worker(this._src, { type: this._type, name: this._name || undefined });
    } catch (err) {
      this._setError(this._normalizeError(err));
      return;
    }
    this._worker.addEventListener("message", this._onMessage);
    this._worker.addEventListener("messageerror", this._onMessageError);
    this._worker.addEventListener("error", this._onError);
    this._setRunning(true);
  }

  private _onMessage = (event: MessageEvent): void => {
    this._setMessage(event.data);
  };

  // Fired when the worker posted a value this context cannot deserialize. The
  // event carries no usable payload, so report a synthetic DataError.
  private _onMessageError = (): void => {
    this._setError({
      name: "DataError",
      message: "Failed to deserialize a message received from the worker.",
    });
  };

  // An uncaught error inside the worker script. The worker itself stays alive
  // (the platform does not auto-terminate it), so restart-on-error explicitly
  // re-spawns a fresh worker when enabled and the bound is not exhausted.
  private _onError = (event: ErrorEvent): void => {
    this._setError({
      name: "Error",
      message: event.message || "Worker script error.",
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
    if (this._restartOnError && this._restartCount < this._maxRestarts) {
      this._scheduleRestart();
    }
  };

  private _scheduleRestart(): void {
    this._clearRestartTimer();
    this._restartTimer = setTimeout(() => {
      this._restartTimer = null;
      this._restartCount++;
      this._terminateWorker();
      // Clear the crash error BEFORE re-spawning so a successful restart leaves a
      // consistent running=true / error=null state (an `error` binding must not
      // keep showing the previous script's failure once the fresh worker is live).
      // Order matters: _spawn() re-sets `error` if the new spawn itself fails, so
      // a failed restart still surfaces its own error rather than null.
      this._setError(null);
      this._spawn();
    }, this._restartInterval);
  }

  private _clearRestartTimer(): void {
    if (this._restartTimer !== null) {
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
    }
  }

  private _terminateWorker(): void {
    if (!this._worker) return;
    this._worker.removeEventListener("message", this._onMessage);
    this._worker.removeEventListener("messageerror", this._onMessageError);
    this._worker.removeEventListener("error", this._onError);
    this._worker.terminate();
    this._worker = null;
    this._setRunning(false);
  }

  private _normalizeError(err: unknown): WcsWorkerErrorDetail {
    if (err instanceof Error) {
      // DOMException is an Error subclass; its `name` (DataCloneError, etc.) is
      // the meaningful discriminator for consumers switching on failure kind.
      return { name: err.name, message: err.message };
    }
    return { name: "Error", message: String(err) };
  }
}
