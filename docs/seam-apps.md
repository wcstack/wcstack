# Seam apps: building apps that find what tests miss

**日本語版**: [seam-apps.ja.md](./seam-apps.ja.md)

A *seam app* is an application written to find defects, not to show a feature. This document says why we build them, what makes one find things, how to run one, and where the result goes. The last section is the log of the apps built so far.

## Why

The shop tutorial on the site (16 steps, one app growing from a single product to a routed, tested, published shop) led to four patch releases in two days:

| Release | Found while writing | Kind |
|---|---|---|
| 4.0.1 | A bare `class:` / `attr:` was accepted and did nothing. The lint reported every row field of a list derived in a getter as missing — **the `wcstack` README's own Todo app** had three such warnings. | A wrong form passes silently; a right form is flagged |
| 4.0.2 | A write below a `<wcs-storage>`-bound path is never saved; a seeded slot loses its seed on a first visit. | Broken after a reload, silently |
| 4.0.3 | An accessor pair bound without `#init=element` saves over the stored value; `<wcs-fetch>`'s `body` is sent once — **the fetch README's POST example** sent no body the second time. | Broken on the second time or after a reload, silently |
| 4.0.4 | A `<wcs-outlet>` away from its router stays empty while the pages render elsewhere — **`examples/router-i18n`** had it wrong. | Works, but not where the author meant, silently |

None of them was a crash. Every one sat **between two packages** (state × storage, state × fetch, router × the page's layout), showed only **over time** (a reload, a second submit, a deep link), and was **silent**: nothing in the console, nothing from the lint. Three of them were in our own README or examples.

The repository already had about forty examples, each with a real-browser e2e test. They did not find these, for three reasons:

- **They are one screen and one or two packages.** A demo shows a feature; it rarely crosses a seam or lives through a reload.
- **Their author knows the rules.** Whoever writes a demo for a package steers around its sharp edges without noticing.
- **Their tests check presence, not intent.** `router-i18n`'s test checked that the page text appeared; the text appeared — in the router's own outlet, not the one the page placed.

The tutorial was different on each count, and that is what this document turns into a method.

## What makes an app find things

1. **It grows, and it lives.** Build it in steps, each adding a package or a feature, and live through what real use brings: a reload, the second time, a deep link, Back and Forward, a second tab, a slow or failing network, an expired session. Most of the defects above appear only on the second pass.
2. **It crosses seams on purpose.** Pick the app for the seams it crosses — two packages exchanging values, a package meeting the page's layout, the runtime meeting the lint — not for the features it shows. Another app of a shape already built finds less.
3. **It is written from the public documents only.** The author reads what a user can read — the package READMEs, the root and `wcstack` READMEs, the AI authoring skill, the examples — and not `packages/*/src`. When the documents do not say, the author guesses as a user would, and the guess is the finding.
4. **Every friction is recorded.** Each time the author stops — a form that does not work, a sentence that does not answer, a message that does not help — it goes in the friction log, with what was read, what was written, what happened, and what was expected.
5. **It makes the common mistakes on purpose.** For each likely mistake, write it and see whether anything says so: the runtime, the lint, the type checker. A mistake that fails silently is a finding even when the app itself is right.
6. **It is checked for intent, not presence.** Assert *where* a thing rendered, *what* survived the reload, *what* the second request sent, *which* URL the page is on — not only that some text appeared.
7. **It goes through the whole toolchain.** `wcs-validate`, `wcs-tsc` where the state is typed, `@wcstack/testing` for a headless test, and a pinned, integrity-checked page for production — each is a seam too.

## How to run one

1. **Brief.** Write the app's story, its steps, the seams each step crosses, the life events to go through, the mistakes to try, and the server API it needs (the backend is not under test, so its contract is fixed up front). The candidates below are briefs in short form.
2. **Build from the documents.** A first-time author builds it — in practice a subagent given the brief and told which files it may read (the public documents above) and which it may not (`packages/*/src`, the tests, `docs/` design notes). It runs the app against the published packages on the CDN, as a user would, and keeps the friction log.
3. **Verify intent.** Open the app in a real browser and go through the life events; write them as an e2e spec that asserts intent (the checklist below). Run `wcs-validate` over the page. **Reproduce every claim of the friction log yourself** before classifying it — a first-time author's diagnosis can be wrong in either direction (in `router-auth`, "even an `if:` on the same path does not shield its content" was wider than the defect: only an `if:` over a getter did not).
4. **Make the mistakes.** Go through the mistake list; record which ones are loud and which are silent.
5. **Classify.** Every entry of the friction log and the mistake pass is one of:
   - **runtime defect** — a package does the wrong thing;
   - **lint gap** — a mistake the static check could see and does not;
   - **document gap** — the documents do not say, or say wrong (an example that does not work counts here);
   - **design question** — the behavior is as designed, but the design is the friction.

   Each gets an outcome: fixed in a PR, an issue, or a decision recorded (as [router-outlet-placement.md](./router-outlet-placement.md) records one).
6. **Keep what crosses a new seam.** The app goes to `examples/` with its e2e spec; the findings go in the log below and in the app's README. A fix lands with its own tests in the package it changes, as usual — the app is not the regression test for it.

### Intent checklist

Not every app needs every line, but each line skipped should be a choice:

- **Where**: the content rendered in the element the page meant (not just somewhere in the document).
- **Reload**: what the app keeps across a reload is there, and what it should not keep is not.
- **Second time**: the second submit, the second navigation to the same route, the second item added behave like the first.
- **Deep link**: opening a URL directly (not through the app's links) lands on the same page with the same data.
- **History**: Back and Forward restore the page, the URL and the data, and do not show what should be gone (a page after logging out).
- **Another tab**: two tabs on the same data agree, or deliberately do not.
- **Network**: a slow response, a failing one (4xx / 5xx), and no network at all each show something sensible, and recovering works.
- **Console**: no errors and no warnings in the right app; the expected warning in each mistake.

## Where they go

**In `examples/`**, as cross-package apps alongside the demos, with an e2e spec in `e2e/tests/`.

- `examples/` already holds "apps that compose two or more packages", which a seam app is. The shared demo server, the `WCS_LOCAL=1` switch to the local `dist`, the e2e setup that starts an example's own server, the CI e2e job and the `wcs-validate` job that reads every page in the repository all apply without new infrastructure.
- A separate top-level directory (`apps/`) would duplicate that infrastructure and leave the demos as the shallow tier. Holding the examples to the intent checklist is the better outcome.
- The site's tutorial stays the teaching material; a seam app is larger and not written to be read step by step.
- A separate repository would cut the e2e off from the local `dist`, so a fix and the app that found it could not be checked in one PR.

What does not go there: the first-time author's raw attempt (excerpts go in the findings), and the mistake variants (each becomes a unit or lint test in the package that makes it loud).

Seam apps are listed in their own table in [examples/README.md](../examples/README.md), with the seams they cross. Like every example, they load the packages from `esm.run` (npm `latest`), so they must keep working on each release; the e2e job runs them against the local `dist`.

## Candidates and log

| App | Seams | Life events | Status |
|---|---|---|---|
| `router-auth` — a members area: log in, protected pages, an order history from an API that needs a token | router guards × state, `<wcs-fetch>` 401 × navigation, `<wcs-storage>` × the guard, guard loaders (`data`) | deep link while logged out → log in → back to that page; reload while logged in; the session expiring mid-use; Back after logging out; logging out in another tab | in [`examples/`](../examples/README.md#seam-apps) with its e2e spec (2026-10-14); findings below |
| `router-admin` — an admin console: nested layouts, a list with server-side paging and sorting in the URL, edit forms with server validation, view transitions, two languages | `<wcs-layout>` × state, query ⇄ state ⇄ fetch, two-way form bindings × fetch `body`, `<wcs-view-transition>` × router × lists, locale in the basename | deep link to page 3 sorted by name; edit, save, save again; a 422 with field errors; reload on an edit page; Back from a detail | in [`examples/`](../examples/README.md#seam-apps) with its e2e spec (2026-10-14); findings below |
| `state-collab-board` — a shared board: changes from others arrive over SSE, yours are applied at once and rolled back if the server refuses | `<wcs-sse>` × state lists, `<wcs-fetch>` × optimistic updates, `<wcs-network>` × state, reconnect × resync | two browsers; a refused change; going offline and back; the server restarting | in [`examples/`](../examples/README.md#seam-apps) with its e2e spec (2026-10-14); findings below |
| `signals-shop` — the tutorial's shop on `@wcstack/signals` | signals × router, signals × `<wcs-fetch>` / `<wcs-storage>` through the wc-bindable bridge | the tutorial's own (reload, deep link, Back, a second tab) | in [`examples/`](../examples/README.md#seam-apps) with its e2e spec (2026-10-14); findings below |
| `ssr-news` — a news site rendered by `@wcstack/server`: an article list, article pages with comments, reader preferences, a section layout, the production form (CSP, SRI, an HTML cache) | `@wcstack/server` × router × state, `<wcs-fetch>` on the server and at hydration, `<wcs-link>` / `<wcs-head>` / `<wcs-layout>` under SSR, the client's version × the server's | a deep link and a reload; no JavaScript; a slow client bundle (typing before hydration); the server restarting; a client of another minor; the HTML cache after a post | in [`examples/`](../examples/README.md#seam-apps) with its e2e spec (2026-10-18); findings below |

### router-auth (2026-10-13)

The first-time author (a subagent, public documents only) logged 23 frictions; all seven life events passed in the end, three of them only after a workaround. Reproduced and classified:

| Kind | Finding | Outcome |
|---|---|---|
| runtime defect | state: an `if:` over a getter applied its content with the value that closed it (filters threw) | fixed |
| runtime defect | router: a guard redirect pushed a history entry — Back returned to the guarded URL and was redirected again | fixed (replace) |
| runtime defect | router: a guard redirect on landing reloaded the document (it ran before the navigate listener existed) | fixed |
| runtime defect | router: a `<wcs-guard-handler>` without `guard=""` left the landing route unguarded (later navigations were guarded) | fixed — decision: a handler enables the guard |
| runtime defect | router: a new route's content was bound with the previous route's params | fixed — decision: outputs before the content, `path` after |
| runtime defect | fetch: `<wcs-fetch-header>` had no `value` property; `value:` sent an empty header | fixed |
| design question | router: every designed redirect logged a warning (with a double period); no limit on guards redirecting each other | decision: no log; stop after 10 in a row with an error |
| lint gap | `wcs/storage-seed-clobber` missed a seed with content, and was a warning (the skill's `--errors-only` gate passed it) | fixed — decision: any literal seed, as an error |
| document gap | where a guard reads the session, that its module runs once, `toPath` without the query, `navigate()` rejecting on a redirect, a header from state, the storage README's sessionStorage example and `undefined` / `null` contradiction | fixed |
| lint gap | an `$on` handler written with `this`; `onsubmit:` without `#prevent` (with the router, the native GET puts the password in the URL) | see [What was left open](#what-was-left-open-2026-10-14) |
| design question | re-entering a route re-fires its `<wcs-fetch>` with the previous `url` before state writes the new one | see [What was left open](#what-was-left-open-2026-10-14) |

### router-admin, state-collab-board, signals-shop (2026-10-13)

Built in parallel after the pilot, the same way. All life events passed in the end (10, 6 and 17 checks); 24, 14 and 18 frictions. Reproduced and classified:

| App | Kind | Finding | Outcome |
|---|---|---|---|
| router-admin | runtime defect | router: a navigation the page cancelled itself (an unsaved-changes check) made the router call `intercept()` on it — an uncaught `InvalidStateError` | fixed |
| router-admin | design question | view-transition: every drain pass ran in a transition, so each keystroke in a bound input started one and the click after it was lost (5 of 5) | decision: only a list or branch change animates; view-transition-design §7.2 amended |
| router-admin | runtime defect | state: a binding to a getter declared under a key the data lacks (`get "box.label"()`) warned "silently dropped" while it worked | fixed |
| router-admin | design question | no way to ask before leaving a page with unsaved changes (the author used the Navigation API directly; Firefox lacks it) | decision: `<wcs-router leaveConfirm>` |
| router-admin | design question | `<wcs-link>` was active on its exact path only | decision: `match="prefix"` |
| router-admin, state-collab-board | design question | `$watch` did not fire for a value an element already had when its binding attached (the router's first params, an open `<wcs-sse>`): whether it fired depended on load speed | decision: it fires once when the watches start |
| state-collab-board, router-auth | lint gap | an `$on` handler written with `this` (the runtime calls it as `handler(state, event)`) | fixed: `wcs/on-handler-this` (error) |
| state-collab-board | design question | no online / offline output (the author listened on `window`) | decision: `<wcs-network offline>` — not `online`: a `data-wcs` name starting with `on` is an event binding, which the browser check of the new output caught |
| state-collab-board | document gap | one `<wcs-fetch>` is one request at a time; field errors in `error.body`; SSE `Last-Event-ID` only after an event with an `id:`, and no retry after an HTTP error; 69 package READMEs loaded `@wcstack/state` before the I/O packages | fixed |
| signals-shop | design question | a keyed `For` row keeps the item it was built with: an immutable update showed stale rows (the README's own example) | decision: `each`'s third argument `current()`; rows still reused (rebuilding them, first proposed, would have rebuilt every row on each re-fetch) |
| signals-shop | design question | `h()` ran a lowercase `onclick` function at render, as a reactive prop | decision: any `on…` key with a function is a listener (`onclick` → click, `onadd-to-cart` → add-to-cart) |
| signals-shop | lint gap | `wcs/base-href-missing` missed a router imported through an import map | fixed |
| signals-shop | document gap | the signals README still said 1.x and pinned 1.25.0; no signals × router / `<wcs-storage>` recipe; `@wcstack/testing` is for `<wcs-state>` pages | fixed |
| all three | open | lint: in-place mutation through `Object.assign` or an alias; `$on` writes as evidence for `wcs/getter-untracked-read`; a getter reading `location`; a bare `{{ }}` under a route; `onsubmit:` without `#prevent`. Runtime: a layout without its default slot drops the page silently; route re-entry re-fires `<wcs-fetch>` with the old `url`; `date` / `locale` cannot format "Oct 13, 2026" or currencies. Signals dev mode: a computed that tracks nothing. The tutorial's step 13 loads state first | see [What was left open](#what-was-left-open-2026-10-14) |

### Landing them in examples/ (2026-10-14)

After 4.1.0 the same authors moved their apps into `examples/`, took out the workarounds 4.1.0 made unnecessary, and wrote an e2e spec each (10, 15, 7 and 8 tests, asserting intent). Doing so found more:

| Kind | Finding | Outcome |
|---|---|---|
| release defect | the published `@wcstack/lint` / `@wcstack/typescript` 4.1.0 did not know `<wcs-network>`'s new `offline`: `release.yml` built them before it regenerated the built-in tag catalog, so a new member reached the lint one release late | fixed: the release rebuilds both after regenerating the catalog |
| runtime defect | router: `navigateUrl` / `replaceUrl` to a page whose guard redirects logged `navigate failed: AbortError` (and a guard loop logged ten `Fallback navigation failed`) — a redirected navigation rejecting with `AbortError` is designed | fixed: an `AbortError` is not reported |
| lint gap | `wcs/on-handler-this` missed an alias (`const state = this`) | fixed: any own `this` in a `$on` handler |
| test defect | an e2e assertion pinned the SSR snapshot's minor version (`4.0.`), failing on every PR after 4.1.0 | fixed |
| design question | a language switch is a real navigation (the locale is in the basename), so unsaved changes get the browser's `beforeunload` prompt, not `leaveConfirm`'s message; `match="prefix"` marks "Products" on `/products/new` too; `$watch` on a getter does not fire for a first value an element brought | see [What was left open](#what-was-left-open-2026-10-14) |
| open | signals: an object prop on an element defined after `h()` lands as an attribute; `bindNode` before the element is defined gives a generic error; lint: `onsubmit:` without `#prevent`, in-place changes through `Object.assign` / an alias, `$on` writes for `wcs/getter-untracked-read`, `signals-dual-entry` across a sidecar module | see [What was left open](#what-was-left-open-2026-10-14) |

### What was left open (2026-10-14)

The rows marked open above, after 4.1.1. The author decided the design questions (all as recommended).

| Kind | Finding | Outcome |
|---|---|---|
| design question | a language switch is a real navigation (the locale is in the basename), so unsaved changes got the browser's `beforeunload` prompt, not `leaveConfirm`'s message | decided: `leaveConfirm` asks before a navigation that leaves the page and the page may cancel (out of the basename, another site, a form submission) where the Navigation API is; accepted, the browser does not ask again (checked in Chromium: `navigate` comes first and is cancelable) |
| design question | `match="prefix"` marks "Products" on `/products/new` next to "New product" | decided: as designed — the section (`aria-current="true"`) and the page (`"page"`); the router README says to style `[aria-current="page"]` for one mark |
| design question | `$watch` on a getter did not fire for a first value an element brought | decided: a root getter that reads such a path fires once when the watches start, `prev` `undefined` (4.1.0's rule, extended) |
| design question | `date` / `locale` could not give "Oct 13, 2026" or a currency | decided: a style for `date` / `time` / `datetime` (`date(en-US,medium)`) and `currency(code, loc?)`; plurals stay in getters (`Intl.PluralRules`) |
| runtime defect | a layout template without a default `<slot>` dropped the nested routes without a word; an outlet a layout template brings was not warned about | fixed: `[wcs/layout-slot-missing]`, and `[wcs/router-outlet-misplaced]` for that outlet, at runtime; the lint reports the slot from the markup |
| design question | re-entering a route re-fired its `<wcs-fetch>` with the previous `url` | already gone in 4.1.0 (params reach state before the content); router-auth's e2e now checks the request log |
| runtime defect | the message for an ISO string given to `date` called `textContent: iso|date` "prop: iso" | fixed: a failed binding is named as written, with its node; the type errors say what they got and how to convert it |
| runtime defect | signals: an object prop for an element defined after `h()` landed as `[object Object]`; `bindNode` before the definition gave a generic error; dev mode said nothing about a `computed` / effect that tracks nothing | fixed: the object is held and assigned through the setter once the element is defined (checked in Chromium too — happy-dom replaces an element instead of upgrading it); `bindNode` says the tag is not defined yet; `UNTRACKED_COMPUTED` / `UNTRACKED_EFFECT` |
| lint gap | `onsubmit:` without `#prevent` | fixed: `wcs/submit-without-prevent` (warning) |
| lint gap | in-place changes through `Object.assign` or an alias, and through a `$on` handler's state | fixed: under `wcs/nested-assign` / `wcs/array-*` (error). Checking it found a document gap too: assigning the same array back — or `$postUpdate` — adds, removes or replaces no row of a list (rows follow only a new array, as the array-mutation design records); the state README's "an array write always passes, even the same reference" read as if it would. The README says so now |
| lint gap | `$on` writes as evidence for `wcs/getter-untracked-read`; a getter reading `location` | fixed: both (`location`'s `pathname` / `search` / `hash` / `href` — not `protocol` / `host`, which two examples read to build a WebSocket URL) |
| lint gap | bare `{{ }}` under a route | fixed: `wcs/route-bare-mustache` (warning), under a layout template too |
| lint gap | `signals-dual-entry` across a sidecar module | fixed as far as the page shows it: an import map that maps both entries warns (the lint does not read other files). The fetch pagination signals example mapped both |
| document gap | the site tutorial's step 13 loads `@wcstack/state` first, against the skill and the examples | fixed on the site |

### ssr-news (2026-10-18)

The first app under [docs/v4-direction-2026-10.md](./v4-direction-2026-10.md) (ja), which makes each minor release one seam app. A news site rendered by `@wcstack/server`: an article list, article pages with comments, reader preferences, a section layout, and the production form (CSP, SRI, an HTML cache). The first-time author used the public documents and the published 4.2.0. It logged 27 frictions, seven of them severe (wrong content, lost input, a security hole or a broken page, with no message). It also made 12 mistakes on purpose, and 9 of them were told by nothing. Two life events failed: text typed before hydration was erased, and a client of an older minor left the article page blank.

A second subagent reproduced the browser-side claims in Chromium against the published packages; the server-side ones were reproduced by hand. Classified:

| Kind | Finding | Outcome |
|---|---|---|
| runtime defect | server: work an element started during a render outlived it — a `<wcs-fetch>` request that failed after the render, every tick of a `<wcs-timer>` — and threw an uncaught `TypeError`, ending a plain Node server | fixed (#469) |
| runtime defect | state: the snapshot builder moved rows behind their anchor, disconnecting the custom elements in them; a `<wcs-link>` in a `for:` row or an `if:` branch was served empty (no title, no `<a>`), and threw `Invalid URL` after hydration | fixed (#470): the anchors move; the client reads a link's children in its `<a>` and adopts the row |
| runtime defect | router: a `<wcs-link>` that connects before its `to` is written threw and never showed — a page-level `attr.to:` when the router loads first, the recommended order, with no SSR involved | fixed (#470) |
| runtime defect | router: `<wcs-head>` moved its children into the server's `document.head`, which is not serialized; an adopted route's `<title>` never changed for the session | fixed (#470): the children stay in the element on the server |
| runtime defect | router: a deep link into a `<wcs-layout>` route threw `wcs-layout-outlet has no layout.` at every load | fixed (#470); the layout is still rendered again on the client (layouts are not adopted), which the READMEs now say replaces the server's nodes |
| runtime defect | router: on the server, a `<wcs-link>` without a router or with a `to` that is not a URL threw in a microtask, ending the process (found while fixing the rows) | fixed (#470): reported |
| runtime defect | router: `<wcs-link>` and `<wcs-head>` wrote `style` on the server, which a strict `style-src` reports once per element | fixed (#470); `<wcs-fetch>` still does when fetch is bootstrapped on the server (its children may hold body text a reader without JavaScript would see) |
| runtime defect | fetch: `url` A → `null` → A sent nothing the second time — after a failure too, so a page left and opened again never retried | fixed (#471) |
| runtime defect | state diagnostics: a row field only some rows have (a page's own `pending` rows) was reported as "silently dropped" while it worked | fixed (#471) |
| silent mistake | one `<wcs-fetch>` that loads by `url` and posts by `method` + `body` + `trigger` sent every later url change as a `POST` with no body | fixed (#471): `[wcs/fetch-auto-unsafe]` |
| lint gap | lint 4.2.0 asked for a boolean in `if:` | already fixed (#464) |
| document gap | the root README's SSR example failed as written (no `url`); `src` was listed as a way to load a server-rendered state; "the server waits for all async operations"; pinning the server does not pin the engine (`^` on `@wcstack/state`); a client older than the server's minor; a `<wcs-fetch>` fetching again at hydration what the snapshot holds; `$connectedCallback` not running on a hydrated client (a guarded `localStorage` read there lost the reader's history); dates in the runtime's time zone | fixed (#472) |
| design question | the render does not wait for a request a binding starts (`<wcs-fetch>` with its `url` from state): the router-spa skeleton's form serves "Loading…" | decided: waited for, within `timeoutMs` — when the limit runs out the page is rendered without it, with a warning; the readiness protocol's `pendingPromise` (#476) |
| design question | `@wcstack/server` depends on `@wcstack/state` with a caret | decided: the exact version — a runtime dependency gets it, peers keep `^` (#474) |
| design question | `<wcs-state src>` — the form the documents prefer under a strict CSP — cannot be server-rendered (Node's loader reads no `http:` URL) | decided: `renderToString({ resolveModule })` maps the URL to a local file, a fresh module per render (#477) |
| design question | text typed before hydration is overwritten from state (`value:` on a form control) | decided: the reader's value wins — given back after binding, with `input` / `change`, so a two-way binding writes it to the state (#475) |
| design question | the READMEs on `main` describe features npm `latest` does not have yet (`data-wcs-ignore` "since 4.3" read on 4.2.0, which ignored it) | decided: `4.3 (not released yet)` / `4.3（未リリース）` marks — CI refuses a bare unreleased version, a stable release strips its own (#474) |
| design question | a client older than the server's minor takes the server's rows away before its initialization fails | open: plan the bindings before stripping, in a later engine (a released client cannot be helped); documented (#472) |
| open | `$connectedCallback` ran before the router's params reached state on the author's page (reproduced there, not in a reduced page); no HTTP status from `renderToString()` (a marker in the template is in every output); the server writes `<title>` itself; no hook after hydration; preferences jump in after hydration; a cached snapshot the client trusts hides the reader's own comment; SRI digests per release | recorded |
| pass | user content delivered as state stays text through SSR, hydration and navigation, and a `</script>` in a comment does not break out of the snapshot | — |

The author decided the five design questions above as recommended on 2026-10-18 ([docs/v4-direction-2026-10.md](./v4-direction-2026-10.md) §5.1, ja), with a sixth from before: an I/O command refused because the element is not ready is warned about once per element, `[wcs/command-not-ready]` (#473).

The mistakes nothing told the author about, besides the fetch one above: user content concatenated into the template before `renderToString()` (the server renders a `{{ }}` in it — `data-wcs-ignore`, #467, marks such markup); stripping comments from the output (the client then reads a value as markup); a `<wcs-router>` without `enable-ssr`, and `renderToString()` without `url` (an empty outlet, or the home page under the article's URL, with status 200); a guard on a public route (never server-rendered); a `$watch` expected to run on the server. Each is a candidate for the [mistake catalogue](./mistake-catalogue.md).

### Landing ssr-news in examples/ (2026-10-18)

After 4.3.0 the app moved into `examples/ssr-news/` without the workarounds 4.3.0 made unnecessary — plain `<a>` in rows (`<wcs-link>` there now renders on the server), the article loaded in `$connectedCallback` after waiting for the router (the render now waits for the `<wcs-fetch>` a binding started), an inline state with a nonce (a `src` state renders with `resolveModule`) — and with an e2e spec (13 tests, asserting intent). Doing so found more:

| Kind | Finding | Outcome |
|---|---|---|
| runtime defect | state diagnostics: a row field no row had — the server's comments, without the `pending` only the page's own rows carry — was still reported as "silently dropped" after a reload (4.3 covered a first row lacking what another row had) | fixed: a missing row field is reported only with a near name (a likely typo) or a row getter of another list form |
| design question | the comment form is in a `<wcs-layout>` route, which the client renders again (layouts are not adopted): what was typed there before hydration is lost — 4.3 keeps it on page-level controls and adopted routes | open: adopting layout routes (the app's README, "Known limits") |
