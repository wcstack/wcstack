# lending-desk — a TypeScript team and wcstack's tools

みどり市 備品の貸出: the city's community centres lend equipment — tents, tables, projectors, a popcorn machine — to the town's associations. A **seam app** ([docs/seam-apps.md](../../docs/seam-apps.md)): a first-time author built it from the public documents on 4.25.0 as a TypeScript team would, for whom the type checker and wcstack's tools — `tsc`, `wcs-tsc`, `wcs-schema`, the lint, `@wcstack/testing` — are the way back from a mistake. Everything is TypeScript under `strict`, the API's types live once in `shared/` and both the Node server and the pages use them, and there is a production build with no TypeScript in it. A single-page app with `@wcstack/state` and `@wcstack/router`, and a second page:

- **サインイン** (`/login`): an association (`G01`…`G08`) or centre staff; the token is kept in `<wcs-storage>`, so a reload stays signed in, and a deep link while signed out comes back after signing in.
- **備品をさがす** (`/`): keyword, category, centre and a period with the number free in it, sort, 20 per page — all in the URL; a slow answer overtaken by a newer one never lands.
- **備品の詳細** (`/items/:id`): a month calendar of the number free each day, a period chosen by two clicks or two date fields, 数量 with the city's stepper, かごに入れる.
- **申込かご** (`/cart`): one row per line with the stepper, the totals, 利用目的 and 受け取り日時, 申し込む; the same cart in two tabs; the server's `422` at its line, still there after a line above it is deleted.
- **申込** (`/reservations`, `/reservations/:id`): the association's requests with their status, decisions arriving live over `<wcs-sse>`, a count of the ones not seen yet, cancelling (and the `409` when staff decided first).
- **管理** (`/admin`, staff only): pending requests oldest first, 承認 / 却下, a request that would exceed an item's stock marked.
- **受付カウンター** (`/counter.html?center=2`): a separate page for the TV at a centre's desk — today's pickups and returns, live. Its state is written in the page, as JavaScript with JSDoc types from `shared/`.
- `<midori-qty>` (`src/components/midori-qty.ts`): the city's stepper, a custom element of its own (wc-bindable, no wcstack inside), also in a page without wcstack (`/qty-test.html`).

```bash
cd examples/lending-desk
npm install
npm run dev      # the API on :3001 + Vite on http://127.0.0.1:5173 (edit → reload)
npm start        # builds dist/, then the API on :3001 + a plain static server for dist/ on http://127.0.0.1:3000
npm run check    # every check below
```

Node 22.18 or later: the server's TypeScript runs as it is. Sign in as `G01`…`G08` with あいことば `midori-g01`…`midori-g08`, or as staff `S01` / `midori-s01`. The data is in memory and the same on every start. `API_PORT`, `DEV_PORT` and `STATIC_PORT` change the ports.

Unlike most examples it does not load wcstack from the CDN: it is a TypeScript app with a bundler, and `src/main.ts` imports each package's `/auto` from npm (`^4.26.0`, which the types and `@wcstack/testing` need anyway). Nor does it use `examples/shared/server.js`: its server is TypeScript (`server/*.ts`) and shares `shared/api.ts` with the pages, which is what the app is about. `WCS_LOCAL=1 npm run build` builds it over this repository's `packages/*/dist` instead — the `/auto` entries, `@wcstack/state/define` and the Vite plugin from `packages/typescript/dist` — as CI does (build those packages first: the committed dists are rebuilt at a release only).

## How it is put together

```
shared/            the API's types (api.ts) and the date and stock arithmetic, used by the server AND the pages
server/            Node, TypeScript run directly: api.ts (the contract), data.ts (the seed), main.ts, static.ts
index.html         the SPA: <wcs-state src="src/state/app.ts">, the I/O elements, <wcs-router> with every route
src/state/app.ts   the SPA's state (defineState)
wcstack.manifest.json   derived from app.ts's type by `npm run schema` (wcs-schema emit) — commit it
src/lib/*.ts       pure logic (cart, calendar, search and the URL, response checks, 422 mapping) — unit-tested
src/components/midori-qty.ts   the city's stepper
counter.html       the counter screen, its state inline (JavaScript + JSDoc, checked by wcs-tsc)
qty-test.html      the stepper in a page without wcstack
vite.config.ts     the dev server and the build: wcstack() from @wcstack/typescript/vite
tests/unit         vitest: the libraries (Node), the stepper and the page's state (happy-dom, @wcstack/testing)
tests/e2e          Playwright: the dev server and the build, Chromium / Firefox / WebKit
```

The I/O is wcstack's elements: `<wcs-fetch>` for every request (a `<wcs-fetch-header>` carries the token), `<wcs-storage>` for the session, the cart (shared by the tabs) and the decisions seen, `<wcs-sse>` for the live updates, `<wcs-debounce>` for the keyword, `<wcs-timer>` for the clock that moves "today", and `<wcs-router>` / `<wcs-link>` with route guards.

## The checks (`npm run check`)

| Script | Runs | Guards |
|---|---|---|
| `check:types` | `tsc -p tsconfig.json`, `wcs-tsc -p tsconfig.json` | every `.ts` file (`strict`, `noUncheckedIndexedAccess`) — the state's paths, its `$on` handlers and `$command` names among them — and `counter.html`'s inline state, checked as the JavaScript the browser runs |
| `check:schema` | `wcs-schema check src/state/app.ts` | `wcstack.manifest.json` is up to date with the state's type: it fails when the type changed and `npm run schema` was not run |
| `check:lint` | `wcs-validate --strict index.html counter.html qty-test.html` | every `data-wcs` path against the state. The manifest records `stateSource: "src/state/app.ts"`, so its schema applies to `index.html` only; `counter.html` is checked against its own inline script. Warnings fail too |
| `test:unit` | `vitest run` | 44 tests: dates, free counts, the stock check, the cart's merging and totals, the calendar, the search URL, response checks, 422 mapping, the stepper, the page's state (its table as the page has it) |
| `test:e2e` | `playwright test` | 35 browser tests × the dev server in Chromium and the build in Chromium, Firefox and WebKit, on ports 8505–8507; each fails on an uncaught page error, the main flows on any console error or warning. `E2E_ALL=1` adds the dev server in Firefox and WebKit |

After changing the state's type: `npm run schema`, and commit `wcstack.manifest.json`.

## What it found

The findings and what became of each are in [docs/seam-apps.md](../../docs/seam-apps.md) ("lending-desk"). In short: a TypeScript return type hid a getter or method from the lint, so the author took `: void` off 39 methods; `wcs-tsc` checked an inline state as TypeScript, ignoring JSDoc and passing syntax the browser cannot run; one manifest's schema was applied to every page under it, and a stale one won over the script; nothing built a `.ts` state for production; `<wcs-debounce>` wrote `undefined` over the page's `null`; the documented fix for Firefox's console message stopped live updates in WebKit, and a signed-out tab kept the previous user's stream; `@wcstack/server` and `@wcstack/testing` could not render a table whose rows are a `for:`; a `$on` handler's state, `$command` and the test's state had no types. Three of the author's twenty mistakes passed every check and 140 browser tests. 4.26.0 fixes or decides them.

## What 4.26.0 took out

The app is as its author wrote it, without the workarounds 4.26.0 made unnecessary:

- **The author's own Vite plugin**, which emitted the state file as a chunk and rewrote `<wcs-state src>`, and `vite-ignore` on the inline scripts of `<wcs-state>` and `<wcs-guard-handler>`: `wcstack()` from `@wcstack/typescript/vite` does both.
- **Methods and `$watch` handlers without `: void`**, so the lint could see them: they are typed like the rest. The `$watch` on the stored `session` rather than the `auth` getter, which the lint called a key that never fires, watches `auth`.
- **`counter.html`'s state with no annotation at all**, every type taken from a value — `[SHAPE, null][1]` seeds, the shapes of `shared/api.ts` copied as literals, a `message:` binding and a `$watch` in place of an untyped `$on`, `this.$command.reload?.emit()` — and the literal JSDoc row types written for the lint: it is JavaScript with `/** @typedef {import("./shared/api.ts").CounterResponse} … */`, type guards for what the server sends, and a `$on` handler.
- **The schema kept at `src/state/app.manifest.json` and passed to the lint by hand**, so that `counter.html` would not be checked against it: one `wcstack.manifest.json` at the root, where the lint and the VS Code extension discover it, and `stateSource` keeps it to `index.html`.
- **`$on` entries forwarding to methods through a hand-written `interface OnTarget`**: the handlers are typed by `defineState` and do the work themselves. **`this.$command.x!`**: `$command` has the names in `$commandTokens`.
- **`src/close-streams.ts`** — closing `<wcs-sse>` in `beforeunload`, opening it again unless `pagehide` followed, and on a `pageshow` from the back/forward cache — and the `closeStream` command emitted on sign-out, on a `401` and when another tab signed out: `<wcs-sse>` handles the page leaving, and the `url` getter turning `null` closes the stream.
- **`string | null | undefined` and a `typeof` guard** on `<wcs-debounce>`'s slot: `string | null`.
- **The unit test's `<ul>`** where the page has a table, and **casts** to call the state's methods: the test mounts the page's table and reads `app.state<typeof appState>()`.

## What the app still does itself

- **It checks what the server sends** (`src/lib/check.ts`). `<wcs-fetch>` hands over JSON as `unknown`, and the types in `shared/` are the compiler's only: a field renamed on the server is a type error in the page's TypeScript, but `null` where the type says a number reaches the page as it is. The checks turn either into サーバーから想定外の応答がありました.
- **The route guards are JavaScript in the HTML.** A `<wcs-guard-handler>` has no `src=` form, so the two guards are small inline scripts that read `localStorage`; nothing type-checks them.
- **Dates are Japan dates as strings** (`shared/dates.ts`: `YYYY-MM-DD` through `Date.UTC`, "today" from UTC+9), not the `date` filters, which format a `Date` in the browser's time zone. The calendar is a getter (`src/lib/calendar.ts`).
- **The stepper declares its own wc-bindable type**, stricter than `@wc-bindable/core`'s `WcBindableDeclaration` and without that dependency: its names must be members of the class.
- **An optional field is read off the row** (`items.*.freeLabel`): a path to a key the row does not have warns `[wcs/read-path-missing]`.
- **The counter screen reloads with a command**, not `trigger`: a `trigger: true` written while the previous request runs is dropped, and two live events close together lost the second reload.
- In WebKit `connected` goes `false` → `true` at each router navigation (`<wcs-sse>` closes in `beforeunload`, which WebKit fires there, and opens again when the document stays). The page reloads the requests on a reconnect, so in WebKit it also does at each navigation.

## Tests

- `npm run check` here, as above: 44 unit tests with `@wcstack/testing`, and the author's 35 browser tests in four projects (140).
- `e2e/tests/lending-desk.spec.ts`: the author's browser tests against this repository's dist, the build only (CI builds the app with `WCS_LOCAL=1` over the dists it rebuilt from src). It starts the example's static server on port 8500 + 10 × the worker index and its API on the next port, runs the 35 in Chromium and 10 of them in Firefox. Locally:

```bash
cd examples/lending-desk && npm ci && WCS_LOCAL=1 npm run build && cd ../../e2e && npx playwright test tests/lending-desk.spec.ts
```
