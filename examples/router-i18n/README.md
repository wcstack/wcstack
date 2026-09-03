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

`<wcs-state mount="i18n">` exists only so templates can reach the dictionary by
path (`i18n.t.app.title`). It is a mounted volume, not a second home.

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

## Copying the snippet

The negotiation snippet in `index.html` is the part you lift into your own page.
It is deliberately not a package: it has to run **synchronously, before any
module**, and a custom element could not be upgraded in time (see D7 in the
design doc).

Four things to change:

| | |
|---|---|
| `SUPPORTED` | your locales, mapped to their writing direction (`{ en: "ltr", ar: "rtl" }`) |
| `FALLBACK` | the locale that must have a complete catalog |
| `STORAGE_KEY` | only if it would collide with something else you store |
| the `<a data-lang>` links | your language switch — the attribute is what records an explicit choice |

Two constraints come with it:

- **The app must be mounted at the origin root.** The snippet reads the locale
  from the first path segment. A subpath deployment (`/shop/ja/orders`) needs a
  mount prefix threaded through the segment maths and the `<base href>`.
- **Every URL on the page must be absolute**, because `<base href="/ja/">` is
  what hands the locale to the router, and relative URLs now resolve against it.

Its behaviour is pinned by [`e2e/tests/router-i18n.spec.ts`](../../e2e/tests/router-i18n.spec.ts):
the decision order, all three URL-repair shapes, and the hard/soft navigation
split. That spec starts this demo's own server rather than the shared one, for
the root-mount reason above.

## Bindings in markup the router inserts

Markup that enters the document after startup — a route that was not active when
the page loaded, a `<wcs-head>` child reflected into `<head>` — used to carry
bindings that silently did nothing. Both cases now work, through the **binder
protocol**: the router hands each inserted subtree to whoever owns bindings, and
state binds it there. See
[`docs/binder-protocol-design.md`](../../docs/binder-protocol-design.md).

That is why this demo can translate its per-route `<title>` at all. Before it,
a bound `<title>` inside `<wcs-head>` rendered empty and the page lost its
title outright.

**A page that loads the router but not `@wcstack/state` still gets a warning**
naming what will not be applied and why — there is no binder to hand the nodes
to, so the markup really is inert.

Structural rendering (`for` / `if`) still belongs outside `<wcs-router>`,
driven by the `path` the router publishes. That is a division of labour rather
than a limitation: the router decides *where we are*, state renders *what the
data says*.

## Checking the catalogs

```bash
node examples/router-i18n/check-catalogs.mjs
```

One translation problem cannot surface at runtime, so it has to be checked
statically. A key missing from *every* catalog renders empty and logs
`wcs/binding-path-missing`. But a key that exists in the fallback and is missing
from one locale renders **perfectly — in the fallback's language**. Nothing
breaks, nothing is logged, and the page quietly serves English to a Japanese
reader. Only comparing the files finds it.

The script is standalone rather than part of `wcs-validate`, because that
validator is regex-based over inline `<wcs-state>` scripts by design — it has no
module resolution — and the catalog is reached through a *dynamic* import keyed
by the runtime locale, so which file backs `t` is not statically decidable
anyway. Comparing two data files needs none of that machinery.

**Plural groups are compared per language, not key-for-key.** Which categories
exist is a property of the language: English needs `one` and `other`, Japanese
only ever selects `other`. A naive comparison reports `orders.count.one` as
missing from `ja.js` — where it would be dead weight, not a translation. The
script asks `Intl.PluralRules` what each locale actually uses. A check that cries
wolf gets muted, which costs more than not having it.

On this demo it reports exactly one key, `about.fallbackNote`, missing from
`ja.js` on purpose to show the fallback working.

## Server-side rendering

The head snippet is the *client* half of one rule: **the locale is settled
before anything reads it**. Under SSR the server settles it instead, and the
snippet must not second-guess that.

The server decides from the URL segment, falling back to `Accept-Language`,
and writes the result into the markup it sends:

```js
const locale = localeFromPath(url.pathname) ?? negotiate(req.headers["accept-language"]);
const page = `<!DOCTYPE html>
<html lang="${locale}">…`;
```

Everything downstream already reads `<html lang>` — the catalog module, the
router basename, `config.locale` — so nothing else changes. The client snippet
sees a supported locale in the URL and leaves it alone.

**Getting this wrong is visible.** If the client settles on a different locale
than the server rendered, the whole page swaps language immediately after
hydration: a flash, plus a full re-render of markup that was already correct.
That is why the locale must not be derived from anything the server cannot see
(`navigator.languages`, `localStorage`) when a URL segment is present.

This demo is client-only; [`examples/ssr`](../ssr/) covers server rendering and
hydration on their own. They are kept apart on purpose — the SSR demo has
nothing locale-dependent to observe, so wiring negotiation into it would add
code that never demonstrates anything.

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
