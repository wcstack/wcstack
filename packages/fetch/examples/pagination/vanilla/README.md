# Pagination — Vanilla JS

The framework-free implementation of the shared pagination demo: plain ES
modules, a hand-rolled `state` object and DOM updates built by hand — no build
step. The fetching, though, is delegated to a headless `<wcs-fetch>` node (the
`@wcstack/fetch` data node), whose state is subscribed with `@wc-bindable/core`'s
`bind()`. There is no `fetch` and no `AbortController` here. It renders the
**same** DOM as the four other demos (React, Vue, `@wcstack/state`,
`@wcstack/signals`) and hits the **same** `/api/items` server, so this is the
baseline they are compared against.

## What it uses

- `@wcstack/fetch` via CDN (`esm.run`)
- `@wc-bindable/core` via CDN (`esm.run`)

## How to run

This demo is served by the shared hub — there is no per-example server.

```bash
node packages/fetch/examples/pagination/shared/server.js
```

Then open <http://localhost:3400/vanilla/>. The hub also serves `/api/items`
(the same paginated endpoint — `GET /api/items?page=<1-based>&limit=12`,
~400 ms latency, 200 members / 17 pages — that every demo uses).
`@wc-bindable/core` is resolved from the CDN (esm.run) via the page's import map.

## The interesting bits

- **Fetching is delegated to `<wcs-fetch>`** — writing `fetcher.url` makes the
  element refetch and auto-abort the previous in-flight request, so a stale
  response that resolves after a newer page change can never overwrite it. No
  `AbortController` wiring here.
- **`bind()`, the smallest adapter** — `@wc-bindable/core`'s `bind(fetcher, onUpdate)`
  streams the element's `value` / `loading` / `error` into a plain `state` object
  and calls `render()` on every change. The only thing left to write is the DOM.
- **Stale-while-revalidate** — once rows exist they are never replaced by the
  spinner; the `<ul>` just gets a `stale` class while the next page loads, so the
  list never flashes empty. This relies on a **`<wcs-fetch>` contract**: while a
  reload is in flight the element keeps the previous `value` and fires no new
  `value` event until the next response lands, so the previous rows stay put. On an
  HTTP/network error `<wcs-fetch>` resets `value` to `null`, so `totalPages` falls
  back to `1` and the pager minimises to a single page — the same recovery state in
  all five demos.
- **Hand-built DOM** — nodes are created with `createElement` / `textContent`
  (never `innerHTML` interpolation), and a single delegated click listener on the
  pagination nav reads `data-page` to change pages.
