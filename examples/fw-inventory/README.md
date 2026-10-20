# The I/O nodes inside React and Vue (a shop's inventory tool)

A small shop keeps its inventory in two apps on one origin. The back office is a React 19 app: a product list with search, paging and sort, live stock levels, filters that survive a reload, a page per product with photo uploads, and a list of picked items. The warehouse panel is a Vue 3 app: it parses a stock CSV in a worker and imports it, and shares the picked list with the back office in another tab. Both drive the wcstack I/O nodes through the `@wc-bindable` adapters; there is no `@wcstack/state` and no `data-wcs`.

Packages: `@wcstack/fetch` (`<wcs-fetch>`, `<wcs-fetch-header>`), `sse`, `storage`, `upload`, `broadcast`, `worker`, with `@wc-bindable/react` / `vue` 0.10, React 19, react-router 7, Vue 3.5 and Vite.

## Run it

It is a Vite app, so it needs an install and a build:

```bash
cd examples/fw-inventory
npm install
npm run build && node server.js         # http://localhost:3000   (PORT=… to change)
# or, while editing:
node server.js & npm run dev            # Vite on http://localhost:5173, proxying /api and /photos to :3000
```

It uses what 4.6 adds (`storage-key`, files before the url, the new warnings). Until 4.6 is on npm, build it from this repository with `WCS_LOCAL=1 npm run build`: the `@wcstack/*` imports then resolve to `packages/*/dist` (build those packages first, since the committed dists are rebuilt at a release only).

| URL | |
|---|---|
| `/` | the back office (React): products, live stock, filters, picked list |
| `/products/:id` | a product, its photos and uploads |
| `/warehouse.html` | the warehouse panel (Vue): the CSV import and the picked list |

The server keeps everything in memory and changes a random product's stock every second or two (`TICK=0` stops it). `DELAY=<ms>` slows every API answer.

## Things to try

- Type quickly in the search box: each keystroke is a request, the older ones are aborted, and the last one wins.
- Reload: the search, sort and page come back from `<wcs-storage>`. Open a second tab and search there: the first tab follows.
- `curl -X POST localhost:3000/api/test/burst?n=5`: five stock events in one write; all five rows change.
- On a product, pick two images at once: each has its own progress, Cancel and Retry. An image over 1 MB is refused (413). `curl -X POST "localhost:3000/api/test/fail-next?kind=upload"` fails the next one (500).
- In `/warehouse.html`, choose a CSV with a `sku,stock` header and import it; an unknown SKU is refused row by row (422). Press "Ping worker" twice: two pongs.
- Pick items in the back office and open the warehouse panel in another tab: the list is there. Mark one done there, or pick a SKU: the back office follows.

## The seams it crosses

| Seam | How the app handles it |
|---|---|
| The adapter's values × outputs that are events | `values` is for states (`connected`, `loading`, `error`, a fetched `value`). The stream's, the channel's and the worker's `message` are taken off the element's event (`useIoEvent`, `listen`): through `values`, five stock events in one write reached React as one, and Vue saw the same "pong" sent twice as one. |
| The adapter's callback ref × commands | `useIoNode` keeps the element beside the adapter's callback ref, to call `fetch()` (Retry, Refresh), `abort()` and `post()`. Refresh calls `fetch()`: a `trigger` from React state runs once. Vue names its template refs statically (`ref="workerEl"`). |
| React's `key` × `<wcs-storage>` | The filters use `storage-key`: React keeps `key` for itself. They are read once in the element's ref (it loads when it connects), saved only after that and only when a field changes, and another tab's save is taken off `wcs-storage:value-changed` — skipping the events this tab's own saves dispatch. |
| React 19's props × `<wcs-upload>` | One `<wcs-upload>` per file, `files={files}` before `url={url}`: since 4.6 the files wait for the url. A retry assigns a new array: the element uses its files up. |
| Vue's reactivity × structured clone | The picked list is posted as a deep plain copy (`JSON.parse(JSON.stringify(…))`): its rows are reactive proxies, which `toRaw()` does not unwrap. |
| An object input × in-place changes | The CSV import assigns a new `body` each time (`el.body = { rows }`, then `el.fetch()`): the element uses `body` up, and a body changed in place is not written again. |
| Two tabs × two frameworks | `localStorage` (the filters) and `<wcs-broadcast name="inv-picked">` (the picked list) connect the tabs; a tab that opens says "hello" and gets the current list. |
| Vite's dev proxy × SSE | `vite.config.js` ends the browser's response on a proxy error, so `<wcs-sse>` reconnects after the server restarts. |
| Tags × the first render | Each entry imports the packages' `/auto` before rendering, so every object input is a property (`files`), never an attribute. `src/react/wcs-jsx.d.ts` declares the tags for TypeScript (`npm run typecheck`). |

## What building it found

A first-time author built it from the public documents and the published 4.5.0 ([docs/seam-apps.md](../../docs/seam-apps.md), "fw-inventory"): 14 frictions, and 12 of 19 deliberate mistakes that nothing on the client reported. What 4.6 did about the wcstack ones, in short:

| Found | 4.6 |
|---|---|
| `<wcs-storage key="…">` in JSX or a Vue template stored nothing — React and Vue keep `key` — and said nothing | `storage-key`; a save without a key warns `[wcs/command-not-ready]` |
| `<wcs-upload files={files} url="…">` uploaded nothing (React 19 applies props in the order written) | the files wait for the url |
| A post of a Vue reactive list failed with only `error` to show it, after `toRaw()` too | `[wcs/post-uncloneable]`; the documents say a deep plain copy |
| An object written as an attribute (a prop before the definition, Vue's `.attr`) gave the element nothing | `[wcs/input-as-attribute]` |
| An autoloader wrapper could not define `<wcs-fetch-header>`, and the request lost its header | `WcsFetchHeader` / `WcsFetchBody` exported; `[wcs/fetch-helper-undefined]` |
| `import("@wcstack/sse/auto")` did not type-check | `dist/auto.d.ts` |
| The lint said "0 error(s)" for the `.vue` / `.tsx` files and the root-only pages | `not read:` / `nothing to check:` |

The adapters' part — occurrences lost in `values`, no element beside the callback ref, the Vue README's `:ref` — is proposed upstream as [wc-bindable-protocol#42](https://github.com/wc-bindable-protocol/wc-bindable-protocol/issues/42).

Landing it here removed the workarounds 4.6 made unnecessary — `el.key = …` in the ref instead of the key in the markup, and `url` before `files` — and the author's lab pages. Landing it also found one more: the author's filters applied the adapter's `value` back to React state to follow the other tab, and an own save came back a render late and undid the typing in between, so typing quickly saved and applied "bol" and "bolt" in turn without end. The filters now follow the other tab from the element's event.

## Known limits

- **Occurrences need the element**: until the adapters offer a per-update callback (#42), each `message` is read with `addEventListener`, and the code knows the event's name.
- **No JSX declarations ship with the packages**: `src/react/wcs-jsx.d.ts` is written by hand.
- **A dead stream under the dev proxy needs the `configure` handler**; without it the page stays "live" and receives nothing.
- **Filters that only restore say nothing without a key**: an element connected without one is also what a binding looks like before it applies the key, so only a save, load or remove warns.

## Tests

`e2e/tests/fw-inventory.spec.ts` (CI builds the app with `WCS_LOCAL=1` over the dists it rebuilt from src; one server per worker on port 5200 + the worker index, `TICK=0`) checks the list's search, paging, sort and the last query winning, a failure and Retry, five stock events in one write, filters restored without being overwritten and kept across a reload, a search followed in a second tab, deep links and Back, uploads with a failure, a retry and a 413, the CSV import with a 422 and two pongs, the picked list across a React and a Vue tab, and a quiet console in each. Locally:

```bash
cd examples/fw-inventory && npm ci && WCS_LOCAL=1 npm run build && cd ../../e2e && npx playwright test tests/fw-inventory.spec.ts
```
