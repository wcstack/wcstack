# state + intersection + `$streams` demo (infinite scroll via `<wcs-intersect>`)

This is the lower-level counterpart to [`infinite-scroll`](../../packages/fetch/examples/infinite-scroll).
`<wcs-intersect>` reports visibility, while an `@wcstack/state` `$streams` entry owns page fetching,
switchMap-style cancellation, and bounded retry.

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
$updatedCallback
  -> append the page to long-lived items
  -> command.reobserve
       v
fresh visibility callback, or wait for scroll
```

## Key Points

- **This uses the advertised switchMap semantics.** `page`, `pageSize`, `maxRetries`, and `retryNonce`
  are read by `$streams.pageResult.args`. Changing one aborts the current fetch or retry delay and starts
  a run with the newest dependency snapshot. Stale runs cannot commit a page.
- **There is no hand-written loading/error exhaust gate.** The sentinel handler has no
  `if (loading) return` or `if (error) return`. It derives the requested page from committed item count.
  Until a page succeeds, repeated enter edges write the same primitive and do nothing; after success,
  they select exactly the next page. A naive `page++` would be incorrect with switchMap because a second
  edge could cancel page N and jump to N+1.
- **`$streams` is switchMap, not retryWhen.** It deliberately has no automatic reconnection. The
  `loadPage` async generator therefore owns a finite `1 + maxRetries` attempt loop and an abort-aware
  fixed delay. Retry progress is yielded as ordinary stream values; final failure appears through
  `$streamStatus.pageResult === "error"` and `$streamError.pageResult`.
- **Manual retry is also dependency-driven.** The Retry button increments `retryNonce`. The page stays
  unchanged, but the dependency write restarts an errored stream with a fresh retry budget.
- **Page-local and feed-long lifetimes stay separate.** `$streams` resets its value on restart, so
  `pageResult` contains only the current page operation. `$updatedCallback` commits a successful result
  into the long-lived `items` array. The hidden `pageResult` binding makes that commit boundary explicit,
  because `$updatedCallback` observes paths participating in bindings.
- **Re-observation prevents short-page stalls.** A successful full page calls `reobserve()`. A new
  observer reports current visibility even if the sentinel never crossed the boundary, so a tall viewport
  can continue loading; a partial page sets `noMore` instead.
- **The retry budget is finite.** A permanently failing page makes exactly four requests with
  `maxRetries: 3`, then hands scheduling to the user. Intersection edges cannot create an unbudgeted retry
  path because they keep writing the unchanged page number.

## Tests

Real-browser coverage is in
[`e2e/tests/state-intersect-scroll.spec.ts`](../../e2e/tests/state-intersect-scroll.spec.ts):

```bash
cd e2e
npx playwright test state-intersect-scroll
```

The failure tests intentionally never scroll. They verify active-run cancellation and stale-result dropping,
recovery within the retry budget, exact stopping after `1 + maxRetries`, manual recovery, and the absence of
a layout-driven retry loop. The happy-path test loads all 87 items exactly once and reaches the partial-page
terminator.

## See Also

- [`@wcstack/state` stream reference](../../packages/state/docs/streams.md) — dependency capture,
  switchMap restart, status/error namespaces, cancellation, and lifecycle
- [Timing and firing contract](../../docs/timing-and-firing-contract.md) — same-value page selection and
  forced intersection re-observation
- [Async execution model](../../docs/async-execution-model.md) — `latest` and bounded retry vocabulary
