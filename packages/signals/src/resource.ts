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
    const a = (options.args ? options.args() : undefined) as A;

    // Abort the previous request before starting the next (switchMap).
    controller?.abort();
    const ac = new AbortController();
    controller = ac;

    loading.set(true);
    error.set(null);

    Promise.resolve(source(a, ac.signal)).then(
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
