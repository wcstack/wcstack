// Stream resource (PoC §8 (a)). The signals-side counterpart of the state-side
// `$streams` adapter (docs/state-stream-type-design.md).
//
// Adapts a continuous async flow (async iterable / ReadableStream / async
// generator) into a single reactive value by FOLDING each chunk:
//   - latest (default): replace — value becomes the last chunk.
//   - reduce: accumulate — value = fold(acc, chunk), needs `initial`.
// When the resource's `args` change, the in-flight stream is aborted and a fresh
// one starts (switchMap), with `value` reset to `initial`.
//
// Deliberate non-goal: backpressure. The fold result IS the buffer; demand does
// not flow back to the producer. Unbounded accumulation of an infinite stream is
// a footgun — bound the fold (latest / count / last-N / window) for live streams.
// This mirrors the state `$streams` norm and is what lets the impedance mismatch
// be resolved honestly (state-stream §0, §4-3).
//
// Shared contract with state `$streams` (settled by this PoC):
//   - source(args, signal) receives an AbortSignal; honoring it drives restart.
//   - restart RESETS value to `initial`; error KEEPS the last value.
//   - status companion: "idle" | "active" | "done" | "error".
//   - async iterable is the lingua franca; a ReadableStream lacking
//     Symbol.asyncIterator is read via getReader().
//
// CAVEAT (cooperative cancellation): for a ReadableStream we force-unwind a parked
// read() on abort via reader.cancel(). A plain AsyncIterable / async generator has
// no such hook — if it ignores `signal` and parks (awaiting before the next yield),
// the for-await never resolves, so the consume() task and any resource it holds stay
// alive past restart/dispose. The `if (signal.aborted) return` check only runs after
// a chunk arrives, not while parked. Bound by honoring `signal` in the source.

import { signal, effect, onCleanup, ReadSignal, WriteSignal } from "./reactive.js";

export type StreamStatus = "idle" | "active" | "done" | "error";

export interface StreamResourceState<T> {
  value: ReadSignal<T | undefined>;
  // Progress is an ENUM here, intentionally different from resource's `loading`
  // boolean: a continuous stream moves idle → active → done/error, which a boolean
  // cannot express. The cancel/restart contract is shared with `resource` and the
  // state-side `$streams` adapter; the progress representation is not.
  status: ReadSignal<StreamStatus>;
  error: ReadSignal<unknown>;
  /** Abort the in-flight stream and stop reacting to `args`. */
  dispose(): void;
}

export interface StreamResourceOptions<T, C, A> {
  /** Reactive inputs. Reading signals here wires restart-on-change. */
  args?: () => A;
  /** Combine the running value with each chunk. Default: latest (replace). */
  fold?: (acc: T | undefined, chunk: C) => T;
  /** Seed value, and the value `value` is reset to on each (re)start. */
  initial?: T;
}

export type StreamProducer<C> = AsyncIterable<C> | ReadableStream<C>;

export type StreamSource<C, A> = (
  args: A,
  signal: AbortSignal,
) => StreamProducer<C> | Promise<StreamProducer<C>>;

export function streamResource<T, C = T, A = void>(
  source: StreamSource<C, A>,
  options: StreamResourceOptions<T, C, A> = {},
): StreamResourceState<T> {
  const fold = options.fold ?? ((_acc: T | undefined, chunk: C) => chunk as unknown as T);
  const value = signal<T | undefined>(options.initial);
  const status = signal<StreamStatus>("idle");
  const error = signal<unknown>(null);

  let controller: AbortController | null = null;

  const runner = effect(() => {
    // NOTE (effect-internal writes): like `resource`, this effect writes
    // value/status/error — signals other effects may observe. Those observers are
    // queued on the same flush and run in the same tick. This effect never reads
    // those signals, so it does not dirty its own dependency (no cycle). The async
    // `consume` writes them later from microtasks/timers, outside this flush.
    const a = (options.args ? options.args() : undefined) as A;

    controller?.abort();
    const ac = new AbortController();
    controller = ac;

    // Reset for the new run: a restart starts the fold from `initial`.
    value.set(options.initial);
    error.set(null);
    status.set("active");

    void consume(source, a, ac.signal, fold, value, status, error);
  });

  const dispose = (): void => {
    controller?.abort();
    runner.dispose();
  };
  onCleanup(dispose);

  return { value, status, error, dispose };
}

async function consume<T, C, A>(
  source: StreamSource<C, A>,
  args: A,
  signal: AbortSignal,
  fold: (acc: T | undefined, chunk: C) => T,
  // Use the public WriteSignal type instead of re-declaring an inline subset, so
  // these stay in lockstep with the signal API (no structural drift).
  value: WriteSignal<T | undefined>,
  status: WriteSignal<StreamStatus>,
  error: WriteSignal<unknown>,
): Promise<void> {
  try {
    const produced = await source(args, signal);
    for await (const chunk of iterate(produced, signal)) {
      if (signal.aborted) {
        return; // stale chunk from a superseded/disposed run — drop it
      }
      value.set(fold(value.peek(), chunk));
    }
    if (signal.aborted) {
      return; // stream ended but this run was aborted — don't mark done
    }
    status.set("done");
  } catch (e) {
    if (signal.aborted) {
      return; // an abort that surfaced as a throw is not an error
    }
    error.set(e); // keep the last folded value (do not reset)
    status.set("error");
  }
}

function iterate<C>(produced: StreamProducer<C>, signal: AbortSignal): AsyncIterable<C> {
  if (typeof (produced as AsyncIterable<C>)[Symbol.asyncIterator] === "function") {
    return produced as AsyncIterable<C>;
  }
  // Not async-iterable: must be a ReadableStream (read via getReader). Validate so
  // a wrong source value yields a clear error instead of an opaque "getReader is
  // not a function" from inside the generator.
  if (typeof (produced as ReadableStream<C>)?.getReader !== "function") {
    throw new TypeError(
      "streamResource: source must return an AsyncIterable or a ReadableStream (got neither).",
    );
  }
  return readableToAsyncIterable(produced as ReadableStream<C>, signal);
}

async function* readableToAsyncIterable<C>(
  stream: ReadableStream<C>,
  signal: AbortSignal,
): AsyncGenerator<C> {
  const reader = stream.getReader();
  // A ReadableStream read() does NOT observe an AbortSignal on its own. Without
  // this, a switchMap restart / dispose leaves the previous reader parked in a
  // pending read() forever, leaking the underlying source. Cancelling on abort
  // both releases the source AND settles the pending read() so the for-await
  // unwinds and the finally below can release the lock. Abort is the only
  // early-exit path for this generator (the consumer never calls .return()
  // without aborting), so this is the sole place a non-drained stream is cancelled.
  const onAbort = (): void => {
    void reader.cancel().catch(() => {}); // tearing down; swallow a rejected cancel
  };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        return;
      }
      yield value as C;
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}
