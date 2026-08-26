# router-i18n — multilingual pages without a live switch

**日本語版**: [README.ja.md](./README.ja.md)

```bash
node examples/router-i18n/server.js       # http://localhost:3000
```

Open `/` and you land on `/en` or `/ja` depending on your browser. Switch
language with the buttons top-right; deep links like `/ja/about` work, and
`/xx/about` repairs itself to `/en/about`.

This demo is the reference implementation of [docs/i18n-design.md](../../docs/i18n-design.md).
It adds **no library code** — everything here is the existing `@wcstack/state`
and `@wcstack/router` used as designed.

## The one decision everything follows from

**Locale is fixed at startup. Switching language is a navigation, not a
re-render.**

That makes the dictionary *immutable*, and an immutable value does not need to
live in reactive state. So the catalog is an **ES module**, and:

- a path getter reads it with a plain `import` — no cross-state read, no scope walk
- a component inside a shadow root imports the same instance, because module
  scope has nothing to do with DOM scope
- `Intl` formatters are built once at module scope
- fallback is merged **at load time**, not looked up per key

`<wcs-state name="i18n">` exists only so templates can reach the dictionary by
path (`t.app.title@i18n`). It is a projection, not a second home.

## Files

| File | Role |
|---|---|
| `index.html` | The head snippet (negotiation, `lang`/`dir`, `<base>`, redirect) and the page |
| `i18n/catalog.js` | **Canonical dictionary.** Reads `<html lang>`, imports one locale, deep merges the fallback, deep freezes |
| `i18n/en.js`, `i18n/ja.js` | Message catalogs — plain nested objects |
| `i18n/format.js` | `Intl.*` instances for the active locale |
| `i18n/state.js` | Three lines: the `<wcs-state src>` projection |
| `app.js` | App state. Imports the catalog directly for row labels and plurals |

## Five things this demo exists to show

### 1. The locale is decided before anything can read it wrong

The negotiation snippet is a **synchronous** `<script>` and the first thing in
`<head>`. Module scripts are deferred, so `catalog.js` cannot possibly run
first. That ordering is structural, not a race — which is exactly why this is
not a custom element: a tag would be upgraded far too late.

Order: URL > explicit choice (`localStorage`) > `navigator.languages` >
fallback. The URL wins so a shared link keeps its language.

The snippet writes `<html lang>`, and **nothing on this page passes a locale to
anything else**. The catalog module reads that attribute, the router basename
comes from it, and `bootstrapState` defaults `config.locale` to it — so the one
`|date` filter on the orders page prints `8/26/2026` under `/en` and
`2026/8/26` under `/ja` without being told. One source of truth, in the place
HTML already reserves for it.

### 2. The language switch has to be a *hard* navigation — and the basename is what guarantees it

`<wcs-router>` hands every same-origin navigation **under its basename** to
`intercept()`, plain `<a>` clicks included. A language link inside the basename
would be handled client-side: no reload, no re-evaluated catalog, no language
change — and nothing would look broken.

So the locale lives in the router's **basename**, not in a `/:lang` route
parameter. `<a href="/en/">` from a page whose basename is `/ja` falls outside
the basename, the router declines to intercept, and the browser navigates for
real. The switch works *because* of the basename.

The basename is supplied by writing `<base href="/ja/">` from the head snippet —
the earliest possible moment, and the standard HTML mechanism for it. The one
constraint: every URL on the page must be absolute.

Nice side effect: route patterns carry no locale at all (`/`, `/about`), and
in-app links are locale-free (`<wcs-link to="/about">`).

### 3. Dynamic keys are a row getter's job

`t[order.status]` cannot be a binding path — a path is a normalized key with no
subscripting. The row getter does the lookup and the template binds the result:

```js
get "orders.*.statusLabel"() {
  return t.orders.status[this["orders.*.status"]];
}
```

Same for currency and dates: `Intl` in the getter, not a `|filter`.

### 4. A missing key is reported, because the dictionary is plain data

`t.orders.subtotal` is bound on the orders page and exists in no catalog. The
console says:

```
[wcs/binding-path-missing] Bound path "t.orders.subtotal" does not resolve on
state "i18n": "subtotal" is not declared. … npx @wcstack/lint <file>
```

This only works because the catalog is **plain data**. The path check stops at
`unknown` the moment it meets a getter, so one convenience getter in the
dictionary would silently blind the check for that whole branch. That is the
second reason the catalog is deep-frozen.

`about.fallbackNote` shows the other half: it exists only in `en.js`, so on
`/ja` it renders in English rather than disappearing.

### 5. Structural rendering stays outside the router

`<template data-wcs="for: …">` inside a `<wcs-route>` does **not** render: the
route's nodes sit in an inert `<template>` when state builds its bindings, so
the inner structural fragment is never registered. Plain bindings inside a route
*do* work — the About page is translated in place — which makes the boundary
easy to trip over.

So the router publishes `path`, and state renders the list from a
`<template data-wcs="if: isList">` outside it. Same split as
[router-spa](../router-spa/).

## Verifying against the working tree

By default the page loads the published CDN bundles. To run it against your
local build instead:

```bash
(cd packages/state && npm run build)
(cd packages/router && npm run build)
WCS_LOCAL=1 node examples/router-i18n/server.js
```

`WCS_LOCAL=1` rewrites the `esm.run` one-liners to `/packages/<pkg>/dist/…` and
serves them from the repo, the same trick `e2e/serve.mjs` uses.

> This demo needs `@wcstack/state` **newer than 1.31.0**, for two changes:
> `<wcs-state src="/app.js">` used to resolve its URL against the state
> package's own location (so a CDN-loaded page fetched it from the CDN and
> 404'd), and `config.locale` did not yet default to `<html lang>` (so a page
> using the `auto` one-liner had no way to set it at all). Use `WCS_LOCAL=1`
> until both ship.

When copying this example out of the repo, copy `examples/shared/` alongside it.
