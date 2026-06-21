# Pagination — Vue

A **Vue 3** implementation of the shared pagination demo. Built with the
Composition API (`ref` + `computed`), it subscribes to a headless `<wcs-fetch>`
node (the `@wcstack/fetch` data node) with `@wc-bindable/vue`'s `useWcBindable`.
The `url` is derived from `page` and handed to the element via `:url`, so there is
no `fetch` and no `AbortController` here — the re-fetch, abort and stale-response
protection all live in the element. Same data, same look, same behaviour as the
other four demos; only the front-end code differs.

> `vite.config.js` sets `compilerOptions.isCustomElement` (tags starting with
> `wcs-`) so the template compiler treats `<wcs-fetch>` as a native custom element.

## How to run

```bash
cd packages/fetch/examples/pagination/vue
npm install
npm run start          # build + serve the dist on http://localhost:3405
```

Then open <http://localhost:3405>. `npm run start` is self-contained: its `server.js`
also serves `/api/items` on the same port, so you do **not** need to start the shared
hub for it (the hub is only needed for `npm run dev` below).

For development with live data, run the shared hub (which provides `/api/items`)
and start Vite — the dev server proxies `/api` to the hub:

```bash
# terminal 1 — shared API hub on :3400
node packages/fetch/examples/pagination/shared/server.js
# terminal 2 — Vite dev server
cd packages/fetch/examples/pagination/vue && npm run dev
```

It hits the same shared `GET /api/items?page=<n>&limit=12` endpoint as the other
four demos.

## What's interesting here

- **Fetching is delegated to `<wcs-fetch>`** — the `url` is a `computed` derived
  from `page` and handed to the element via `:url`. The element refetches and
  auto-aborts the previous in-flight request, so an older response can never
  overwrite a newer page. No `load()`, no `AbortController`.
- **State via `useWcBindable`** — the adapter mirrors the element's `value` /
  `loading` / `error` into reactive `values`, so the derived values stay plain
  `computed`s.
- **Stale-while-revalidate** — once rows exist they are kept on screen (dimmed via
  the `stale` class) during a reload instead of flashing the spinner; the spinner
  only appears on the very first load. On an HTTP/network error `<wcs-fetch>` resets
  `value` to `null`, so `totalPages` falls back to `1` and the pager minimises to a
  single page — the same recovery state in all five demos.
- **`computed` for everything derived** — the page-window tokens, range text and
  page label are all `computed`, so the template stays declarative.
