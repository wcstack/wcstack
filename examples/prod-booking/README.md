# A booking app taken to production

An office books its meeting rooms on the intranet, under the sub-path `/booking/`: a list of rooms with their price per
hour and equipment, a room page with the day's slots and a booking form, "my bookings" with cancel, preferences kept
across reloads (the default day, the currency shown), and an admin page behind a guard. Two components of the app's
own, `<booking-calendar>` and `<price-tag>`, are loaded by `<wcs-autoloader>` from the import map's `@components/`.

The app itself is ordinary on purpose. What this example shows is **how it is delivered**: the same pages in six
delivery profiles — versions pinned with `integrity`, the split entries of `@wcstack/state`, a strict
Content-Security-Policy with Trusted Types, the published files self-hosted under `immutable` caching — and a new
version **deployed while the old one is open in a tab**.

Packages: `@wcstack/state` (with `scopes`, `temporal`, `formats`, `list-keys`), `router`, `fetch`, `storage`, `autoloader`.

## Run it

```bash
cd examples/prod-booking
npm install          # the published files of both versions: v1 = @wcstack/* 4.6.2, v2 = 4.7.0
node server.js       # six profiles on :3000 … :3005 (PORT=… moves the first one)
```

`WCS_LOCAL=1 node server.js` makes v2 this repository's `packages/*/dist` and serves every profile from the server
itself (no CDN) — what `e2e/tests/prod-booking.spec.ts` runs.

| Port | Profile | Delivery |
|---|---|---|
| 3000 | `pinned` | one script per package, `cdn.jsdelivr.net/npm/@wcstack/<pkg>@<version>/dist/auto.min.js`, with `integrity` |
| 3001 | `split-importmap` | `@wcstack/state/core` and the four add-ons through an import map; its `integrity` covers the core, each add-on and each chunk; production: no `diagnostics` |
| 3002 | `split-auto` | `dist/split/auto.js` with `features="scopes"` and each state's `$features`; the import map's `integrity` covers the add-ons and chunks it loads |
| 3003 | `csp` | `pinned` under `script-src 'nonce-…'` (a fresh nonce per response), `style-src 'self'`, `require-trusted-types-for 'script'` — no `'unsafe-inline'` |
| 3004 | `selfhost` | `split-auto` from `/booking/vendor/@wcstack/<pkg>@<version>/…` (`Cache-Control: immutable`), the components from `/booking/<v1\|v2>/components/…`: the old version stays on the server |
| 3005 | `selfhost-inplace` | the mistake: `/booking/vendor/<pkg>/…` under `immutable` and `/booking/components/…`, both replaced in place at a deploy |

Every digest is computed from the files the server serves — the npm tarballs, or `packages/*/dist` — never from a CDN
response (the npm tarball and jsDelivr's file are the same bytes; since 4.7 each release's `sri.json` also carries every
file of `dist/split`).

Each profile serves v2 first. Deploy the other version without a restart:

```bash
curl -X POST "localhost:3004/api/test/deploy?to=v1"    # then open the app, and deploy v2 while it is open
```

`v1/` is the app as it shipped on 4.6.2 — with the three things that release needed, each marked `4.6.2:` (an `if:`
around the date filters, the router taken out before `location.reload()`, `<wcs-autoloader>` added once `<wcs-state>`
is defined). `v2/` is the next version on 4.7: attendees on a booking, a default for them in the preferences, a
`/help` route, the intranet's header widget — and none of those workarounds. `diff -r v1 v2` shows both.

## Things to try

- Open `localhost:3004/booking/` on v1, deploy v2, and stay in the tab: the banner says a new version is there; the room
  page still loads v1's calendar and v1's add-on (`@4.6.2` in the URLs); booking works against the v2 server; Reload
  lands on v2.
- The same on `:3005`, the other way round: open v2, deploy v1 in place, open a room. The calendar's state asks for the
  `list-keys` add-on, which now comes from the other build: `[wcs/feature-foreign]` on the console and at
  `/booking/api/client-errors`, and no slots.
- On `:3003`, open the console: no CSP violation. `document.createElement("div").innerHTML = "x"` is refused — Trusted
  Types is in force, in Chromium, Firefox and Safari; the components build their shadow trees with DOM calls.
- Break a page and look at `localhost:3001/booking/api/client-errors`: the page's `window` `error` listener (`report.js`)
  receives what `@wcstack/state` reports since 4.7 — a `<wcs-state>` that failed to initialize, a binding that failed to
  apply — with the original error as `cause`.
- Two tabs on two versions write the preferences: both keep reading the other's (v2 adds keys and keeps v1's; v1's
  setters keep the keys they do not know).

## The seams it crosses, and the spec

`e2e/tests/prod-booking.spec.ts` checks intent, in Chromium; the tests named `@browsers` run in Firefox too (the
`firefox` project), where the CSP and SRI guides once said "Chromium only":

| Seam | What the spec checks |
|---|---|
| a deep link under `/booking/`, 201 / 409 / 422, cancel, Back / Forward | the room page by URL, the conflict and the field errors shown, the cancelled slot free again, no console error |
| `<wcs-autoloader>` × another library's tag | `<intranet-badge>` (never defined) before the components does not stop them — with the autoloader's script first, and under the split auto entry, which defines `<wcs-state>` late |
| `$features` × a route | the `list-keys` add-on is requested when the room route is entered, not before |
| import map `integrity` × the split chunks (`@browsers`) | every core, add-on and chunk URL has a digest; a chunk changed on the way is refused |
| a strict CSP × the inline guard, the import map, the components (`@browsers`) | no violation; the guard runs on the router's nonce; an HTML sink is refused (Trusted Types in force) |
| errors × a production error reporter | a 3.x filter name (the page fails to initialize) and a getter that throws (a binding fails) both reach the `error` listener, without `diagnostics` |
| a bundler × the guard's inline script | a `<wcs-guard-handler>` without its script closes `/admin` and sends the reader to `/login` |
| a deploy × an open tab | versioned URLs: the v1 tab keeps its own files, books against v2, and its Reload reaches v2; v2's plain `location.reload()` reloads the document under the 4.7 router · in place: the open tab's core refuses the other build's add-on, loudly |
| a stored value × two versions | two tabs, v1 and v2, read each other's preferences, before and after a reload |
| the network | a 500 on the rooms is shown, and a reload recovers |

## What building it found

A first-time author built it from the public documents and the published packages ([docs/seam-apps.md](../../docs/seam-apps.md),
"prod-booking"): 20 profiles in two versions, three browsers, 29 frictions, 40 deliberate mistakes — of 20 delivery
mistakes the lint reported 3. What 4.7 did about them, in short:

| Found | 4.7 |
|---|---|
| `location.reload()` (and `history.go(0)`, `navigation.reload()`) did nothing under `<wcs-router>`: an "update available — reload" button and a service worker's update could not reload | a reload the page asks for reloads the document |
| one tag outside the autoloader's namespaces — another library's, or a `wcs-*` tag defined later — stopped all autoloading, and was all an error reporter heard of an integrity failure | such a tag is left alone |
| an add-on of another copy of the engine (`esm.run`, two versions, a directory replaced in place) was accepted and never ran | `[wcs/feature-foreign]` |
| state's errors went to `console.error` only: a reporter on `window.onerror` heard nothing, not even a page that failed to initialize | `reportError()`, with the original error as `cause` |
| a guard without its script (a bundler took it) said "not guarded" — and showed nothing | the route is closed: the guard's path |
| the date filters threw on a date that arrives later | an absent value renders nothing |
| `<wcs-head>` re-inserted every `<head>` element on each route change (a `base-uri` report per navigation in WebKit) | an unchanged element stays |
| no published digests for `dist/split`; a chunk list from another build protects nothing, silently | `sri.json` carries every split file |
| a `<wcs-state src>` from `/` (csp.md's form) left the page unchecked by the lint | `wcs/state-src-unread` |
| "Chromium only": import map `integrity`, CSP hashes of external scripts, Trusted Types | the guides say Firefox and Safari too; csp.md §7 names a component's own `innerHTML`; sri.md §7 is on self-hosting |

Landing it here removed what 4.7 made unnecessary from the current version (`v2/`) — the reload workaround, the late
`<wcs-autoloader>`, the autoloader placed last, the `if:` around the date filters, the `connectedCallbackPromise` hook in
the reporter — and dropped the author's lab profiles: the hash-only CSP (the guard needs `blob:` there, as csp.md says),
the `wcstack/auto` bundle, the Vite build (`examples/fw-inventory` already builds with Vite in CI, and what Vite does to
the inline scripts is now tested directly: the guard without its script), the service worker and its naive variant.

## Known limits

- **The autoloader does not retry a component that failed to load.** A 502 for `calendar.js` during a deploy leaves
  the room page without its calendar in that tab until a reload, and says so only on the console.
- **An empty `<wcs-state>` waits silently.** A state whose source is missing (a bundler that took the inline script)
  waits for `setInitialState()` and reports nothing.
- **A stored shape shared across a deploy is the app's job.** `<wcs-storage>` hands each tab whatever the other version
  wrote. This app keeps the keys compatible (v2 adds, v1's setters keep unknown keys); an incompatible shape needs a
  version field and a migration, or another key.
- **A 4.6.2 core cannot refuse a 4.7 add-on.** In the in-place profile, a v1 tab that enters the room route after v2 is
  deployed takes v2's `list-keys` without a word; only cores from 4.7 on check. Version the URLs.
