# town-archive — a long list and scrolling

みどり市 まちの記憶アーカイブ: a city's archive of 12,000 photographs, in Japanese. A **seam app** ([docs/seam-apps.md](../../docs/seam-apps.md)): a first-time author built it from the public documents on 4.23.0, to find what goes wrong when a list is long. Two pages over the same records:

- **The public site** (`/`), with `@wcstack/state` and `@wcstack/router`: a list loaded 60 photos at a time as the user scrolls, filters in the URL, columns from the grid's width, thumbnails only near the screen and at the size the column needs, photos seen reported in batches, a jump to a decade from which the list grows at both ends, favourites shared by two tabs, and a photo page whose Back and 一覧へ戻る return to the card it left.
- **The cataloguers' table** (`/staff`), with `@wcstack/signals` and nothing else: all 12,000 records in memory, only the rows around the visible part in the document, sorting, a filter on every keystroke, selection with Shift+click, bulk changes, a title edited in place, other staff's changes over server-sent events.

```bash
node examples/town-archive/server.js              # http://localhost:3000/ and /staff
WCS_LOCAL=1 node examples/town-archive/server.js  # this repository's packages/*/dist instead of esm.run
```

Node built-ins only; the data is generated from a fixed seed. Copy `examples/shared/` alongside when you copy this directory out.

## What it found

The findings and what became of each are in [docs/seam-apps.md](../../docs/seam-apps.md) ("town-archive"), and what a long list needs is in [docs/long-lists.md](../../docs/long-lists.md). In short: a button after a `<wcs-link>` in a row ran another button's handler; `<wcs-infinite-scroll>` did not load its first page and stopped in a tall window; a `$watch` did not fire for an element's first value through an accessor pair; `data-wcs` on `<body>` did nothing without a word. 4.24.0 fixes or reports them.

## What the page does itself

The app is as its author wrote it, without the three workarounds 4.24.0 made unnecessary (a request run from a `$watch` on its url, the first width applied again in `$connectedCallback`, raw copies of the list kept beside the state). What is still the page's own:

- **The public list renders only the rows near the screen.** Card heights are computed from the photos' shapes (`public/js/lib/grid.js`), `for:` runs over a getter that slices the list, and one passive `scroll` listener reports the position once a frame — no wcstack element does. Find-in-page sees only the rendered cards.
- **It places itself after a navigation** (`afterNavigation` in `public/js/site-state.js`): the row to come back to may not be in the document, so the page cannot navigate to its fragment as [the router README](../../packages/router/README.md#where-route-content-lives) suggests for a list that keeps its rows.
- **The sentinels are `<wcs-intersect>`**, one at each end, because the list grows at both ends after a jump to a decade. A list that only grows downwards uses `<wcs-infinite-scroll>` ([fetch README §5](../../packages/fetch/README.md#5-infinite-scroll-with-wcs-infinite-scroll)).
- **The cards are plain `<a>`** with a delegated handler that notes which card was opened; the ★ is a button beside the link.
- **← → on a photo page** are heard on `<main>`, not `<body>`: `data-wcs` on `<body>` is not bound.
- The waiting batch of seen photos is sent with `navigator.sendBeacon` on `pagehide`; a reload returns to within a card of where the user was, from `sessionStorage`.

## Tests

- `npm install && npm test` here: 29 unit tests of the page's own logic (`public/js/lib/`) and of the state module, headless, with `@wcstack/testing`.
- `e2e/tests/town-archive.spec.ts`: the author's browser tests, against this repository's dist.
