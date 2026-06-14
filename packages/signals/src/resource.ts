// Async resource (PoC).
//
// Adapts an async producer into a reactive `{ value, loading, error }` triad —
// the same shape FetchCore exposes (value/loading/error). When the resource's
// `args` (a reactive getter) change, the in-flight request is aborted and a fresh
// one starts: dependency-driven cancel/restart, i.e. RxJS switchMap.
//
// This is the signals-side counterpart of the state-side `$streams` adapter
// (docs/state-stream-type-design.md §4-1). The hard part — making sure a stale
// response from a superseded request never lands on the new state — is handled
// here by checking `signal.aborted` before committing any result.

import { signal, effect, onCleanup, ReadSignal } from "./reactive.js";

export interface ResourceState<T> {
  value: ReadSignal<T | undefined>;
  // Progress is a BOOLEAN here, intentionally different from streamResource's
  // `status` enum. A resource is single-shot (one request → resolve/reject), so
  // its progress is binary: in-flight or not. A stream is continuous (idle →
  // active → done/error), so it needs the enum. The "shared contract" with the
  // state-side `$streams` adapter covers the cancel/restart SEMANTICS, not this
  // progress representation. (docs §8 (a)).
  loading: ReadSignal<boolean>;
  error: ReadSignal<unknown>;
  /** Abort any in-flight request and stop reacting to `args` changes. */
  dispose(): void;
}

export interface ResourceOptions<T, A> {
  /** Reactive inputs. Reading signals here wires restart-on-change. */
  args?: () => A;
  /** Seed value before the first resolution. */
  initial?: T;
}

export type ResourceSource<T, A> = (args: A, signal: AbortSignal) => Promise<T> | T;

export function resource<T, A = void>(
  source: ResourceSource<T, A>,
  options: ResourceOptions<T, A> = {},
): ResourceState<T> {
  const value = signal<T | undefined>(options.initial);
  const loading = signal<boolean>(false);
  const error = signal<unknown>(null);

  let controller: AbortController | null = null;

  const runner = effect(() => {
    // Reading args() inside the effect is what subscribes us to its signals, so a
    // change re-runs this body — that IS the restart trigger.
    //
    // NOTE (effect-internal writes): this effect writes loading/error/value, which
    // are signals OTHER effects may observe. A write that actually CHANGES the value
    // marks those observers stale and queues them on the same flush; the drain loop
    // then runs them in the same tick. (A same-value write — e.g. error.set(null)
    // when error is already null — is a no-op via the equality guard and notifies
    // nothing.) We never read these signals inside THIS effect, so we don't dirty
    // our own dependency — no cycle. (docs §8 (a)).
    const a = (options.args ? options.args() : undefined) as A;

    // Abort the previous request before starting the next (switchMap).
    controller?.abort();
    const ac = new AbortController();
    controller = ac;

    loading.set(true);
    error.set(null);

    // Call the source SYNCHRONOUSLY (so it receives ac.signal immediately and can
    // wire its abort listener before any teardown), but guard it with try/catch so
    // a synchronous throw is normalized into the same error/loading state as a
    // rejected promise. Without the guard a sync throw would escape the effect body
    // (and, on the initial run, the resource() call itself), leaving loading stuck
    // true and error unset.
    let produced: Promise<T> | T;
    try {
      produced = source(a, ac.signal);
    } catch (err) {
      error.set(err);
      loading.set(false);
      return;
    }

    Promise.resolve(produced).then(
      (resolved) => {
        // Drop the result if this request was superseded/disposed: committing it
        // would let a stale response overwrite the newer request's state.
        if (ac.signal.aborted) {
          return;
        }
        value.set(resolved);
        loading.set(false);
      },
      (err) => {
        if (ac.signal.aborted) {
          return;
        }
        error.set(err);
        loading.set(false);
      },
    );
  });

  const dispose = (): void => {
    controller?.abort();
    runner.dispose();
  };

  // Auto-dispose with the enclosing owner (createRoot / parent effect), so a
  // resource created inside a component is aborted on unmount. No-op when there
  // is no owner — the caller then disposes manually.
  onCleanup(dispose);

  return { value, loading, error, dispose };
}
