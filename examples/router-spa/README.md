# router + state + fetch demo (SPA product catalog)

A demo combining `@wcstack/router`, `@wcstack/state`, and `@wcstack/fetch` into a
small single-page app: a product list, a detail page per product, a static About
page, and a 404 — with real URLs, working deep links and browser history.

The point of the demo: **the URL is just another piece of reactive state.**
`<wcs-router>` speaks the wc-bindable protocol, so two bindings are the entire
router⇄state bridge:

```html
<wcs-router data-wcs="path: path; navigateUrl: navigateUrl">
```

- `path` — router → state. Every navigation updates `state.path`; getters derive
  the current page and the fetch URL from it.
- `navigateUrl` — state → router. A state method assigns a path
  (`this.navigateUrl = "/products/3"`) and the router navigates; the property
  resets itself to `null` when the navigation finishes.

## Getting Started

The packages load from a CDN ([esm.run](https://esm.run)), so no local build is
needed — Node.js alone is enough.

```bash
node examples/router-spa/server.js
```

Open http://localhost:3000 in your browser. Deep links work too:
http://localhost:3000/products/3, http://localhost:3000/about.

## Features

- **Declarative routes with typed parameters**: `/products/:productId(int)` only
  matches integers — `/products/abc` falls through to `<wcs-route fallback>`
  (the 404 page), while `/products/999` matches the route but gets a 404 from
  the API. Two different "not found"s, each handled by the right layer.
- **Per-page `<title>`**: each route carries a `<wcs-head>`; the document title
  switches on navigation and restores on fallback.
- **Active nav links**: `<wcs-link>` renders an `<a>` and toggles its `active`
  class as the location changes.
- **Fetch driven by navigation**: the detail `<wcs-fetch>`'s url is a state
  getter derived from `path` — navigating IS what triggers the fetch.
- **Instant revisits**: re-opening the same product does not refetch (same-value
  url guard); the cached value renders immediately.

## Data Flow

```
address bar / <wcs-link> / history          this.navigateUrl = "/products/3"
                 │                                        ▲
                 ▼                                        │ openProduct()
            <wcs-router> ──path──▶ state.path             │
                 ▲                     │        (row click on the list)
                 │                     ▼
            navigateUrl      getters derive from path:
                 └─────────  isList / isDetail / "productFetch.url"
                                       │
                                       ▼
                        <wcs-fetch>  (auto-fetches when url changes)
                                       │  value / loading / error / status
                                       ▼
                        state.productFetch.*  ──▶  detail page (if: blocks)
```

## Division of labor (why the page DOM lives in state templates)

- **The router owns** the URL, history, per-page `<title>`, and the fully
  static pages: the About and 404 content is written inside `<wcs-route>` and
  stamped into `<wcs-outlet>` on match.
- **State owns** every data-bound page: the list and detail DOM live in
  `<template data-wcs="if: ...">` blocks that are always in the document.

This split is deliberate. `@wcstack/state` collects `data-wcs` bindings from the
DOM present at bind time — it does not watch for nodes the router stamps later.
Content the router swaps in must therefore be static (no `data-wcs`), and
data-bound content must live under state-managed structural templates. Each
side does what it is best at, and the `path` binding is the only coupling.

## Key Points

- **`<base href="/">` is required for deep links.** Without it the router
  derives its basename from `document.baseURI`, which on a direct load of
  `/products/3` is the deep path itself — every deep link would then resolve to
  the app root. (See the router README, "basename resolution order".)
- **The server needs an SPA fallback**: `server.js` serves `index.html` for any
  extension-less non-API GET (`/products/3`, `/about`, …) so reloads and direct
  links reach the client-side router.
- **The initial load needs no seed**: `path` is an output-only `wcBindable`
  member, so the router is its authority — state reads the router's current path
  when the binding attaches and takes later changes from `path-changed`. A deep
  link renders correctly even though the router resolves its first route before
  the binding exists, because that first value is *read*, not awaited. State never
  writes `path` back, so there is no echo to suppress either.
- **`navigateUrl` is declared as both an output and an input**, which is what makes
  `this.navigateUrl = "/products/3"` navigate: a member declared only under
  `properties` is output-only, and state would never write to it.
- **`navigateUrl` is self-resetting**: the router sets it back to `null` (and
  emits `navigate-url-changed`) when navigation completes, so assigning the
  same path later still triggers a navigation.
- **Off-page fetch stays quiet**: `get "productFetch.url"()` returns `undefined`
  outside the detail page, and `undefined` is never written to an element
  (write-skip semantics) — `<wcs-fetch>` keeps its last url and does nothing.
- **No stale flash**: `detailReady` requires `value.id === productId`, so
  navigating from product A to product B shows the spinner, never A's data
  under B's URL.
