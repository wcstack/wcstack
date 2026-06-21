# Pagination, five ways

[日本語版](./README.ja.md)

The same paginated list — **200 members, 12 per page, with server-side latency** — built five
times against **one shared server**. The dataset, the rendered markup and the styling are
identical across all five; only the front-end approach changes. **All five drive the
same headless `<wcs-fetch>` node** through the **wc-bindable protocol** (each via a different
binding layer), so the fetch, the abort and the stale-response protection live in the element,
and the only thing that varies is how each paradigm subscribes to it. Each demo also surfaces the
node's state machine — `page → state → HTTP status` — so the point is visible: you don't
orchestrate the async flow, you read which state (idle → loading → ready / error) the node is in.
It's a side-by-side look at how each handles three things every real paginated list needs:

1. holding the current page,
2. re-fetching when the page changes, and
3. **cancelling a superseded request** so a slow earlier page can't overwrite a newer one.

| Demo | Approach | Build step |
|------|----------|------------|
| [`state/`](./state/) | `@wcstack/state` — declarative `<wcs-fetch>` + `data-wcs`, no JS glue | none (buildless) |
| [`signals/`](./signals/) | `@wcstack/signals` — `bindNode()` adapts `<wcs-fetch>` into signals, `bindInput` writes the url | none (buildless) |
| [`vanilla/`](./vanilla/) | Hand-built DOM + headless `<wcs-fetch>` (bound with `@wc-bindable/core`'s `bind()`) | none (buildless) |
| [`react/`](./react/) | React 19 — `useState` + `<wcs-fetch>` (`@wc-bindable/react`'s `useWcBindable`) | Vite |
| [`vue/`](./vue/) | Vue 3 — Composition API + `<wcs-fetch>` (`@wc-bindable/vue`'s `useWcBindable`) | Vite |

## The shared server

[`shared/`](./shared/) holds the one server every demo talks to:

- `data.js` — 200 deterministically-generated members (`id`, `name`, `email`, `role`, `joinedAt`).
- `server.js` — `createPaginationServer()` plus a direct-run "hub".
- `style.css` — the single stylesheet all five demos use, so they look identical.

The endpoint:

```
GET /api/items?page=<1-based>&limit=12
  -> { items: [...], page, limit, total, totalPages }   (+ ~400ms latency)
```

`page` is clamped server-side to `[1, totalPages]`.

## Running

**state / signals / vanilla** are buildless and served by the hub (this also serves the gallery
at `/` and the `/api/items` endpoint). Every dependency — including `@wcstack/signals` — loads
from the CDN, so there is nothing to build first:

```bash
node packages/fetch/examples/pagination/shared/server.js
# open http://localhost:3400
```

**React / Vue** use Vite — each builds and serves itself on its own port, reusing the same
`/api/items` contract:

```bash
cd packages/fetch/examples/pagination/react && npm install && npm run start   # http://localhost:3404
cd packages/fetch/examples/pagination/vue   && npm install && npm run start   # http://localhost:3405
```

For framework dev mode (`npm run dev`), run the hub too — the Vite dev server proxies `/api` to it.

## What to compare

- **state** expresses the whole feature in HTML: a `url` getter recomputes when `page` changes,
  `<wcs-fetch>` re-fetches and auto-aborts the prior request, and the list/pager are pure
  `data-wcs` bindings — there is no imperative fetch code at all.
- **signals** adapts the same `<wcs-fetch>` into signals with `bindNode()`: the element's `value`
  / `loading` / `error` become read signals, and writing the `page`-derived `url` back with
  `bindInput` makes the element refetch and auto-abort the previous request (switchMap-style
  cancel/restart, owned by the element). No `resource()`, no hand-written `AbortController`.
- **vanilla** consumes the same `<wcs-fetch>` with the smallest possible adapter: `@wc-bindable/core`'s
  `bind()` streams the element's `value` / `loading` / `error` into a plain `state` object, and the
  only thing left to hand-write is the DOM. No `AbortController`, no loading state machine — the
  element owns those.
- **React / Vue** subscribe to the same `<wcs-fetch>` through their framework adapter
  (`useWcBindable`): derive the URL from `page`, hand it to the element, and the re-fetch, abort and
  stale-response protection are the element's job — no `AbortController` wiring in `useEffect` / `watch`.
