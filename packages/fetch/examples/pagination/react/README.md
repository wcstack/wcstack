# Pagination — React

A React 19 implementation of the shared pagination demo. It paginates a
200-row member list (12 per page) backed by the same `/api/items` server the
other four demos use — so the data, look and behaviour are identical and only
the front-end code differs.

This one subscribes to a headless `<wcs-fetch>` node (the `@wcstack/fetch` data
node) with `@wc-bindable/react`'s `useWcBindable`. The `url` prop is derived from
`page` and handed to the element, which does the fetching; `useState` only holds
`page`. There is no `fetch` and no `AbortController` here — the re-fetch, abort and
stale-response protection all live in the element.

## Run it

```bash
cd packages/fetch/examples/pagination/react
npm install
npm run start          # build + serve on http://localhost:3404
```

Then open http://localhost:3404. `npm run start` is self-contained: its `server.js`
also serves `/api/items` on the same port, so you do **not** need to start the shared
hub for it (the hub is only needed for `npm run dev` below).

For live development with hot reload:

```bash
# 1. start the shared API hub (serves /api/items on :3400)
node packages/fetch/examples/pagination/shared/server.js

# 2. in another terminal
cd packages/fetch/examples/pagination/react
npm run dev           # Vite dev server; /api is proxied to the hub
```

## The interesting bits

- **Fetching is delegated to `<wcs-fetch>`.** Deriving the `url` prop from `page`
  and handing it to the element makes it refetch and auto-abort the previous
  in-flight request, so a slow response for an old page can never overwrite the
  newer page's rows (stale-response protection lives in the element). No `fetch`,
  no `AbortController` on the React side.
- **State via `useWcBindable`.** The adapter mirrors the element's `value` /
  `loading` / `error` into React state, so the derived values and rendering are
  plain React.
- **Stale-while-revalidate.** Once rows exist, a reload keeps them on screen and
  just adds the `stale` class to the `<ul>` (the first-load spinner only shows
  before the very first response). On an HTTP/network error `<wcs-fetch>` resets
  `value` to `null`, so `totalPages` falls back to `1` and the pager minimises to a
  single page — the same recovery state in all five demos.
- **`useMemo` page window.** `pageWindow(page, totalPages)` collapses the page
  list to first / last / current ±1 with ellipsis gaps — recomputed only when
  the page or page count changes.

All five demos (React / Vue / `@wcstack/state` / `@wcstack/signals` / Vanilla) hit
the same shared `/api/items` endpoint so the comparison stays apples-to-apples — and
all five consume the very same `<wcs-fetch>` node, each through a different binding
layer (data-wcs / framework adapter / signals' `bindNode`).
