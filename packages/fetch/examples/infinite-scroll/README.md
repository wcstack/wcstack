# state + fetch demo (infinite scroll via `<wcs-infinite-scroll>`)

An infinite-scroll feed built from `@wcstack/state` and `@wcstack/fetch`. A bottom
sentinel (`<wcs-infinite-scroll>`) runs a `<wcs-fetch>` as it scrolls into view, and
each page is **appended** in state so the list grows without ever flashing or reloading.

`<wcs-infinite-scroll>` ships **inside `@wcstack/fetch`** — no extra package is needed.
It is the high-level, batteries-included option. For the lower-level version wired by
hand, see [`state-intersect-scroll`](../../../../examples/state-intersect-scroll), which uses
`@wcstack/state` `$stream` plus the lower-level intersection primitive. In between,
[`state-intersect-fetch`](../../../../examples/state-intersect-fetch) keeps `<wcs-fetch>` but wires it to a
`<wcs-intersect>` sentinel through state (an event token in, a command token out).

## Getting Started

The packages load from a CDN ([esm.run](https://esm.run)), so no local build is needed — Node.js alone is enough.

```bash
node packages/fetch/examples/infinite-scroll/server.js
```

Open http://localhost:3000 in your browser and scroll.

## Features

- **Sentinel-driven loading**: `<wcs-infinite-scroll target="page-fetch">` fires the fetch when its marker enters the viewport (with a 240px preload margin)
- **Page accumulation in state**: `<wcs-fetch>.value` only ever holds one page, so each response is appended into `state.items` via an event token
- **End-of-feed detection**: a page shorter than `pageSize` is the last one → `noMore` is set and the sentinel is disabled
- **No double-loading**: the fetch is `manual`, so advancing `page` (which rewrites the url) never triggers an extra request
- **Any window height**: a page that leaves the sentinel on screen (a tall window, a zoomed-out page) is followed by the next one, until the sentinel is off screen or the feed ends
- **A failure waits for the user**: the sentinel does not repeat a failed request; *Try again* runs it, and so does scrolling away and back

## Data Flow

```
scroll ──▶ <wcs-infinite-scroll>  (sentinel enters viewport)
                 │  sets trigger=true on…
                 ▼
           <wcs-fetch id=page-fetch manual>   url = /api/items?page=(page+1)
                 │  wcs-fetch:response  { value, status }
                 ▼  eventToken.value: pageArrived
           $on.pageArrived  ──▶  items = items.concat(batch);  page++
                 │                     └─ if batch.length < pageSize → noMore = true
                 ▼
           <ul for: items>            (the growing feed)

           disabled: noMore  ──▶  <wcs-infinite-scroll>  stops observing
```

## Key Points

- **`value` is replaced, not appended.** `<wcs-fetch>` exposes the *latest* response only. Infinite scroll needs every page, so the list never binds `value` directly — `eventToken.value: pageArrived` hands each response to `$on`, which does `items.concat(...)`. Accumulation is a state concern; the tag only owns scroll detection.
- **`manual` is required.** The url getter returns `page+1`, so it changes after every load. Without `manual`, that url change would auto-fetch and double-load. With `manual`, only the sentinel's `trigger=true` runs a request.
- **The `url` comes from state — no static page-1 `url`.** The sentinel usually reports before state has written the `url`. Since 4.24 it runs the request when the `url` is written, so the first page needs nothing else. A static `url="/api/items?page=1&limit=20"` (what this demo had up to 4.23) lets the request start before state has bound the element, and the first answer can arrive before the `eventToken.value` handler is attached — in Firefox it was lost every time.
- **The sentinel needs a real box.** `<wcs-infinite-scroll>` defaults to `display:inline` and collapses to 0×0 with no content, which `IntersectionObserver` observes unreliably (the initial intersection can be missed). The demo gives it `display:block; min-height:1px` so the first observation is deterministic.
- **The sentinel sits right after the list, above the spinner and the messages.** Only rows move it. Below them, the spinner shown while a page loads would push it down — out of its 240px margin — and a scroll that goes on would bring it back: to the element that is the sentinel coming on screen again, and it would ask again for a request that failed in between.
- **Advance `page` *after* the response.** `page++` happens in `$on.pageArrived` on success only. Doing it earlier would skip a page; doing it on an error response would skip the failed page entirely (so on failure we leave `page` put). The sentinel does not repeat a failed request by itself: the user scrolls away and back, or presses *Try again*, which runs the request for the same url through `command.fetch:`.
- **End contract = short page.** The server returns a plain array; a response shorter than `pageSize` means the catalog is exhausted. `noMore` then flips `disabled` on the sentinel — `applyChangeToProperty` sets the element's `disabled` property, whose setter reflects the attribute and re-runs the observer logic, which stops observing.
- **A page that leaves the sentinel on screen is followed by the next one** (since 4.24). `IntersectionObserver` fires only on a visibility *change*, so a tall window, a zoomed-out page or a short page used to stall here. Now the element looks again when a request ends having added rows, and goes on until the sentinel is off screen; a response that added no row ends it.

## See also

The fetch firing/timing behaviours this demo leans on (auto-fetch de-dup, `response` firing on errors too, the sentinel needing a layout box, what the sentinel does while it stays on screen — §26) are documented in [docs/timing-and-firing-contract.md](../../../../docs/timing-and-firing-contract.md). What a long list needs beyond this demo — a filter that changes while a page is on its way, rows, a window of rows, coming back — is in [docs/long-lists.md](../../../../docs/long-lists.md).
