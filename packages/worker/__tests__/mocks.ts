/**
 * In-process fake Worker.
 *
 * happy-dom does not implement the `Worker` constructor, so tests install this
 * fake as the global. It records construction args and posted payloads, and
 * exposes imperative `emit*` helpers so a test can drive the three inbound
 * surfaces the Core listens on (`message`, `messageerror`, `error`). It
 * replicates the one platform semantic the Core depends on — `postMessage`
 * structured-clones its payload and throws `DataCloneError` synchronously for a
 * non-cloneable value.
 */
export class FakeWorker extends EventTarget {
  /** Every instance constructed this test (cleared by reset()). */
  static created: FakeWorker[] = [];
  /**
   * When set, the NEXT construction throws this value (one-shot) instead of
   * building an instance — used to exercise the spawn-failure path. Set to a
   * non-Error (e.g. a string) to also cover the error-normalization fallback.
   */
  static nextConstructError: unknown = null;

  static reset(): void {
    this.created = [];
    this.nextConstructError = null;
  }

  /** The most recently constructed live instance, or undefined. */
  static get last(): FakeWorker | undefined {
    return this.created[this.created.length - 1];
  }

  src: string;
  options: WorkerOptions | undefined;
  terminated = false;
  posted: Array<{ data: unknown; transfer?: Transferable[] }> = [];

  constructor(src: string | URL, options?: WorkerOptions) {
    super();
    if (FakeWorker.nextConstructError !== null) {
      const err = FakeWorker.nextConstructError;
      FakeWorker.nextConstructError = null;
      throw err;
    }
    this.src = String(src);
    this.options = options;
    FakeWorker.created.push(this);
  }

  postMessage(data: unknown, transfer?: Transferable[]): void {
    // structuredClone throws DataCloneError for non-cloneable values, mirroring
    // the platform — the Core catches it and surfaces it through `error`. Passing
    // `transfer` through also replicates the platform's "transfer detaches the
    // source buffer" semantic (e.g. a posted ArrayBuffer's byteLength becomes 0),
    // so a test can assert the source was actually moved, not copied.
    structuredClone(data, transfer ? { transfer } : undefined);
    this.posted.push({ data, transfer });
  }

  terminate(): void {
    this.terminated = true;
  }

  // --- Test drivers (simulate the worker thread posting back) ---

  emitMessage(data: unknown): void {
    this.dispatchEvent(makeMessageEvent("message", data));
  }

  emitMessageError(): void {
    this.dispatchEvent(new Event("messageerror"));
  }

  emitError(init: { message?: string; filename?: string; lineno?: number; colno?: number } = {}): void {
    this.dispatchEvent(makeErrorEvent(init));
  }
}

/**
 * Build a `message`-shaped event carrying `data`. We do not use the
 * `MessageEvent` constructor (uneven across DOM shims); the Core only reads
 * `event.data`, so a plain Event with a `data` field is sufficient and portable.
 */
function makeMessageEvent(type: string, data: unknown): MessageEvent {
  const event = new Event(type) as Event & { data: unknown };
  event.data = data;
  return event as MessageEvent;
}

/**
 * Build an `error`-shaped event. The Core reads `message` / `filename` /
 * `lineno` / `colno`; a plain Event with those fields is portable across shims
 * that lack a usable `ErrorEvent` constructor.
 */
function makeErrorEvent(init: { message?: string; filename?: string; lineno?: number; colno?: number }): ErrorEvent {
  const event = new Event("error") as Event & {
    message?: string; filename?: string; lineno?: number; colno?: number;
  };
  event.message = init.message;
  event.filename = init.filename;
  event.lineno = init.lineno;
  event.colno = init.colno;
  return event as ErrorEvent;
}

const ORIGINAL = (globalThis as { Worker?: unknown }).Worker;

/** Install the fake as the global Worker and clear its registry. */
export function installWorker(): void {
  FakeWorker.reset();
  (globalThis as { Worker?: unknown }).Worker = FakeWorker;
}

/** Remove Worker entirely, exercising the spawn-failure (ReferenceError) path. */
export function removeWorker(): void {
  (globalThis as { Worker?: unknown }).Worker = undefined;
}

/** Restore whatever Worker the host environment originally had. */
export function restoreWorker(): void {
  (globalThis as { Worker?: unknown }).Worker = ORIGINAL;
}
