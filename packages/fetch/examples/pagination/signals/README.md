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

This demo is fully buildless — every dependency loads from the CDN, so there is
nothing to build first. The shared **hub** serves the page and the `/api/items`
endpoint:

```bash
node packages/fetch/examples/pagination/shared/server.js
```

Then open <http://localhost:3400/signals/>.

The import map points the signals entries and `@wcstack/fetch/auto` (which registers
`<wcs-fetch>`) at the CDN:

```html
<script type="importmap">
{
  "imports": {
    "@wcstack/signals": "https://esm.run/@wcstack/signals",
    "@wcstack/signals/dom": "https://esm.run/@wcstack/signals/dom",
    "@wcstack/fetch/auto": "https://esm.run/@wcstack/fetch/auto"
  }
}
</script>
```

This demo imports everything from the DOM layer (`@wcstack/signals/dom`), which
re-exports the whole headless core (`signal` / `computed` / `bindNode` / …) alongside
the DOM helpers (`h` / `render` / `For`), so that single `/dom` import is enough — one
self-contained CDN bundle, one reactive instance. The bare `@wcstack/signals` entry is
kept mapped so you can also import just the core directly; on the CDN each entry is its
own bundle, so import from one entry per page.

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
