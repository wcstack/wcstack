# router + state + fetch + view-transition demo (admin console)

The product admin of a small store, in English and Japanese: a dashboard, a product list paged, sorted and searched on the server, a detail page, edit and create forms that show the server's validation errors next to the fields, and delete with confirmation. Every view lives in the URL (`/ja/products?page=3&sort=price&dir=desc`), lists and pages animate as they change, and leaving a form with unsaved changes asks first.

It is a [seam app](../../docs/seam-apps.md): built from the public documents to find what the package tests miss, and kept with an e2e spec ([`e2e/tests/router-admin.spec.ts`](../../e2e/tests/router-admin.spec.ts)).

## Run it

The packages load from a CDN ([esm.run](https://esm.run)), so Node.js alone is enough:

```bash
node examples/router-admin/server.js                     # http://localhost:3000 → /en/
DELAY_MS=1500 node examples/router-admin/server.js       # every API response 1.5 s late
WCS_LOCAL=1 node examples/router-admin/server.js         # use the locally built packages/*/dist
```

The server builds on `examples/shared/server.js` — copy `examples/shared/` along with this directory if you take it out of the repo. The catalog (35 products) lives in memory; it resets on restart and on `POST /api/reset` (the e2e spec calls it before each test).

API: `GET /api/stats`, `GET /api/products?page&size&sort&dir&q`, `GET|PUT|DELETE /api/products/:id`, `POST /api/products` (`422 { errors: { field: code } }` on invalid input).

## Things to try

- `/ja/products?page=3&sort=price&dir=desc` — page 3 by price, descending, in Japanese. Click a column header (page 1, sorted by it; again reverses), then Back.
- Open a product from page 3, then Back (or "Back to the list") — the same page, sort, search and scroll position.
- Edit: empty the name and save → "Required." under the name; fix it, save, edit again and save again. Create a product with an existing SKU → the SKU error.
- Change a field, then click Products, press Back or click Cancel → "Discard your changes?" (Cancel keeps you and your change). The language switch and a reload get the browser's own prompt.
- `DELAY_MS=1500`: loading states on every page; Save and Delete show their progress, and a double click sends one request.

## The seams it crosses

| Seam | How it is wired |
|---|---|
| Locale × router basename | A synchronous `<head>` script reads `/en/` or `/ja/`, writes `<html lang>` and points the static `<base href="/">` at the language segment, so the basename is the language (router README §1.4, [`router-i18n`](../router-i18n/)). Routes and in-app links carry no language. The language switch is a plain `<a>` to the other basename — a real navigation — built from the router's `path` + `searchParams`, never by string replacement. |
| `<wcs-layout>` × routes × state | `<wcs-layout layout="admin-layout">` inside `<wcs-route path="/">`: the header and side navigation are slotted, the nested routes fill the default slot, and a `path="*"` route inside the layout is the not-found page. The side navigation is `<wcs-link>`s, with `match="prefix"` on Products so it stays marked on `/products/3` and `/products/3/edit`. |
| URL query ⇄ state ⇄ `<wcs-fetch>` | `searchParams: query` on `<wcs-router>`; `page` (converted with `parseInt`), `sort`, `dir`, `q` are getters over it, the list's url is a getter over them, and the headers, pager and rows are plain `<a href>` links. A page past the end is replaced with the last page. `navigateUrl` / `replaceUrl` take route paths (`/products?…`); hrefs add the basename. |
| `$listKeys` × `<wcs-view-transition>` | The rows are copied into a list of the state's own with `$listKeys: { rows: "id" }`, so a re-sort moves the same `<tr>`s, named by `naming="auto"`, inside a transition. Typing in a form is a value-only update and starts none. |
| Two-way form bindings × fetch `body` | The form edits a string copy (`draft`), never the fetched product. Save writes `url`, `method`, a **new** `body` object and `trigger` of one manual `<wcs-fetch>` (create and update never overlap: one form at a time, and Save is disabled while saving); `422` field errors come from `error.body` through `eventToken.error`. Saving and deleting use `replaceUrl`, so Back does not reopen a saved form or a deleted product. A `rev` counter in every GET url makes the next read fresh after a write. |
| Unsaved changes × navigation | `leaveConfirm: discardPrompt` on `<wcs-router>`, with `get discardPrompt() { return this.dirty ? this.t.form.discard : null; }`. The save handler restores the baseline and writes `replaceUrl` in the same update, so a successful save does not ask. |
| `$watch` × the router's first values | "The list the staff member came from" is recorded by `$watch` handlers on `routeName` (it fires once for the router's value at load, so a deep-linked list counts) and on the `listPathNow` getter (query-only navigations). Delete returns there, or to page 1. |
| Strings, prices, dates | Both dictionaries are in the state module (`t: DICT[LANG]`, shaped by a JSDoc `@typedef` for `wcs-validate`). Prices, counts, dates and plurals are `Intl` formatters built once at module scope and used in getters (`2026/10/13` / `Oct 13, 2026`, `¥1,800` / `￥1,800`, "1 product"). |

## What building it found

The first-time author (public documents only, `@wcstack/*` 4.0.4) logged 24 frictions; every life event passed in the end, several through workarounds. 4.1.0 fixed or decided the ones this app needed, and the workarounds are gone from this page:

- A navigation the page cancelled itself made the router throw (`intercept()` on a cancelled event) — fixed.
- With `<wcs-view-transition>`, each keystroke in a bound input started a page-wide transition and the click after it was lost — now only a list or branch change animates (the page no longer narrows the transition to the router on its forms).
- There was no way to ask before leaving unsaved changes (the page listened to the Navigation API itself) — `<wcs-router leaveConfirm>`.
- `<wcs-link>` was active on its exact path only (the side navigation computed its own marking) — `match="prefix"`.
- `$watch` did not fire for a value the router already held at load (the page seeded it in `$connectedCallback`) — it fires once when the watches start.
- A dotted getter (`get "nav.x"()`) warned "silently dropped" while it worked — fixed.
- The fetch README now shows reading a `422`'s field errors and "one `<wcs-fetch>` is one request at a time"; the router README says `navigateUrl` takes a route path.

The full record — the other apps, what was classified as a defect, a design question, a lint gap or a document gap, and what is still open — is in [docs/seam-apps.md](../../docs/seam-apps.md).

## Known limitations

- The language switch leaves the router's basename (a real navigation), so with unsaved changes it gets the browser's own "Leave site?" prompt (`beforeunload`), not "Discard your changes?". Declining keeps you on the form.
- `/products/new` is also under `/products`, so `<wcs-link match="prefix">` gives Products `aria-current="true"` there next to New product's `"page"`; the stylesheet marks only the page link visually.
- A Back / Forward the browser does not let a page cancel is not asked (router README, `leaveConfirm`).
- "Back to the list" forgets where you came from after the detail page is reloaded (the list path is kept in state, not in the URL); browser Back still works.
