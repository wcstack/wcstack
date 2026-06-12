# state + fetch + intersection demo (infinite scroll via `<wcs-intersect>`)

The same infinite-scroll feed as [`state-infinite-scroll`](../state-infinite-scroll),
but built from the lower-level `@wcstack/intersection` primitive instead of the
batteries-included `<wcs-infinite-scroll>`. Here the sentinel only *reports visibility*;
**state decides** what to do with it.

This version is **full-auto**: there is no `manual`, no `trigger`, and no fetch
command. The sentinel advances a `page` number, the `<wcs-fetch>` url derives from
`page`, and a plain auto-fetch loads each page as the url changes. The url binding
*is* the trigger — the cleanest possible wiring, only reachable because `<wcs-intersect>`
can write state (which `<wcs-infinite-scroll>` cannot).

Use this version when you want control over the trigger (custom guards, re-arming,
reacting to `ratio`/`visible` rather than a binary enter), or to see how a generic
visibility primitive composes with `@wcstack/fetch`.

## Getting Started

The packages load from a CDN ([esm.run](https://esm.run)), so no local build is needed — Node.js alone is enough.

```bash
node examples/state-intersect-scroll/server.js
```

Open http://localhost:3000 in your browser and scroll.

## Features

- **Event-driven sentinel**: `<wcs-intersect target="self">` emits `wcs-intersect:change`; `$on.sentinelChanged` turns the enter edge into a `page` advance
- **No-`manual` auto-fetch**: the `<wcs-fetch>` url derives from `page`, so advancing `page` changes the url and auto-fetches the next page — no `trigger`, no fetch command
- **Self-healing re-arm**: after each page, state calls the sentinel's `reobserve()` command to force a fresh observation, so a short page that doesn't scroll the marker out of view still loads the next page
- **Same accumulation + end contract** as the high-level demo: append in `$on`, stop on a short page

## Data Flow

```
scroll ──▶ <wcs-intersect target=self>   (visibility change)
                 │  wcs-intersect:change { isIntersecting }
                 ▼  eventToken.intersecting: sentinelChanged
           $on.sentinelChanged ── isIntersecting && !loading && !noMore ──▶ page++
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
```

## Key Points

- **The url binding is the trigger.** With no `manual`, `<wcs-fetch>` auto-fetches on connect and on every url change. The url derives only from `page`, and `page` advances only on intersection — so auto-fetch fires *exactly once per page*, with no cascade. Page 1 loads from the connect-time auto-fetch; no `$connectedCallback`, command, or imperative trigger is needed.
- **The intersect tag has no "run a fetch" behaviour.** Unlike `<wcs-infinite-scroll>`, it is a pure visibility producer that can *write state*. `eventToken.intersecting: sentinelChanged` delivers the raw `wcs-intersect:change` event to `$on`, which advances `page`. Writing state is exactly what `<wcs-infinite-scroll>` can't do — and it's what makes this `manual`-free design possible (that tag can only fire a `trigger`, which forces `manual`).
- **Advance on intersection, not on response.** `page++` lives in `sentinelChanged`, never in `pageArrived`. If the response handler advanced `page`, the url would change on every page landing and auto-fetch would cascade through the whole catalog. Keeping the advance on the intersection edge is what bounds it to one request per scroll.
- **Error retry needs an explicit fetch.** Because the advance is on intersection (not on success), a failed page leaves `page` unchanged. The next intersection must *retry that page*, not advance past it — otherwise the failed page is skipped forever. But the url is unchanged, and auto-fetch de-dups an unchanged url (v1.13), so the binding alone can't express "retry". So `sentinelChanged` checks `pageFetch.error` first and, if set, fires `command.fetch` (`$command.refetch`) — an explicit fetch bypasses the de-dup, and `FetchCore` clears `error` at request start, so a success resumes the feed. The happy path stays binding-driven; the fetch command exists solely for this retry.
- **Re-arming defeats the short-page stall.** `IntersectionObserver` fires only on a visibility *change*. After appending a page, `$on.pageArrived` calls the sentinel's `reobserve()` command. A bare `observe()` would be a no-op — `IntersectionCore.observe()` is idempotent for an unchanged target+options and early-returns without re-delivering — so `<wcs-intersect>` exposes `reobserve()`, which rebuilds the observer and delivers an initial callback for the *current* state: advancing `page` if the sentinel is still visible, or reporting not-intersecting (wait for scroll) if not. The high-level `<wcs-infinite-scroll>` has no such command — that's the main reason to drop to this level.
- **Guards.** `$on.sentinelChanged` guards on `!loading` and `!noMore`. The `!loading` guard does double duty: it prevents the cascade, and it prevents a *page-skip*. Advancing `page` schedules the next auto-fetch in a microtask that flips `loading=true` before the next IntersectionObserver callback (a task), so a rapid second enter sees `loading=true` and is ignored — rather than bumping `page` twice and skipping a page. (A double-fire would *skip* a page, not refetch it, so per-request server idempotency would not save it; the protection is this microtask-vs-task ordering.)

## See also

The timing/firing behaviours this demo leans on (auto-fetch de-dup vs explicit fetch, `observe()` idempotency vs `reobserve()`, the microtask-vs-task ordering) are documented in [docs/timing-and-firing-contract.md](../../docs/timing-and-firing-contract.md).
