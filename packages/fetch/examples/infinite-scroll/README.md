# state + fetch demo (infinite scroll via `<wcs-infinite-scroll>`)

An infinite-scroll feed built from `@wcstack/state` and `@wcstack/fetch`. A bottom
sentinel (`<wcs-infinite-scroll>`) runs a `<wcs-fetch>` as it scrolls into view, and
each page is **appended** in state so the list grows without ever flashing or reloading.

`<wcs-infinite-scroll>` ships **inside `@wcstack/fetch`** — no extra package is needed.
It is the high-level, batteries-included option. For the lower-level version wired by
hand, see the sibling [`state-intersect-scroll`](../state-intersect-scroll) demo.

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
- **Static `url` (= page 1) makes the first load deterministic.** The sentinel's trigger is a one-shot — `set trigger` silently drops the write when `url` is empty, and `IntersectionObserver` won't re-fire while the sentinel stays in view (empty list). The url binding (`@wcstack/state`) and the sentinel's initial observer callback run on independent async pipelines with no ordering guarantee, so if the sentinel fires before the binding lands it would trigger against an empty url and the page would never load (spinner stuck). The static `url="/api/items?page=1&limit=20"` removes the race; `manual` keeps it from auto-fetching, and the binding rewrites it to page 2+ as `page` advances. (The `state-intersect-scroll` demo needs no equivalent: a no-`manual` fetch self-heals via `attributeChangedCallback` when the bound url finally arrives.)
- **The sentinel needs a real box.** `<wcs-infinite-scroll>` defaults to `display:inline` and collapses to 0×0 with no content, which `IntersectionObserver` observes unreliably (the initial intersection can be missed). The demo gives it `display:block; min-height:1px` so the first observation is deterministic.
- **Advance `page` *after* the response.** `page++` happens in `$on.pageArrived` on success only. Doing it earlier would skip a page; doing it on an error response would skip the failed page entirely (so on failure we leave `page` put and the next scroll retries the same url).
- **End contract = short page.** The server returns a plain array; a response shorter than `pageSize` means the catalog is exhausted. `noMore` then flips `disabled` on the sentinel — `applyChangeToProperty` sets the element's `disabled` property, whose setter reflects the attribute and re-runs the observer logic, which stops observing.
- **Short-page caveat.** `IntersectionObserver` fires only on a visibility *change*. If a loaded page is so short it doesn't push the sentinel out of the (margin-expanded) viewport, no further callback comes and loading stalls. Keep rows tall enough / `pageSize` large enough that one page exceeds the viewport plus the 240px preload margin. (The `state-intersect-scroll` demo self-heals this by re-arming the observer after each page.)

## See also

The fetch firing/timing behaviours this demo leans on (auto-fetch de-dup, `response` firing on errors too, the sentinel needing a layout box) are documented in [docs/timing-and-firing-contract.md](../../docs/timing-and-firing-contract.md).
