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
| `state-field-report` — a field report from a phone: clips, the position and a dictated note, sent through an outbox, under the production form | `<wcs-permission>` × the acquirers (camera, geo, listen, notify), `<wcs-camera>` × `<wcs-recorder>` × `<wcs-upload>`, a route's nodes × the I/O nodes' disconnect, `<wcs-storage>` × a half-value draft, `Permissions-Policy` / an `<iframe>` × every device element | refuse then allow; the permission taken away while recording; the tab hidden while recording; leave the capture page and come back; reload mid-upload; offline mid-upload; 422 / 413 / 415 / 500; two tabs; the app in an `<iframe>` | in [`examples/`](../examples/README.md#seam-apps) with its e2e spec (2026-10-20); findings below |
| `fw-inventory` — a shop's inventory tool: a React 19 back office and a Vue 3 warehouse panel, no `@wcstack/state` | the I/O nodes × `@wc-bindable/react` / `vue`, React 19's props × an element's inputs, a framework's reactivity × structured clone, `key` × the elements, late definitions (the autoloader, a CDN, a dynamic import) × the adapters, Vite's dev server × SSE | a burst of events; the server restarting behind the dev proxy; a reload with stored filters; two tabs, React in one and Vue in the other; a deep link and quick navigation; uploads cancelled, retried and refused; a definition after the first render; StrictMode; HMR | in [`examples/`](../examples/README.md#seam-apps) with its e2e spec (2026-10-21); findings below |

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
| design question | a client older than the server's minor takes the server's rows away before its initialization fails | fixed in 4.4: the client plans the page on a copy before it strips, and fails with the server's HTML left as it was (#483); a client up to 4.3 cannot be helped (documented, #472) |
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

### An outside evaluation: 7GUIs (2026-10-18)

Not a seam app of this repository: an AI author built the seven 7GUIs tasks with @wcstack/state 4.2.0 in a repository of its own, then made 34 mistakes on purpose and recorded what told it of each — the method of step 5. Nothing told it of 10, and the lint alone of 8. The runtime and the lint were mostly good at structure (paths, filters, tokens, native commands); the silent ones were outside the dependency graph (`Date.now()` in a getter, `$postUpdate`) or a command emitted before its receiver was there. The design questions were the author's ([v4-direction-2026-10.md](./v4-direction-2026-10.md) §5.2, ja).

| Kind | Finding | Outcome |
|---|---|---|
| lint gap | an external state (`<wcs-state src>`) got none of the script rules — the same script gave 3 errors and 1 warning inline, none as `src="./state.js"`; the lint README said the opposite | fixed (#484): the page is checked again with the script inline; a finding in the file is reported in the file |
| lint gap | `wcs/updated-callback-unbound` reported `if: .editing` in `for: .cells` in `for: rows` as bound nowhere (found once Cells' `src` state was checked) | fixed (#484) |
| lint gap | a two-way binding on a getter without a setter; a command token no `command.` binding receives; `this.selectedID` for `selectedId`; `this.$command.<typo>`; `Date.now()` in a getter; `paths.includes("labell")` | fixed (#485): `wcs/path-readonly`, `wcs/command-token-unbound`, `wcs/write-path-missing`, and three rules widened |
| runtime defect | a `$postUpdate` path that does not resolve, and a write of an undeclared key beside a near one, did nothing without a word | fixed (#486): warned once by the diagnostics add-on |
| document gap | a `*` in `$postUpdate` is the current row, not every row | fixed (#486): the README says so; a form for every row is on the 5.0 agenda |
| design question | an emit while nothing subscribes is lost — an element defined late (Timer), an `if:` branch the same update renders (Cells) | decided: warned once per token (`[wcs/command-token-unbound]`) |
| design question | a delegated handler reading `event.currentTarget` (the root) fails with a TypeError that says nothing of it | decided: when such a handler throws, the diagnostics add-on says why once per handler (a 33 B core hook) |
| lint gap | the lint did not read a page's own custom element's `static wcBindable`, so a typo in its `eventToken.` / `command.` names was left to the runtime (which fails initialization with the code, and names no near member) | fixed: checked against a literal declaration in the page's scripts |
| open | commanding one row of a `for:` needs a custom element (a token reaches every row that binds it) | recorded |

### An outside evaluation: a tax return draft (2026-10-18)

Not a seam app of this repository: an AI author built a draft tool for a Japanese income tax return (business income only) with @wcstack/state 4.2.0, the router and `<wcs-storage>` — 34 single-value inputs, three tables and 96 getters — and wrote an evaluation of the state engine in its own repository. It found the domain a good fit (a tax return is a spreadsheet, and path getters are its formulas) and named three costs: the engine's implicit rules, the pace of releases, and declaring the state twice for the static checks. Its four proposals were a `stateSchema` from the state's definition, the paths in getters checked by the lint, a recipe for save and restore with the write-back rule written down, and a slower pace of majors or a long-term support line.

| Kind | Finding | Outcome |
|---|---|---|
| lint gap | the paths a getter reads were not checked: a typo in `this["dependents.*.incom"]` or `$getAll("incomes.*.amout", [])` was left to the tests | fixed (#489): `wcs/read-path-missing` |
| runtime defect | such a nested read gives `undefined`, and a wrong amount, without a word | fixed (#489): the diagnostics add-on warns once per path, naming the getter |
| lint defect | a top-level spread beside other keys made every key it brings in `wcs/binding-path-missing` (79 false warnings) — the author wrote the whole `stateSchema` by hand to silence them, and a test to keep it in step | fixed (#489): such a state is unreadable, as documented; without a `stateSchema` the lint says so once, at the spread (`wcs/path-dynamic-unknown`, info) |
| tool defect | `wcs-schema` ran out of stack on that state (in a literal with a spread, the TypeScript checker recurses once per getter that reads `this`); with enough stack it wrote a closed schema that would have made the 34 inputs errors | fixed (#490): the bin runs on a large stack; a spread whose type does not list its keys makes the schema open, with a warning. Typed from its table with a JSDoc mapped type, the state yields every key of the hand-written manifest |
| document gap | the rule the app's save and restore rest on — a value the element sends back while state writes it is not a write — was only in the storage README's recipe, and the author took it for an engine behavior `$behavior` could switch | fixed: the state README states it (synchronous, same value; no `$behavior` key changes it; a later event or a copy runs the setter) and the storage recipe links to it |
| document gap | 4.0 binds a `for:` / `if:` content before inserting it, so a custom element there receives its inputs before `connectedCallback`; the app's amount field lost an entry it had not accepted on moving from 3.x | fixed: the state README (Inputs) and the catalogue (docs only: an element's own write after connecting cannot be told from an edit) |
| document gap | a 3,600-line README with no word on how much of it an app needs; `{{ }}` and `<!--@@: -->` mixed in one page | fixed: a reading guide at the top of the state README, with the rule for the two text forms |
| document drift | the cross-tab-todo example described 3.x's echo handling; `docs/typescript.md` and the typescript ja README named the v1 manifest shape | fixed |
| design question | the pace of releases (26 releases and two majors in six weeks) and a long-term support line | open, the author's: [v4-direction-2026-10.md](./v4-direction-2026-10.md) §4 and §6 already set a minor per seam app, patches for data loss and regressions only, and no breaking change within 4.x; a support line for 3.x or 4.x is not decided |
| open | a row added through a helper (`concat(newRow())`) is not read for its shape | recorded: a `stateSchema` covers it |

### state-field-report (2026-10-19)

The second app under [docs/v4-direction-2026-10.md](./v4-direction-2026-10.md) (ja), for the seam its §3.2 lists next: device I/O × permissions. A field report from a phone: a permissions page; a camera preview and clips (`<wcs-camera>`, `<wcs-recorder>`, `<wcs-wakelock>`); the position (`<wcs-geo>`); a dictated note (`<wcs-listen>` / `<wcs-speak>`); a report created with `<wcs-fetch>` and its clips sent with `<wcs-upload>`; an outbox for when `<wcs-network>` says offline; a notification when all is sent (`<wcs-notify>`); the draft kept with `<wcs-storage>` across `<wcs-router>` routes; and the production form (SRI, a strict CSP, a `Permissions-Policy`, the app in an `<iframe>`). The first-time author used the public documents and the published 4.4.0. It went through every life event in headless Chromium with a fake camera and microphone; a hidden tab, the speech service and OS notifications were simulated. It logged 18 frictions. Of the 15 mistakes it made on purpose, nothing in wcstack told it of 12. One life event failed: leaving the capture page and coming back. Five passed only with a workaround.

Every claim was reproduced in Chromium against the repository's 4.4.0 dist before it was classified. Two were narrower than written. On an insecure origin, the watchers said `granted` only because the test harness grants every origin; a real browser says `denied` there, which is still a refusal to the page. And the echo loop that crashed the tab ran on a simulated recognizer.

| Kind | Finding | Outcome |
|---|---|---|
| runtime defect | camera: `<wcs-camera>` set `active` to `false` on disconnect without its event. The router puts a left route's nodes back with their bindings, so the page said "Camera live." with no camera, and Start (disabled while `active`) stayed disabled until a reload | fixed: a disconnect publishes `active: false` |
| runtime defect | the same in 12 more packages, found by auditing every I/O node. Some reset an output without its event (`speaking`, `listening`, a cleared `error`). Others left one at an in-progress value because the generation guard dropped the completion (`loading`, `connected`) | decided: a cross-cutting contract — a disconnect publishes every state output it changes and ends an operation it abandons ([timing-and-firing-contract.md](./timing-and-firing-contract.md) §22) |
| design question | a recording in progress when `<wcs-recorder>` left the document was thrown away without a word | decided: kept. It stops, and the clip arrives as `recorded`, as when the stream's tracks end |
| runtime defect | recorder: without `mime-type` the clip's `Blob` had no type and `mimeType` stayed `""`. Chromium settles the type at `onstart`, and the recorder read it before. So the README's own recipe (`new File([blob], …)` into `<wcs-upload>`) was refused, by the server (415) and by `accept="video/*"` | fixed |
| runtime defect | camera: the preview's shadow `<style>` is blocked by a `style-src` without `'unsafe-inline'` (the `<video>` rendered at its own size) | fixed: a constructed stylesheet |
| design question | a `Permissions-Policy` (a header, an `<iframe>` without `allow`) or an insecure origin turned a device off. The watchers said `granted` or `denied` and the acquirers `not-allowed`, the same as a user's refusal (Chromium's Permissions API answers so), and the app sent its user to the site settings | decided: `unsupported` from the watcher and from the acquirer's `permission`; `capability-missing` with the reason; the browser is not asked |
| silent mistake | upload: a `trigger` before `url` / `files` in one `data-wcs`, a retry after the files were used up, or files before the url sent nothing and set no error. fetch: a `trigger` without a url. notify: a `notify()` without the permission | fixed: `[wcs/command-not-ready]`, once per element |
| silent mistake | a recorded clip kept in a draft `<wcs-storage>` saves (stored as `{}`, then uploaded as a 15-byte "video"); speaking while listening (the echo loop); recording without `keep-alive` while the tab is hidden | fixed: `[wcs/storage-unserializable]`, `[wcs/speech-echo]`, `[wcs/camera-keep-alive-missing]` |
| lint gap | the rows of a getter mapping a module constant (`PERMS.map(…)`) were false `wcs/binding-path-missing`; `streamReady:` bound as a value was quiet | fixed: the rows are read from the callback's literal; `wcs/handle-bound-as-value` |
| document gap | binding `mimeType` two-way writes the state's seed into the request; `errorInfo` is the last attempt, not the current permission; an upload uses its `files` up (as fetch's `body`); a refused 413 leaves `progress` at 100; a per-window draft wants `type="session"`; `leaveConfirm` covers a reload and a route change together; the shape of `devices`; the network README's "five" outputs (six); the notification's `data` wrapper | fixed |
| open | commanding one row's `<wcs-upload>` (`abort`) needs DOM code (the 7GUIs finding); no element reports page visibility (new I/O packages are not on the 4.x list); no still photo from `<wcs-camera>`; the `objectURL` a disconnect revokes is not published (its event is `recorded`) | recorded |

The author decided the three design questions above as recommended on 2026-10-19 ([docs/v4-direction-2026-10.md](./v4-direction-2026-10.md) §5.3, ja). It is in `examples/` since 2026-10-20, with the workarounds 4.5.0 made unnecessary removed ([examples/state-field-report/README.md](../examples/state-field-report/README.md)); its spec runs in a Playwright project of its own (`chromium-media`: `channel: "chromium"` and `--use-fake-device-for-media-stream` — the default headless shell has no `getUserMedia`).

### Landing state-field-report in examples/ (2026-10-20)

After 4.5.0 the app moved into `examples/state-field-report/` without the workarounds 4.5.0 made unnecessary: the `$watch` that reset the camera's state after a route change (F9), its own `document.permissionsPolicy` / `isSecureContext` checks (F14), the forced `mime-type` (F2) and the `::part(video)` CSS (F13). It has an e2e spec (15 tests, asserting intent) on a Playwright project of its own, `chromium-media`: full Chromium with a fake camera and microphone, one worker for the file, since a fake camera encoding in many browsers at once came out as header-only clips. Doing so found one more:

| Kind | Finding | Outcome |
|---|---|---|
| design question | a page that cannot use a device learns it at connect (`permission: "unsupported"`), but why (the policy, the `<iframe>`'s `allow`, the secure context) only arrives in `error` / `errorInfo` after `start()` / `getCurrentPosition()` / `listen.start()` is refused. A page that disables its button on `unsupported` — the natural reaction — never shows the reason | open: publish the reason with `unsupported`, or say in the READMEs that it comes with an attempt (the app's README, "Known limits") |

### fw-inventory (2026-10-20)

The third app under [docs/v4-direction-2026-10.md](./v4-direction-2026-10.md) (ja), for the seam its §3.2 lists as `wcs-*` inside a framework. A shop's inventory tool. The React 19 back office has a product list with search, paging and sort (`<wcs-fetch>`), live stock (`<wcs-sse>`), filters kept in `<wcs-storage>`, react-router, photo uploads (`<wcs-upload>`, one per file) and a picked list shared over `<wcs-broadcast>`. The Vue 3 warehouse panel parses a CSV in `<wcs-worker>` and posts it with `<wcs-fetch>`. The I/O nodes are driven through `@wc-bindable/react` / `vue` 0.10.0: no `@wcstack/state`, no `data-wcs`. The first-time author used the public documents and the published 4.5.0, under Vite's dev server with StrictMode and in the production build, with the tags also loaded late, from a CDN and through the autoloader. It logged 14 frictions. Of the 19 mistakes it made on purpose, nothing on the client told it of 12, and the lint of none. Written as the documents and examples show, 5 life events failed; 6 passed only with a workaround, and one check still fails (a refresh through `trigger` from React state).

Every claim was reproduced in Chromium against the published 4.5.0 before it was classified. One needed a second try: `toRaw()` of a reactive array clones fine, and the post fails once its rows are proxies, as they are after `filter` or a spread.

| Kind | Finding | Outcome |
|---|---|---|
| design question | storage: React and Vue keep `key` for themselves, so the README's own React and Vue examples (`<wcs-storage key="app-settings">`) gave an element with no key — nothing loaded, nothing saved, `error` the only trace | decided: `storage-key` (`storageKey`) is `key` under another name; a load, save or remove without a key warns `[wcs/command-not-ready]` |
| design question | upload: React 19 applies props in the order written, before the element is in the document, so `<wcs-upload files={files} url="…">` sent nothing (it warned, in terms of `data-wcs`) | decided: files that came before the url are sent when it arrives |
| design question | the integration guide's late load, `import("@wcstack/sse/auto")`, was `TS7016` (no types for `/auto`); there are no JSX declarations for the tags | decided: `dist/auto.d.ts` for every `/auto` now; JSX declarations recorded, and the guide shows hand-written ones |
| silent mistake | worker / broadcast: a post structured clone cannot copy was lost with only `error` to show it — a Vue reactive list, after the guide's `toRaw()` too | fixed: `[wcs/post-uncloneable]`; the guide and the root README say a deep plain copy |
| silent mistake | an object input written as an attribute — a React 19 prop before the definition loaded (`files="[object File]"`), Vue's `:body.attr` — gave the element nothing | fixed: `[wcs/input-as-attribute]`, in the shared property upgrade every I/O node runs |
| runtime defect | fetch: no class for `<wcs-fetch-header>` / `<wcs-fetch-body>`, so an autoloader wrapper could not define them, and the request went out without its header | fixed: `WcsFetchHeader` / `WcsFetchBody` exported, `[wcs/fetch-helper-undefined]`; the autoloader README shows a wrapper that imports `/auto` |
| lint gap | `wcs-validate` said "0 error(s)" for `.vue` / `.tsx` files and for pages holding only `<div id="root">`, so the skill's completion gate passed without checking anything | fixed: `not read:` / `nothing to check:` after the counts; the lint README and the guide say a framework app is outside it |
| document gap | the guide's `toRaw()`; "JSX cannot bind a colon event" (it compiles, and `onWcs-…` never fires); an `event` output read through the adapter's values loses occurrences, as the `websocket-chat` React example did (2 of 5 in a burst); `trigger` from framework state runs once; the order of props; an object input changed in place; a remount by `key` reconnects; a removed prop does not close a stream; saving `<wcs-storage>` from React without an update loop; Vite's optimize-deps reload and its proxy keeping a dead SSE response open | fixed: [framework-adapter-integration.md](./framework-adapter-integration.md) §2–§10, the storage README, the example |
| adapter | `@wc-bindable/react` / `vue`: `values` keeps the last value, so a burst or a repeated value is one occurrence; no element beside the callback ref, and the READMEs say nothing of inputs or commands; the READMEs on npm link to files outside the package | proposed as [wc-bindable-protocol#42](https://github.com/wc-bindable-protocol/wc-bindable-protocol/issues/42) ([spec-proposal-adapter-occurrences.md](./spec-proposal-adapter-occurrences.md), ja) |
| open | a `<wcs-storage>` that only restores still says nothing without a key: an element connected without one is also what a `key:` binding looks like before state applies it; JSX declarations for the tags; a heartbeat that would let a page notice a dead SSE response | recorded |

The author decided the three design questions above as recommended on 2026-10-20 ([docs/v4-direction-2026-10.md](./v4-direction-2026-10.md) §5.4, ja).

The fixes were checked in the author's app (React 19.3, Vue 3.5) with the packages built from the fixed source: `files={files} url=…` uploads (201); a late `files` prop and `:body.attr` warn `[wcs/input-as-attribute]`; Vue's posts warn `[wcs/post-uncloneable]`; `storage-key` restores in React and Vue; the storage README's React recipe restores, saves and keeps across a reload, with 4 renders for two changes; a save without a key warns. The `websocket-chat` React example, rebuilt, logs 5 of 5 messages sent together (2 of 5 before). Checking found one more:

| Kind | Finding | Outcome |
|---|---|---|
| document gap | the Vue examples of the storage, fetch and websocket READMEs — and `@wc-bindable/vue`'s own — bind with `:ref="ref"`. In `<script setup>` the template unwraps the ref, so `:ref` gets `null`: the adapter never bound, and `values` stayed empty without a word (the author's own code used `ref="name"`) | fixed in the three READMEs (a static `ref="…"`) and the guide; in [wc-bindable-protocol#42](https://github.com/wc-bindable-protocol/wc-bindable-protocol/issues/42) (§3) |

### Landing fw-inventory in examples/ (2026-10-21)

After the fixes were merged, the app moved into `examples/fw-inventory/` without the author's lab pages and test knobs, and without the workarounds 4.6 makes unnecessary: `el.key = …` in the ref (it writes `storage-key`), and `url` before `files` (`<wcs-upload files={files} url={url}>` now). The messages of the stream, the channel and the worker are taken off the elements' events, as the guide says, also where the author's full-list payloads made `values` harmless. It is a Vite app: `e2e.yml` installs and builds it with `WCS_LOCAL=1`, which points its `@wcstack/*` imports at the dists CI rebuilt from src, and its spec (9 tests, asserting intent) starts the example's own `server.js` with `TICK=0` on port 5200 + the worker index. Doing so found one more:

| Kind | Finding | Outcome |
|---|---|---|
| silent mistake | the author's filters followed the other tab by applying the adapter's `value` back to React state. The page's own save came back a render late and undid the typing in between, so typing "bolt" quickly saved and applied "bol" and "bolt" in turn without end — a request each time, no error (the author's check of quick typing ran on the dev server and passed; the production build looped) | fixed in the app: another tab's save is taken off `wcs-storage:value-changed`, skipping the events the page's own save dispatches; the storage README says so; catalogued (docs only: the element cannot tell an echoed write from an edit) |
