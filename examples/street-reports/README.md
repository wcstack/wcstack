# street-reports — a React team's app, moved to wcstack

みどり市 道路・公園の不具合 受付台帳: the city staff's ledger of problem reports from citizens (potholes, street
lights, park equipment, signs), in Japanese — a list filtered through the URL, a report with comments and a photo
lightbox, a form with a draft and a leave dialog, a board with live moves, statistics.

It is a **seam app** ([docs/seam-apps.md](../../docs/seam-apps.md), street-reports): the app existed in React 19
first. Its source is beside the port, in [`react-original/`](./react-original/) — for reading, not for running. A
first-time author was handed the React app and its e2e suite and asked for the same app with wcstack, the suite
unchanged. What that author wrote down — where each React construct went, and which habits led the wrong way — became
[docs/coming-from-react.md](../../docs/coming-from-react.md).

```bash
node examples/street-reports/server.js                # http://localhost:3000/
WCS_LOCAL=1 node examples/street-reports/server.js    # the repository's packages/*/dist instead of esm.run
```

No build step and nothing to install: the page loads state, router, fetch, storage, debounce, sse and the autoloader
from the CDN. The server is Node only (`examples/shared/server.js` plus this app's API); its data is generated from a
fixed seed and a fixed clock.

## For a React developer: how it is put together

**There is one page and one state.** `public/index.html` holds the markup of every page — the header, then
`<wcs-router>` with one `<wcs-route>` per React route, each body being what the page component returned — and
`public/state/app.js` holds all the state and logic as one object. It is sectioned by React file: search for
`pages/ReportListPage.jsx`, `context/ToastContext.jsx`, and so on.

| React (`react-original/src/`) | Here (`public/`) |
|---|---|
| `useState` in a page | a key of the state (`listText`, `boardMineOnly`, …). **It does not reset when the page is left** |
| unmount / mount, `key={id}` | `enterRoute(name)` / `leaveRoute(name)`, called by a `$watch` on the router's `routeName`: each page resets there what React forgot. A new report id sets `report` to `null` first, which rebuilds the `if:` branch — and the comment form in it |
| `useMemo` | getters (`get listItems()`), row getters (`get "listItems.*.href"()`, the row is `this[".id"]`) |
| `useEffect` | a `$watch` on what it depended on (it runs after the page is drawn), or `enterRoute` / `leaveRoute` |
| `useFetch` (abort, the latest wins) | one `<wcs-fetch manual>` per page, fetched by a `$watch` on the page's url getter that emits `$command.loadList`; the value is accepted only if it is the one the page shows |
| contexts | top-level keys (`staff`, `currentStaffId`, `summary`, `toasts`), read by path — no provider |
| `useReducer` | methods that write keys (`resetForm`, `showToast`, `statusChanged`) |
| JSX | `data-wcs`: `textContent: path`, `value: path` (two-way), `class.x: flag`, `attr.x: value`, `onclick: method`; `<template data-wcs="if: …">` / `for: …`. No expressions: a getter or a filter (`loading|not`, `n|gt(1)`) |
| handler arguments | a handler gets `(event, ...loopIndexes)`; otherwise a `data-*` attribute, or one method per variant |
| `key` | none: rows follow the row object. A replaced object is a new row (see `setBoardCards`) |
| `useRef` to an element | `document.getElementById(…)` in a `$watch`, after the render — not right after a write |
| components | most became markup in the route body. Three became parts in `parts/` (Declarative Custom Components, loaded by the autoloader): `<sr-pagination>`, `<sr-comment-form>`, `<sr-daily-chart>`. A part is given values by binding (`page#ro: listPage` — a bindable is two-way without `#ro`) and answers with an event (`eventToken.page: pageChosen`) |
| `useLocalStorage`, `useDebouncedValue`, `useDocumentTitle`, `useEventSource` | `<wcs-storage>`, `<wcs-debounce>`, `<wcs-head>`, `<wcs-sse>` |
| `useSearchParams`, `useNavigate` | the router's outputs bound into the state; write `navigateUrl` (push) or `replaceUrl` (replace) |
| `ErrorBoundary` | `$errorCallback` sets `pageError`; each route body is inside `if: pageOk` |
| portals | none needed: the toasts and the dialogs are written at the end of the page |
| `React.lazy` | `lib/stats.js` is imported when 統計 is first entered; the chart part arrives through the autoloader |

`public/lib/` is the React app's `src/lib/`, copied unchanged — code without React in it moved as it was.

## Checks

```bash
npx @wcstack/lint --strict --root=public public/index.html public/parts/*.html   # 0 errors, 0 warnings, 10 infos
npm install && npm test                                                          # 29 unit tests (@wcstack/testing)
```

The ten infos name keys whose values the lint cannot read (lists built with `.map()` from `lib/labels.js`, what a
`<wcs-fetch>` writes): the paths bound under them are not checked. The author checked those too, against a schema
generated from the state's JSDoc — with `@wcstack/typescript` installed, `npx wcs-schema emit state/app.js` in
`public/` writes `wcstack.manifest.json`, and the same lint then reports nothing. That file is not committed here: the
repository checks all its examples in one run of the lint, where two applications' schemas are a collision
(`wcs/manifest-state-collision`), and `examples/lending-desk` has one.

The e2e spec is [`e2e/tests/street-reports.spec.ts`](../../e2e/tests/street-reports.spec.ts): the React app's own
suite (50 tests — it locates by role, label and text, and does not care which framework drew the page), started
against this server with `WCS_LOCAL=1`.

## What 4.30.0 changed here

The app was written on 4.29.0. Landing it took out what 4.30.0 made unnecessary:

- **The event streams are `<wcs-sse>` again.** The author had replaced the element with a port of the React hook: in
  WebKit it closed and reopened on every link of the router. Since 4.30.0 it does so once per page load, at the first
  link, and no more (see "In WebKit" below).
- The lint rules of 4.30.0 (`wcs/binding-expression`, `wcs/structural-element`, `wcs/attribute-mustache`, …) would
  have named most of what the author's first, React-shaped attempts got wrong.

## In WebKit

The repository's e2e runs the suite in Chromium, and six of its tests in Firefox. The author ran all 50 in WebKit too,
with the hand-made stream and the packages from the CDN; this example differs there in two ways.

- **Up to 4.31, the first link after a page load reconnects the event stream once.** WebKit fires `beforeunload`
  before it knows that the router keeps the document; `<wcs-sse>` 4.31 closes there, learns the order from that first
  link, and leaves the stream open on every link after it (`@wcstack/sse` README, "When the page leaves"). What the
  server sends in that one gap does not arrive. The suite's "leaks no event streams" test counts the connections and
  finds six where it asks for five — in WebKit only, every run. From 4.32 the element waits a task before it closes,
  and WebKit's `navigate` comes within it: no link reconnects, and the test passes in WebKit (3 runs of 3, measured on
  2026-11-28).
- **A page cut while it loads leaves errors behind.** A test that calls `page.goto()` again right after a redirect
  cuts the part the autoloader is fetching, or the stream that is opening; WebKit prints its own error for each
  (`… due to access control checks`), and Playwright reports those as uncaught. With the packages served locally
  (`WCS_LOCAL=1`) the page is at that point more often: "/ redirects to /reports …" fails in most WebKit runs.

## What stays the app's own

- **Leaving the form with unsaved input asks in the app's own dialog** — and the router has no in-app "stay"
  (`leaveConfirm` asks with the browser's `confirm()`). So: the same guard on every other route, calling a function
  the state puts on `window`; the navigation's links are plain `<a>`s whose click handler holds the navigation until
  the dialog is answered; and a Back that the user cancels is undone with `history.go(1)` — it assumes the traversal
  was a Back. An API for this is proposed and not agreed (docs/v4-direction-2026-10.md §5.26).
- Because the navigation's links are the app's own, `<wcs-link current="page">` (4.30) is not used here; the app sets
  `aria-current` itself.
- **Every page resets its own state** on entering and leaving (`enterRoute` / `leaveRoute`): the state outlives the
  route (router README, "The state outlives the route").
- **The state is one file of about 1,250 lines.** A state assembled from page modules with `...spread` is not read by
  the lint (`--strict` fails on it since 4.30); `mount=` volumes cannot declare `$watch` or `$on`.
- **The comment form's rule is written twice** (`lib/validation.js` and `parts/comment-form.html`): an inline state
  cannot import a relative module, and a `src=` state is imported once per instance.
- **Focus after a card of the board is replaced** is put back by hand (`setBoardCards`): a replaced row object is a
  new row. `$listKeys` would keep the row (and since 4.30 the columns' getters follow such a refresh).
- **The chart's bars are SVG markup through `innerHTML:`** — the author assumed `for:` does not work inside `<svg>`.
  It does.
- The theme is stored as `dark`; the React app stored `"dark"` (JSON). The page reads both.
