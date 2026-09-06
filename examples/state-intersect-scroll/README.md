# state + intersection + `$streams` + `$watch` demo (infinite scroll via `<wcs-intersect>`)

This is the lower-level counterpart to [`infinite-scroll`](../../packages/fetch/examples/infinite-scroll).
`<wcs-intersect>` reports visibility, an `@wcstack/state` `$streams` entry owns page fetching,
switchMap-style cancellation, and bounded retry, and a `$watch` commits each successful page into the
long-lived feed without depending on anything being rendered.

The important part is not merely that the request lives in a stream. The requested page is derived from
the number of **committed** items instead of being incremented blindly. Repeated intersection edges while
page N is active or failed therefore write N again, which is a same-value no-op. Once page N commits,
the same calculation produces N+1; that dependency change aborts the old producer and starts the newest
one through `$streams`.

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
  -> page = floor(items.length / pageSize) + 1
       | same page: same-value no-op (active/error edges cannot skip or retry)
       | new page: $streams args dependency changed
       v
$streams.pageResult
  -> abort previous run
  -> fetch requested page with AbortSignal
  -> on failure: bounded delay/retry inside the producer
  -> yield { kind: "success", items }
       v
$watch on streamStatus (headless — no binding required)
  -> append the page to long-lived items
  -> command.reobserve
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
  are read by `$streams.pageResult.args`. Changing one aborts the current fetch or retry delay and starts
  a run with the newest dependency snapshot. Stale runs cannot commit a page.
- **There is no hand-written loading/error exhaust gate on pagination.** Instead of guarding with
  `if (loading) return`, the sentinel handler derives the requested page from committed item count.
  Until a page succeeds, repeated enter edges write the same primitive and do nothing; after success,
  they select exactly the next page. A naive `page++` would be incorrect with switchMap because a second
  edge could cancel page N and jump to N+1. The `showError` branch that does exist is retry
  qualification — deciding whether an edge counts as a user gesture — not an exhaust gate.
- **`$streams` is switchMap, not retryWhen.** It deliberately has no automatic reconnection. The
  `loadPage` async generator therefore owns a finite `1 + maxRetries` attempt loop and an abort-aware
  fixed delay. Retry progress is yielded as ordinary stream values; final failure appears through
  `$streamStatus.pageResult === "error"` and `$streamError.pageResult`.
- **Retry after the automatic budget is dependency-driven.** The Retry button increments `retryNonce`.
  With existing items, scrolling away from the sentinel and back does the same. The qualification is
  "scrollY moved since the error settled", carried by either edge: a leave at a moved scrollY arms the
  next enter, and an enter at a moved scrollY qualifies by itself. The second clause matters when the
  error UI's own insertion pushed the sentinel out of the observer band — that leave fires at an
  unchanged scrollY and cannot arm, and the user's departure produces no further edge, so an arm-only
  design would silently swallow the first round trip. The page stays unchanged, but the dependency
  write restarts an errored stream with a fresh retry budget.
- **Page-local and feed-long lifetimes stay separate.** `$streams` resets its value on restart, so
  `pageResult` contains only the current page operation. A `$watch` commits a successful result into the
  long-lived `items` array. Watch is **headless**: unlike `$updatedCallback`, it does not need the value to
  be bound anywhere. Earlier revisions of this demo did use `$updatedCallback`, which made the visible
  stream-status meter load-bearing — delete that one `<b>` and the feed stopped committing. The meter is
  now display only.
- **A `$watch` key cannot start with `$`**, so `$streamStatus.pageResult` is mirrored through a one-line
  `streamStatus` getter. Watching a getter makes it eager, which is exactly what is wanted here: it keeps
  being evaluated whether or not anything renders it.
- **Re-observation prevents short-page stalls.** A successful full page calls `reobserve()`. A new
  observer reports current visibility even if the sentinel never crossed the boundary, so a tall viewport
  can continue loading; a partial page sets `noMore` instead.
- **The retry budget is finite.** A permanently failing page makes exactly four requests with
  `maxRetries: 3`, then stops. The demo deliberately does not call `reobserve()` on error: doing so while
  the sentinel is visible would turn error layout into an infinite retry scheduler. Recovery requires the
  button, or a sentinel edge at a moved scrollY after the settled error. An empty feed therefore
  still requires the button.

## Deliberate Imperative Boundary

This example is not a claim that `$streams` is an RxJS-sized dataflow algebra. The remaining imperative
parts are real API boundaries:

- The producer-local `fold` resets to `initial` on every dependency restart. It cannot fold page results
  across page runs, so `items = items.concat(batch)` is an imperative commit into feed-long state.
- `$streams` has switchMap-style restart, but no `retryWhen`, timer, merge, or occurrence operator. The
  producer therefore owns the attempt loop and abort-aware delay.
- `retryNonce` converts “run the same page again” from an occurrence into a changing dependency value.
  This is intentional, but it is still an encoding necessitated by the value-based restart API.
- Commit-before-reobserve is expressed by statement order in the `$watch` handler, not by a graph type.
  `reobserve()` only schedules a later observer task, and deriving `page` from committed length is
  idempotent, so correctness does not depend on a synchronous race between those two statements.
- The scroll-retry qualification reads `window.scrollY` — an out-of-band viewport source the state
  module otherwise never touches, and one that assumes the document itself is the scroll container.
  The real requirement is "did the user scroll between these two intersection edges", which only a
  driver observing scroll could decide; `<wcs-intersect>` has no qualified re-entry event, so the
  state module approximates it from edge-time scroll positions. Edges are also the only trigger: a
  round trip that never crosses the observer band produces no event at all, so no edge-keyed
  qualification can see it — scrolling on past the previous spot recovers. An I/O node emitting a
  qualified `retryRequested` event token would collapse both fields and the `window` read into one
  `$on` line.

The graph is declarative at dependency and cancellation edges; cross-run accumulation, retry policy, and
the terminal commit remain imperative. A state-only effect/watch API plus temporal/composition operators
would be needed to remove those boundaries rather than merely hide them.

## Tests

Real-browser coverage is in
[`e2e/tests/state-intersect-scroll.spec.ts`](../../e2e/tests/state-intersect-scroll.spec.ts):

```bash
cd e2e
npx playwright test state-intersect-scroll
```

The failure tests verify active-run cancellation and stale-result dropping, recovery within the retry
budget, exact stopping after `1 + maxRetries`, button recovery, and the absence of a layout-driven retry
loop. A separate test exhausts page 3 after 40 committed items, proves that it stays stopped, then verifies
that a deliberate sentinel `leave → enter` retries page 3. Another forces the error UI itself to push the
sentinel out of the observer band — the configuration where the only leave edge fires at an unchanged
scrollY — and proves a single scroll round trip still retries. The happy-path test loads all 87 items
exactly once and reaches the partial-page terminator.

## See Also

- [`@wcstack/state` stream reference](../../packages/state/docs/streams.md) — dependency capture,
  switchMap restart, status/error namespaces, cancellation, and lifecycle
- [Timing and firing contract](../../docs/timing-and-firing-contract.md) — same-value page selection and
  forced intersection re-observation
- [Async execution model](../../docs/async-execution-model.md) — `latest` and bounded retry vocabulary
