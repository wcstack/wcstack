# wcstack examples

Cross-package demo apps: each one composes **two or more wcstack packages** (or
showcases a repo-level concern like SSR or framework interop). Focused
single-package demos live in that package's own `examples/` directory instead:

- `packages/fetch/examples/` — `pagination` (5-stack comparison), `users-crud`, `infinite-scroll`
- `packages/speech/examples/` — `speech-echo`, `speak-highlight`
- `packages/defined/examples/` — `defined-loader`
- `packages/midi/examples/` — `midi-fader`
- `packages/view-transition/examples/` — `list-transitions`
- `packages/state/examples/` — binding basics

Every demo is buildless and loads packages straight from the CDN
(`https://esm.run/@wcstack/<pkg>/auto` one-liners; signals demos import the
single `@wcstack/signals/dom` entry) — except the React/Vue variants of
`websocket-chat` and the `fw-inventory` seam app, which use Vite, and the
`prod-booking` seam app, which pins jsDelivr's files with `integrity` (and
self-hosts the ones it installs from npm) on purpose.

**Script order**: list the I/O-node packages *before* `@wcstack/state`. Module
scripts execute in document order, so this guarantees every custom element is
defined before state attaches its bindings — and the guarantee is worth more
than tidiness:

- A **property / spread binding** on a not-yet-defined element is deferred via
  `customElements.whenDefined` and re-applied with the *latest* value once the
  class arrives, so nothing is lost there.
- A **command-token emit is not replayed**. Its subscription is deferred the same
  way, so if state is wired first and a slow (or failed) CDN fetch leaves an I/O
  element undefined, a click that fires `$command.x.emit()` inside that window
  reaches zero subscribers and is silently dropped.

Loading state last closes that window: nothing is wired to the UI until every
element is defined. When you cannot control the order — a snippet pasted into a
larger page, or tags arriving through `@wcstack/autoloader` — gate the control
that emits with [`@wcstack/defined`](../packages/defined/): bind
`<wcs-defined>`'s `pending` to a `disabled:` and the button cannot be clicked
before the subscriptions exist. Prefer it over awaiting
`customElements.whenDefined()` inside the handler, which never rejects for a tag
that is never registered and so parks the handler forever on a failed import.
See [`state-tilt-maze/`](state-tilt-maze/).

## Demo list

| Demo | Combines | Run | URL |
|------|----------|-----|-----|
| [`websocket-chat/`](websocket-chat/) | websocket × 5 stacks (vanilla / state / signals / React / Vue) | see its [README](websocket-chat/README.md) | :3300–:3302, :3304–:3305 |
| [`router-spa/`](router-spa/) | router + fetch + state (SPA catalog: URL ⇄ state bridge) | `node examples/router-spa/server.js` | :3000 |
| [`router-i18n/`](router-i18n/) | router + state (i18n: locale in the basename, dictionary as an ES module) | `node examples/router-i18n/server.js` | :3000 |
| [`state-camera-record-upload/`](state-camera-record-upload/) | camera + permission + upload + state | any static server (secure context) | — |
| [`state-color-palette/`](state-color-palette/) | eyedropper + clipboard + storage + state | any static server (EyeDropper is Chromium-only) | — |
| [`state-cross-tab-todo/`](state-cross-tab-todo/) | storage + broadcast + state | `node examples/state-cross-tab-todo/server.js` (open 2 tabs) | :3000 |
| [`state-custom-states/`](state-custom-states/) | fetch + websocket + state (`:state()` showcase) | `node examples/state-custom-states/server.js` (needs the [websocket-chat shared install](websocket-chat/README.md#setup)) | :3303 |
| [`state-devtools-playground/`](state-devtools-playground/) | devtools + state + timer (overlay inspector demo) | any static server | — |
| [`state-intersect-fetch/`](state-intersect-fetch/) | intersection + fetch + state (two I/O nodes wired through state: event token in, command token out) | `node examples/state-intersect-fetch/server.js` | :3000 |
| [`state-intersect-scroll/`](state-intersect-scroll/) | intersection + state (`$stream` switchMap restart + bounded retry, `$watch` feed accumulation) | `node examples/state-intersect-scroll/server.js` | :3000 |
| [`state-notification-chat/`](state-notification-chat/) | notification + permission + state | any static server | — |
| [`state-permission-banner/`](state-permission-banner/) | geolocation + permission + state | any static server | — |
| [`state-pomodoro/`](state-pomodoro/) | timer + wakelock + notification + state | any static server (secure context) | — |
| [`state-search/`](state-search/) | fetch + debounce + state | `node examples/state-search/server.js` | :3000 |
| [`state-sse-dashboard/`](state-sse-dashboard/) | sse + state (`$stream`) + network — one feed, two idioms | `node examples/state-sse-dashboard/server.js` | :3000 |
| [`state-testing-todo/`](state-testing-todo/) | testing + state (a todo page and its headless vitest suite) | `cd examples/state-testing-todo && npm install && npm test` | — |
| [`state-tilt-maze/`](state-tilt-maze/) | tilt + accelerometer + raf + wakelock + defined + state (sensor game) | any static server (secure context) | — |
| [`signals-live-search/`](signals-live-search/) | signals + fetch | `node examples/signals-live-search/server.js` | :3000 |
| [`signals-tilt-maze/`](signals-tilt-maze/) | signals × the same 4 sensor nodes as `state-tilt-maze` (core swap comparison) | any static server (secure context) | — |
| [`ssr/`](ssr/) | @wcstack/server (SSR + hydration) | `cd examples/ssr && npm install && node server.js` | :3001 |
| [`synth-playground/`](synth-playground/) | 🎹 audio + midi + state (a modular synth written as markup) | any static server | — |

Demos marked "any static server" have no backend at all — any way of serving
the directory over `http://localhost` works, e.g.:

```bash
npx serve examples/state-permission-banner
```

## Seam apps

Larger apps written to find defects rather than to show a feature: a first-time author built each from the public documents only, and every friction was reproduced and classified ([docs/seam-apps.md](../docs/seam-apps.md)). Each crosses seams between packages and is tested for intent — where content renders, what survives a reload, the second time, a second tab, a failing network — by its e2e spec in `e2e/tests/`.

| App | Seams it crosses | Run | URL |
|------|------|-----|-----|
| [`router-auth/`](router-auth/) | router guards × state × `<wcs-storage>` × token-protected `<wcs-fetch>` (members area: log-in, guarded pages, session expiry, two tabs) | `node examples/router-auth/server.js` | :3000 |
| [`router-admin/`](router-admin/) | `<wcs-layout>` × query ⇄ state ⇄ fetch × forms with server validation × `leaveConfirm` × `<wcs-view-transition>` × two languages (admin console) | `node examples/router-admin/server.js` | :3000 |
| [`state-collab-board/`](state-collab-board/) | `<wcs-sse>` × optimistic `fetch` × `<wcs-network offline>` × reconnect and catch-up (shared board, two browsers) | `node examples/state-collab-board/server.js` | :3000 |
| [`signals-shop/`](signals-shop/) | `@wcstack/signals` × router × `<wcs-fetch>` / `<wcs-storage>` (the tutorial's shop on the other reactive core) | `node examples/signals-shop/server.js` | :3000 |
| [`ssr-news/`](ssr-news/) | `@wcstack/server` × router × state × `<wcs-fetch>` on the server and at hydration × `<wcs-link>` / `<wcs-head>` / `<wcs-layout>` under SSR × the client's version (a server-rendered news site, readable without JavaScript) | `cd examples/ssr-news && npm install && node server.js` | :3000 |
| [`state-field-report/`](state-field-report/) | `<wcs-permission>` × the acquiring elements × `<wcs-camera>` → `<wcs-recorder>` → `<wcs-upload>` × a route's nodes × `<wcs-network offline>` × `<wcs-storage>` × `Permissions-Policy` / an `<iframe>` (a field report from a phone: clips, the position, a dictated note, an outbox) | `node examples/state-field-report/server.js` | :3000 |
| [`fw-inventory/`](fw-inventory/) | the I/O nodes × `@wc-bindable/react` / `vue` × React 19's props × Vue's reactivity and structured clone × `key` and `<wcs-storage>` × two tabs, React in one and Vue in the other (a shop's inventory tool: a React back office and a Vue warehouse panel, no `@wcstack/state`; a Vite app) | `cd examples/fw-inventory && npm install && npm run build && node server.js` | :3000 |
| [`prod-booking/`](prod-booking/) | the delivery × every package: `integrity` × the split chunks, `installFeatures` × two copies of the engine, a strict CSP and Trusted Types × import maps, inline guards and components, `<wcs-router>` × a reload, `<wcs-autoloader>` × another library's tags, an open tab × the next version's files (a meeting-room booking app under `/booking/`, in six delivery profiles and two versions, deployed while a tab is open) | `cd examples/prod-booking && npm install && node server.js` | :3000–:3005 |
| [`shift-desk/`](shift-desk/) | time × every I/O node: `<wcs-timer>` × sleep and hidden tabs, `<wcs-sse>` / `<wcs-ws>` × connections that died without being closed (`stale-after`), a route's `<wcs-ws>` × parameter-only navigation, `<wcs-head>` × hundreds of navigations, `<wcs-ws>` × the back/forward cache, midnight × today's counters, an expiring token × an outbox (a support desk's operator console left open for a shift: the queue, the chat, SLA countdowns, presence, the wall screen, two tabs) | `cd examples/shift-desk && npm install && node server.js` | :3000 |
| [`family-ledger/`](family-ledger/) | the author × the skill: an app written from the AI authoring skill alone, across the first round's seams — the route guard × `<wcs-storage>`, query ⇄ state ⇄ fetch, 422 and 409 × a form, `<wcs-sse auto-reconnect>` × the open month, `<wcs-upload>` × a bearer token, `leaveConfirm`, `@wcstack/testing` × a state in its own file (a household budget for two, in Japanese and yen: months, budgets, receipts, live updates between two browsers) | `node examples/family-ledger/server.js` | :3000 |
| [`city-library/`](city-library/) | accessibility × language: the router × focus and announcements after a navigation, a skip link under `<base>`, `aria-current` on query links, `<wcs-view-transition>` × `$watch` × focus, a 422 × `aria-invalid` and the first wrong field, `<dialog>` × focus, `<wcs-sse>` × a live region, the date filters × time zones, a language per basename × `leaveConfirm`, `dir="rtl"` × bidirectional text (a city library's patron site in Japanese, English and Arabic, for keyboard and screen-reader users: the catalogue, holds, a hold ready announced live, opening hours in Tokyo time) | `node examples/city-library/server.js` | :5520 |
| [`homeroom/`](homeroom/) | versions × every package: an app written on 4.2.0 beside the same app upgraded — the workarounds × the later releases' fixes, `<wcs-upload-header>` × a bearer token, `<wcs-ws>` × a route left while connecting, `<wcs-link to="/notices?">` × a pager, the error reporter × `reportError()`, a tab left open × a deploy, stored values × both versions (a class's notice board in Japanese: notices with tabs and pages in the URL, questions answered live, the teacher's attachments, absence reports; `v4.2.0/` and `public/` on one server) | `cd examples/homeroom && npm install && node server.js` | :5566 |

## Shared server core

`shared/server.js` is the static-file + JSON API core the demos above delegate
to — each demo's `server.js` stays a thin file declaring only its own routes.
When copying a single demo out of this repo, copy `examples/shared/` alongside
it. (`websocket-chat/` is the exception: it ships its own self-contained server
under `websocket-chat/shared/` because it needs the `ws` dependency, so that
scenario is portable as one directory.)

Most demo servers default to port 3000 (override with `PORT=…`), so run them
one at a time — or use the e2e static server (`cd e2e && npm run serve`), which
serves the whole repo with mocked APIs at `http://127.0.0.1:4173`.
