/**
 * stream/consumeSource.ts
 *
 * `$streams` のチャンク消費ループ（docs/state-streams-design.md §3-3）。
 * packages/signals/src/streamResource.ts の consume / iterate /
 * readableToAsyncIterable の移植（パッケージ間依存は持たない自己完結原則）。
 *
 * 唯一の構造差分は状態書き込みの IConsumeSink への委譲:
 *   value.set(fold(value.peek(), chunk)) → sink.fold(chunk)
 *   status.set("done")                   → sink.done()
 *   error.set(e) + status.set("error")   → sink.fail(e)
 *
 * sink.fold() が throw した場合（fold throw）もループ内の throw として
 * 既存の catch に流れ、signal.aborted なら return、でなければ sink.fail(e)。
 * consumeSource 自体は fold throw と source throw を区別しない
 * （producer の掃除 = controller.abort() は呼び出し側 runtime が fail 内で行う）。
 * consumeSource は reject しない（全経路 catch 済み）。
 *
 * ---------------------------------------------------------------------------
 * 以下、移植元モジュールヘッダの契約（原文英語のまま維持）:
 *
 * CONTRACT (cooperative cancellation — STRONG REQUIREMENT): the `source` MUST honor
 * the `AbortSignal` it is given. Honoring it is what drives switchMap restart/dispose;
 * a source that ignores it cannot be reliably cancelled.
 *
 * Rescue levels on abort:
 *   - ReadableStream: FULLY rescued. A parked read() is force-unwound via
 *     reader.cancel(), which both releases the underlying source and settles the
 *     pending read() so the loop unwinds.
 *   - AsyncIterable / async generator: PARTIALLY rescued. On abort we call
 *     iterator.return() to trigger the generator's finally/cleanup. But a parked
 *     `await` (the producer stalling before its next yield while IGNORING `signal`)
 *     cannot be force-unwound from outside — return() only takes effect when the
 *     generator next resumes. So a source that parks forever and never observes
 *     `signal` still leaks its consume task. Honor `signal` to bound this.
 * The `if (signal.aborted) return` check only runs after a chunk arrives, not while
 * parked — it drops stale chunks but is not, by itself, a cancellation mechanism.
 */

import type { IConsumeSink, StreamProducer, StreamSource } from "./types";

export async function consumeSource(
  source: StreamSource,
  args: unknown,
  signal: AbortSignal,
  sink: IConsumeSink,
): Promise<void> {
  // Obtain the iterator EXPLICITLY (not via `for await`'s implicit one) so abort can
  // call `iterator.return()` to trigger an AsyncIterable / async generator's
  // `finally`/cleanup. A `for await` only calls `.return()` when the loop itself exits;
  // if the producer is PARKED (awaiting before the next yield while ignoring `signal`),
  // the loop never advances, so the implicit `.return()` never runs and the task leaks
  // past restart/dispose. Calling `.return()` on abort is the PARTIAL rescue: the
  // parked `await` cannot be force-unwound from outside, but once the generator resumes
  // (its next tick), `.return()` makes it run its `finally` and stop — recovering the
  // common "generator wakes up after abort" case. The ReadableStream path is fully
  // rescued via `reader.cancel()` (see `readableToAsyncIterable`).
  let iterator: AsyncIterator<unknown> | null = null;
  // Guard against returning the SAME iterator twice. `onAbort` is reachable two ways:
  // the abort listener, and the explicit call below when abort raced the
  // `await source(...)`. The guard keys on the iterator instance (not a plain "ran"
  // flag): the listener firing with iterator still null must NOT consume the single
  // real cleanup that the explicit call performs once the iterator exists. So we only
  // mark an iterator returned once we have actually called `.return()` on it.
  let returned: AsyncIterator<unknown> | null = null;
  const onAbort = (): void => {
    if (!iterator || iterator === returned) {
      return; // nothing to release yet, or already released this iterator
    }
    returned = iterator;
    // Fire the iterator's cleanup. Swallow any throw/rejection from `.return()` — we
    // are tearing down; a producer that rejects on return must not surface here.
    try {
      void iterator.return?.()?.then?.(undefined, () => {});
    } catch {
      // `.return()` threw synchronously while tearing down — ignore.
    }
  };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    const produced = await source(args, signal);
    iterator = iterate(produced, signal)[Symbol.asyncIterator]();
    if (signal.aborted) {
      // Aborted while awaiting the source: the abort listener already ran (iterator
      // was still null then), so explicitly release the just-produced iterator now —
      // this fires a generator's finally / a ReadableStream's cancel for the
      // resource we created but will never iterate.
      onAbort();
      return;
    }
    for (;;) {
      const result = await iterator.next();
      if (result.done) {
        break;
      }
      if (signal.aborted) {
        return; // stale chunk from a superseded/disposed run — drop it
      }
      sink.fold(result.value);
    }
    if (signal.aborted) {
      return; // stream ended but this run was aborted — don't mark done
    }
    sink.done();
  } catch (e) {
    if (signal.aborted) {
      return; // an abort that surfaced as a throw is not an error
    }
    sink.fail(e); // keep the last folded value (do not reset)
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function iterate(produced: StreamProducer, signal: AbortSignal): AsyncIterable<unknown> {
  if (typeof (produced as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function") {
    return produced as AsyncIterable<unknown>;
  }
  // Not async-iterable: must be a ReadableStream (read via getReader). Validate so
  // a wrong source value yields a clear error instead of an opaque "getReader is
  // not a function" from inside the generator.
  if (typeof (produced as ReadableStream<unknown>)?.getReader !== "function") {
    throw new TypeError(
      "[@wcstack/state] $streams: source must return an AsyncIterable or a ReadableStream (got neither).",
    );
  }
  return readableToAsyncIterable(produced as ReadableStream<unknown>, signal);
}

async function* readableToAsyncIterable(
  stream: ReadableStream<unknown>,
  signal: AbortSignal,
): AsyncGenerator<unknown> {
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
      yield value;
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}
