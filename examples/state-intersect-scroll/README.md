# state + fetch + intersection + timer demo (infinite scroll via `<wcs-intersect>`)

The same infinite-scroll feed as [`infinite-scroll`](../../packages/fetch/examples/infinite-scroll),
but built from the lower-level `@wcstack/intersection` primitive instead of the
batteries-included `<wcs-infinite-scroll>`. Here the sentinel only *reports visibility*;
**state decides** what to do with it.

This version is **full-auto**: there is no `manual` and no `trigger`. The sentinel
advances a `page` number, the `<wcs-fetch>` url derives from `page`, and a plain
auto-fetch loads each page as the url changes. The url binding *is* the trigger on
the happy path — the cleanest possible wiring, only reachable because `<wcs-intersect>`
can write state (which `<wcs-infinite-scroll>` cannot).

The failure path needs one more node. The sentinel is an **edge detector**, not a
clock: it can report that visibility changed, but it cannot schedule anything. A page
that fails while the feed is empty leaves nothing to scroll and therefore no edge to
detect — "scroll to retry" would be a deadlock, not an instruction. So a
`<wcs-timer manual once>` supplies the missing `delay` and a bounded auto-retry runs
off it (see Key Points).

Use this version when you want control over the trigger (custom guards, re-arming,
reacting to `ratio`/`visible` rather than a binary enter), or to see how a generic
visibility primitive composes with `@wcstack/fetch`.

## Getting Started

The packages load from a CDN ([esm.run](https://esm.run)), so no local build is needed — Node.js alone is enough.

```bash
node examples/state-intersect-scroll/server.js
```

Open http://localhost:3000 in your browser and scroll.

To exercise the failure path, the server can inject 503s:

```bash
# page 1 fails twice, so the feed starts empty and only the retry clock can recover it
FAIL_PAGE=1 node examples/state-intersect-scroll/server.js

# fail past the retry budget (maxRetries = 3) and land on the manual Retry button
FAIL_PAGE=1 FAIL_TIMES=9 node examples/state-intersect-scroll/server.js

# every page fails with 40% probability
FLAKY=0.4 node examples/state-intersect-scroll/server.js
```

## Features

- **Event-driven sentinel**: `<wcs-intersect target="self">` emits `wcs-intersect:change`; `$on.sentinelChanged` turns the enter edge into a `page` advance
- **No-`manual` auto-fetch**: the `<wcs-fetch>` url derives from `page`, so advancing `page` changes the url and auto-fetches the next page — no `trigger`, no fetch command
- **Self-healing re-arm**: after each page, state calls the sentinel's `reobserve()` command to force a fresh observation, so a short page that doesn't scroll the marker out of view still loads the next page
- **Bounded auto-retry on a clock**: a failed page arms a `<wcs-timer manual once>`; its tick re-runs the same url, up to `maxRetries`, then hands the schedule to a Retry button
- **Same accumulation + end contract** as the high-level demo: append in `$on`, stop on a short page

## Data Flow

```
scroll ──▶ <wcs-intersect target=self>   (visibility change)
                 │  wcs-intersect:change { isIntersecting }
                 ▼  eventToken.intersecting: sentinelChanged
           $on.sentinelChanged ── isIntersecting && !loading && !noMore && !error ──▶ page++
                 │  (page is the only input to the url getter)
                 ▼  get "pageFetch.url"  →  /api/items?page=N
           <wcs-fetch id=page-fetch>   (no manual → auto-fetches on url change)
                 │  wcs-fetch:response { value, status }
                 ▼  eventToken.value: pageArrived
           $on.pageArrived ──▶ items = items.concat(page)        (page NOT advanced here)
                 │                  ├─ page.length < pageSize → noMore = true
                 │                  └─ else → rearm  (reobserve(): fresh observation → callback)
                 ▼
           <ul for: items>

   connect ──▶ url = /api/items?page=1  ──▶ auto-fetch loads page 1 (no explicit trigger)

   failure path (status < 200 || >= 300 — HTTP errors and network errors both land here)

           $on.pageArrived ── retryAttempt < maxRetries ──▶ armRetry
                 │                                             │  start(): one delayed tick
                 │                                             ▼
                 │                                       <wcs-timer manual once>
                 │                                             │  wcs-timer:tick
                 │                                             ▼  eventToken.tick: retryTick
                 │                                       $on.retryTick ──▶ refetch (same url)
                 │
                 └── budget spent ──▶ showError ──▶ <button onclick: retryNow>
```

## Key Points

- **The url binding is the trigger.** With no `manual`, `<wcs-fetch>` auto-fetches on connect and on every url change. The url derives only from `page`, and `page` advances only on intersection — so auto-fetch fires *exactly once per page*, with no cascade. Page 1 loads from the connect-time auto-fetch; no `$connectedCallback`, command, or imperative trigger is needed.
- **The intersect tag has no "run a fetch" behaviour.** Unlike `<wcs-infinite-scroll>`, it is a pure visibility producer that can *write state*. `eventToken.intersecting: sentinelChanged` delivers the raw `wcs-intersect:change` event to `$on`, which advances `page`. Writing state is exactly what `<wcs-infinite-scroll>` can't do — and it's what makes this `manual`-free design possible (that tag can only fire a `trigger`, which forces `manual`).
- **Advance on intersection, not on response.** `page++` lives in `sentinelChanged`, never in `pageArrived`. If the response handler advanced `page`, the url would change on every page landing and auto-fetch would cascade through the whole catalog. Keeping the advance on the intersection edge is what bounds it to one request per scroll.
- **Error retry needs an explicit fetch.** Because the advance is on intersection (not on success), a failed page leaves `page` unchanged. The retry must re-run *that page*, not advance past it — otherwise the failed page is skipped forever. But the url is unchanged, and auto-fetch de-dups an unchanged url (v1.13), so the binding alone can't express "retry". A path is a *place* and assignment is a *state change*: writing the same value twice is indistinguishable from writing it once, while fetching the same url twice is very much distinguishable. That is why `$command.refetch` exists — an explicit fetch bypasses the de-dup, and `FetchCore` clears `error` at request start, so a success resumes the feed. It is not a workaround; it marks the boundary of what the value rail can carry.
- **The retry needs a clock, and the sentinel isn't one.** `<wcs-intersect>` reports that visibility *changed*. It cannot say "again in 1.5s", and after a failed page there may be no further change to report — a feed that failed on page 1 has no content, so there is nothing to scroll and no edge will ever come. Recovery driven by the sentinel alone is a deadlock. So `$on.pageArrived` arms `<wcs-timer manual once>` (`once` = `repeat="1"`, i.e. exactly one delayed tick — a plain `delay`), and `$on.retryTick` fires `refetch`. Time is a node in wcstack, like every other capability; the demo just has to use one.
- **The sentinel must NOT retry, even opportunistically.** `$on.sentinelChanged` returns early when `pageFetch.error` is set. Letting an intersection edge fire its own `refetch` looks harmless ("the user scrolled, so take the chance") but is a livelock: showing and hiding the *"retrying…"* line changes the layout, which moves the sentinel across the observer's margin, which produces an intersection edge — a self-sustaining retry loop that never spends the budget. The e2e trace measured exactly one such unbudgeted refetch per failure cycle before the guard was added. **Every retry path must be budgeted or human-initiated**; there are now exactly two (the clock, then the button).
- **Budget is spent on dispatch, not on arming.** `retryAttempt` increments in `$on.retryTick` just before the `refetch`, not in `$on.pageArrived` when the clock is armed. Counting at arm time makes `retriesExhausted` true while a tick is still pending — the Retry button flashes underneath a retry that is already on its way — and a guard-skipped tick would burn budget without issuing a request. With `maxRetries: 3` a permanently failing page produces exactly 4 requests and then stops.
- **The retry policy is the house policy.** Per [docs/async-execution-model.md](../../docs/async-execution-model.md) §8, an automatic retry declares four things: `max` (finite — `maxRetries`, MUST NOT be unbounded), `interval` (fixed; exponential backoff is opt-in and no node ships it yet), `resetOn` (a page landing refills the budget), and `excludeWhen` (`noMore`, an in-flight request, or an error that already cleared). Spending the budget is not a failure of the design — it is the point where the schedule is handed back to a human, which is what the Retry button is for. When the feed is empty that button is the *only* remaining scheduler.
- **The retry interval is a static attribute, deliberately.** Binding `interval` would make the period a value that lands on the updater's microtask drain, while `command.start` fires synchronously from `$on` — the timer would start on the *previous* period. Fixed-interval retry is the house default anyway, so the static attribute costs nothing and removes an ordering hazard. (A bound period is fine for a timer that is already running: `attributeChangedCallback` swaps it live via `changeInterval()`.)
- **Re-arming defeats the short-page stall.** `IntersectionObserver` fires only on a visibility *change*. After appending a page, `$on.pageArrived` calls the sentinel's `reobserve()` command. A bare `observe()` would be a no-op — `IntersectionCore.observe()` is idempotent for an unchanged target+options and early-returns without re-delivering — so `<wcs-intersect>` exposes `reobserve()`, which rebuilds the observer and delivers an initial callback for the *current* state: advancing `page` if the sentinel is still visible, or reporting not-intersecting (wait for scroll) if not. The high-level `<wcs-infinite-scroll>` has no such command — that's the main reason to drop to this level.
- **Guards.** `$on.sentinelChanged` guards on `!loading` and `!noMore`. The `!loading` guard does double duty: it prevents the cascade, and it prevents a *page-skip*. Advancing `page` schedules the next auto-fetch in a microtask that flips `loading=true` before the next IntersectionObserver callback (a task), so a rapid second enter sees `loading=true` and is ignored — rather than bumping `page` twice and skipping a page. (A double-fire would *skip* a page, not refetch it, so per-request server idempotency would not save it; the protection is this microtask-vs-task ordering.)

## Tests

Real-browser coverage lives in [`e2e/tests/state-intersect-scroll.spec.ts`](../../e2e/tests/state-intersect-scroll.spec.ts) (`cd e2e && npx playwright test state-intersect-scroll`). The failure specs deliberately **never scroll** — a regression that is only recoverable by scrolling is exactly the deadlock being guarded against.

## See also

The timing/firing behaviours this demo leans on (auto-fetch de-dup vs explicit fetch, `observe()` idempotency vs `reobserve()`, the microtask-vs-task ordering) are documented in [docs/timing-and-firing-contract.md](../../docs/timing-and-firing-contract.md).

The retry policy vocabulary (`max` / `interval` / `resetOn` / `excludeWhen`, and the `latest` / `queue` / `exhaust` / `overlap` exclusivity modes) is normative in [docs/async-execution-model.md](../../docs/async-execution-model.md) §5 and §8. Today that vocabulary is only available *inside* an I/O node — userland has to hand-write the equivalent guards, as `$on.sentinelChanged` and `$on.retryTick` do here. Whether it should also be declarable from the state side is decision gate 1 in [docs/architecture-hardening/04-async-execution-and-wc-bindable.md](../../docs/architecture-hardening/04-async-execution-and-wc-bindable.md).
