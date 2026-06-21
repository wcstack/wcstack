# Pagination — `@wcstack/signals`

One of five side-by-side implementations of the **same** paginated member list
(React / Vue / `@wcstack/state` / `@wcstack/signals` / Vanilla JS). All five render
identical DOM, share one stylesheet, and hit the same `/api/items` endpoint — only
the front-end code differs.

This version uses **`@wcstack/signals`**: a fine-grained, buildless reactive core. No
VDOM, no DSL — you call `signal()` / `computed()` directly and build real DOM with
`h()` / `For()`. The fetching itself is delegated to the same headless `<wcs-fetch>`
node (the `@wcstack/fetch` data node) as the other four demos, adapted into signals
with `bindNode()`.

## How to run

This demo is buildless and is served by the shared **hub**, which also serves the
locally-built `@wcstack/signals` bundles (under `/signals-dist/`) and the `/api/items`
endpoint:

```bash
# 1. Build the signals package once so dist/ exists (the hub mounts it at /signals-dist/)
cd packages/signals && npm install && npm run build && cd -

# 2. Start the hub
node packages/fetch/examples/pagination/shared/server.js
```

Then open <http://localhost:3400/signals/>.

The import map maps both signals entries to those local bundles, and `@wcstack/fetch/auto`
(which registers `<wcs-fetch>`) to the CDN:

```html
<script type="importmap">
{
  "imports": {
    "@wcstack/signals": "/signals-dist/index.esm.js",
    "@wcstack/signals/dom": "/signals-dist/dom.esm.js",
    "@wcstack/fetch/auto": "https://esm.run/@wcstack/fetch/auto"
  }
}
</script>
```

This demo actually imports everything from the DOM layer
(`@wcstack/signals/dom`), which re-exports the whole headless core
(`signal` / `computed` / `bindNode` / …) alongside the DOM helpers
(`h` / `render` / `For`), so that single `/dom` import is enough. Each entry's
bundle pulls in the same internal `core-<hash>.esm.js` chunk, so the page loads a
single reactive instance regardless. The bare `@wcstack/signals` entry is kept
mapped so you can also import the core directly — it just isn't needed here.

## The interesting bits

- **`bindNode()` adapts `<wcs-fetch>` into signals.** `bindNode(fetcher)` reads the
  element's wc-bindable descriptor and exposes its output properties (`value` /
  `loading` / `error`) as read signals you can build `computed()`s on top of.
- **`bindInput()` writes the url back → switchMap cancel.** Writing the `page`-derived
  `url` signal back with `bound.bindInput("url", url)` makes `<wcs-fetch>` refetch and
  auto-abort the previous in-flight request whenever `page` changes (switchMap-style
  cancel/restart, owned by the element). No `resource()`, no manual `AbortController`.
- **Fine-grained DOM with `h()`.** `h(tag, props, ...children)` builds real DOM once.
  A child or prop given as a function (`() => rangeText.get()`, `class: () => …`,
  `disabled: () => …`) is wired to a targeted effect, so only that one binding updates
  when its signals change.
- **Keyed lists with `For()`.** The `<ul>` uses `For(() => items.get(), …, { key: m => m.id })`,
  so rows are reconciled in place by id rather than rebuilt. The list is built **once**
  and kept mounted across reloads, so its row state survives a page change.
- **Stale-while-revalidate.** Once rows exist, a reload keeps them on screen and just
  adds `stale` to the `<ul>` (`class: () => loading ? "member-list stale" : "member-list"`).
  The list is only mounted once rows exist, so `loading` alone is enough. The
  first-load spinner only shows before the very first response. On an HTTP/network error
  `<wcs-fetch>` resets `value` to `null`, so `totalPages` falls back to `1` and the pager
  minimises to a single page — the same recovery state in all five demos.

All data comes from the shared `/api/items?page=<n>&limit=12` server (≈400 ms latency,
200 items, 17 pages) — the same endpoint the other four demos use.
