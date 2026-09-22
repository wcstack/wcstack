# state + intersection + `$stream` + `$scan` demo (infinite scroll via `<wcs-intersect>`)

This is the lower-level counterpart to [`infinite-scroll`](../../packages/fetch/examples/infinite-scroll).
`<wcs-intersect>` reports visibility, an `@wcstack/state` `$stream` entry owns page fetching,
switchMap-style cancellation, and bounded retry, and a `$scan` accumulates each landed page into a feed
that outlives every page run — without depending on anything being rendered.

The important part is not merely that the request lives in a stream. The requested page is derived from
the number of items **already in the feed** instead of being incremented blindly. Repeated intersection
edges while page N is active or failed therefore write N again, which is a same-value no-op. Once page N
lands in the feed, the same calculation produces N+1; that dependency change aborts the old producer and
starts the newest one through `$stream`.

## Getting Started

The packages load from a CDN ([esm.run](https://esm.run)), so Node.js is all you need:

```bash
node examples/state-intersect-scroll/server.js
```

Open http://localhost:3000 and scroll.

The server can inject failures:

```bash
# Page 1 fails twice, then recovers inside the automatic retry budget.
FAIL_PAGE=1 node examples/state-intersect-scroll/server.js

# Exhaust maxRetries=3 and show the manual Retry button.
FAIL_PAGE=1 FAIL_TIMES=9 node examples/state-intersect-scroll/server.js

# Every page fails with 40% probability.
FLAKY=0.4 node examples/state-intersect-scroll/server.js
```

## Data Flow

```text
<wcs-intersect> enter
  -> page = floor(feed.items.length / pageSize) + 1
       | same page: same-value no-op (active/error edges cannot skip or retry)
       | new page: $stream args dependency changed
       v
$stream.pageResult
  -> abort previous run
  -> fetch requested page with AbortSignal
  -> on failure: bounded delay/retry inside the producer
  -> yield { kind: "success", page, pageSize, items }
       v
$scan.feed (from: "pageResult" — headless, owned by the runtime)
  -> fold the success landing into feed.items
  -> a second landing of the same page is dropped by the page key
       v
$watch on feed (next update batch)
  -> command.reobserve while !feed.noMore
       v
fresh visibility callback, or wait for scroll

settled error with existing items
  -> a sentinel edge carrying moved-scrollY evidence increments retryNonce
       | leave at a moved scrollY: arms the next enter
       | enter at a moved scrollY: qualifies by itself
       | edge at an unchanged scrollY (error layout shift): ignored
  -> restart the same page with a fresh bounded budget
```

## Key Points

- **This uses the advertised switchMap semantics.** `page`, `pageSize`, `maxRetries`, and `retryNonce`
  are read by `$stream.pageResult.args`. Changing one aborts the current fetch or retry delay and starts
  a run with the newest dependency snapshot. Stale runs cannot reach the feed.
- **There is no hand-written loading/error exhaust gate on pagination.** Instead of guarding with
  `if (loading) return`, the sentinel handler derives the requested page from the feed's length.
  Until a page lands, repeated enter edges write the same primitive and do nothing; after it lands,
  they select exactly the next page. A naive `page++` would be incorrect with switchMap because a second
  edge could cancel page N and jump to N+1. The `showError` branch that does exist is retry
  qualification — deciding whether an edge counts as a user gesture — not an exhaust gate.
- **Page-local and feed-long lifetimes are separate declarations.** `$stream` resets its value on
  restart, so `pageResult` holds only the current page operation. `$scan.feed` folds each success landing
  into the long-lived feed; the runtime owns `feed` and keeps it across restarts and reconnects, and
  nothing has to be bound for it to run. Earlier revisions of this demo committed with
  `$renderedCallback` — which made the visible stream-status meter load-bearing, since deleting that one
  `<b>` stopped the feed — and later with a `$watch` handler that concatenated by hand.
- **The fold keeps a page key.** The runtime folds once per landing, not once per page. A Retry after a
  page is done, or re-attaching the page, runs the current page again, and that landing must not append
  it twice. `pageSize` rides on the success chunk so the fold stays a pure function of `(feed, chunk)`.
- **`page` stays a plain property.** A getter derived from `feed` and read by the stream's `args` would
  restart the stream on its own result, loading every page without the sentinel; the runtime raises
  `wcs/scan-feedback-loop` for that shape.
- **`$stream` is switchMap, not retryWhen.** It deliberately has no automatic reconnection. The
  `loadPage` async generator therefore owns a finite `1 + maxRetries` attempt loop and an abort-aware
  fixed delay. Retry progress is yielded as ordinary stream values, which the fold passes over; final
  failure appears through `$streamStatus.pageResult === "error"` and `$streamError.pageResult`.
- **Retry after the automatic budget is dependency-driven.** The Retry button increments `retryNonce`.
  With existing items, scrolling away from the sentinel and back does the same. The qualification is
  "scrollY moved since the error settled", carried by either edge: a leave at a moved scrollY arms the
  next enter, and an enter at a moved scrollY qualifies by itself. The second clause matters when the
  error UI's own insertion pushed the sentinel out of the observer band — that leave fires at an
  unchanged scrollY and cannot arm, and the user's departure produces no further edge, so an arm-only
  design would silently swallow the first round trip. The page stays unchanged, but the dependency
  write restarts an errored stream with a fresh retry budget.
- **A `$watch` key cannot start with `$`**, so `$streamStatus.pageResult` is mirrored through a one-line
  `streamStatus` getter, and the watch on it records when an error settles. Watching a getter makes it
  eager, which is exactly what is wanted here: it keeps being evaluated whether or not anything renders it.
- **Re-observation prevents short-page stalls.** After a full page lands, a `$watch` on `feed` calls
  `reobserve()`. A new observer reports current visibility even if the sentinel never crossed the
  boundary, so a tall viewport can continue loading; a partial page sets `feed.noMore` instead.
- **The retry budget is finite.** A permanently failing page makes exactly four requests with
  `maxRetries: 3`, then stops. The demo deliberately does not call `reobserve()` on error: doing so while
  the sentinel is visible would turn error layout into an infinite retry scheduler. Recovery requires the
  button, or a sentinel edge at a moved scrollY after the settled error. An empty feed therefore
  still requires the button.

## Deliberate Imperative Boundary

This example is not a claim that `@wcstack/state` is an RxJS-sized dataflow algebra. The remaining
imperative parts are real API boundaries:

- Cross-run accumulation is declared (`$scan`), but its idempotency is not. The runtime folds once per
  landing, so the fold carries a page key against a retry after `done` or a reconnect.
- Re-arming the sentinel is a side effect (firing a command), so it stays in a `$watch`. Commit before
  re-observe is now the mechanism order — `$scan` writes in one batch and the `$watch` fires at the end of
  the next — rather than statement order inside one handler.
- `$stream` has switchMap-style restart, but no `retryWhen`, timer, merge, or occurrence operator. The
  producer therefore owns the attempt loop and abort-aware delay.
- `retryNonce` converts “run the same page again” from an occurrence into a changing dependency value.
  This is intentional, but it is still an encoding necessitated by the value-based restart API.
- The scroll-retry qualification reads `window.scrollY` — an out-of-band viewport source the state
  module otherwise never touches, and one that assumes the document itself is the scroll container.
  The real requirement is "did the user scroll between these two intersection edges", which only a
  driver observing scroll could decide; `<wcs-intersect>` has no qualified re-entry event, so the
  state module approximates it from edge-time scroll positions. Edges are also the only trigger: a
  round trip that never crosses the observer band produces no event at all, so no edge-keyed
  qualification can see it — scrolling on past the previous spot recovers. An I/O node emitting a
  qualified `retryRequested` event token would collapse both fields and the `window` read into one
  `$on` line.

The graph is declarative at the dependency, cancellation and accumulation edges; retry policy, the
re-arm command and the retry qualification remain imperative.

## Tests

Real-browser coverage is in
[`e2e/tests/state-intersect-scroll.spec.ts`](../../e2e/tests/state-intersect-scroll.spec.ts):

```bash
cd e2e
npx playwright test state-intersect-scroll
```

The failure tests verify active-run cancellation and stale-result dropping, recovery within the retry
budget, exact stopping after `1 + maxRetries`, button recovery, and the absence of a layout-driven retry
loop. A separate test exhausts page 3 after 40 loaded items, proves that it stays stopped, then verifies
that a deliberate sentinel `leave → enter` retries page 3. Another forces the error UI itself to push the
sentinel out of the observer band — the configuration where the only leave edge fires at an unchanged
scrollY — and proves a single scroll round trip still retries. The happy-path test loads all 87 items
exactly once and reaches the partial-page terminator.

The feed boundary itself — folding with nothing bound, progress chunks that write nothing, a second
landing of the same page, re-attachment — is pinned without a browser in
[`packages/state/__tests__/scan.streamCommit.test.ts`](../../packages/state/__tests__/scan.streamCommit.test.ts).

## See Also

- [`@wcstack/state` scan reference](../../packages/state/docs/scan.md) — `from` / `on`, `resetOn`,
  firing order, and lifecycle
- [`@wcstack/state` stream reference](../../packages/state/docs/streams.md) — dependency capture,
  switchMap restart, status/error namespaces, cancellation, and lifecycle
- [Timing and firing contract](../../docs/timing-and-firing-contract.md) — same-value page selection and
  forced intersection re-observation
- [Async execution model](../../docs/async-execution-model.md) — `latest` and bounded retry vocabulary
