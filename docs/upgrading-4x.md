# Upgrading within 4.x

**日本語版**: [upgrading-4x.ja.md](./upgrading-4x.ja.md)

This guide is for an app already on a 4.x release that moves to a later 4.x release. Within a major, what semver covers changes only compatibly ([Versioning and breaking changes](../README.md#versioning-and-breaking-changes)). What an upgrade within 4.x changes is what the lint and the console report, behaviours that were defects — a page may have relied on a few of them — and the workarounds the app wrote for those defects. Upgrading from 3.x: read the [3.x → 4.0 migration guide](./migration-v4.md) first.

It comes from the `homeroom` seam app: a class notice board built on 4.2.0 with ten workarounds, each marked in its code, and upgraded two weeks later to 4.10.1 from the CHANGELOG, the release notes, the READMEs and the AI authoring skill ([seam-apps.md](./seam-apps.md)). Changing the versions changed one check: a new lint warning failed `--strict`. Both things that changed were in the CHANGELOG's "Upgrading" sections. The larger part was not: seven of the ten workarounds had become unnecessary, announced under Added or Fixed across five releases, and two of them did harm on 4.10.1 — a skip-link handler cancelled the router's in-page move while every test still passed, and a trick in the test config broke the tests once one of them changed the URL.

## How to upgrade

1. **Change the versions, and nothing else.** Every `@wcstack/*` package moves to the same version: the `<script>` lines and the import map (`https://esm.run/@wcstack/state@4.10.1/auto`, `https://cdn.jsdelivr.net/npm/@wcstack/state@4.10.1/dist/auto.min.js`), an `import()` of a package in your own modules, and `package.json` — `@wcstack/lint`, `@wcstack/testing`, `@wcstack/server` and `@wcstack/typescript` too. Search the project for `@wcstack/` and for the old version string: a line left behind keeps running the old version without a word ([Mixed versions on one page](#mixed-versions-on-one-page)).
2. **Run your checks**: the lint, the unit tests, the browser tests, and the console of your main flows.
3. **Read what changes** in each release between the two versions — the list under each release below, which links to the CHANGELOG entry. Most items are new warnings, in the lint or the console; a few change what a working page does.
4. **Go through your workarounds** against each release's table below. A workaround for a defect a release fixed is dead code at best, and some fight the fix. Remove them one at a time, each with the check that covers it. A test written against the workaround may pass without it for another reason: the `homeroom` skip-link test checked that the URL stayed on the page, which it did with the old handler and without it.

### Keep the tools at the page's version

- `@wcstack/lint` checks a page against the rules and the filter table of its own release. An older lint reports newer syntax as an error — the 4.9 lint calls 4.10.0's time zone argument (`datetime(ja-JP,short,Asia/Tokyo)`) `wcs/filter-arity` — and does not see what a newer one checks. A newer lint finds what an older page already had: 4.10.0's `wcs/live-region-inserted` on a page nobody touched. Lint findings are not covered by semver; they follow what the runtime does (4.4.0).
- The VS Code extension is versioned on its own and carries the lint rules of the release it was built with ([its changelog](../packages/vscode-wcs/CHANGELOG.md)).
- `@wcstack/testing` and `@wcstack/server` move with the page. `mount(html, { resolveModule })` needs `@wcstack/testing` 4.9: an older `mount()` ignores the option, and the test fails with Node's module-loader error (`ERR_UNSUPPORTED_ESM_URL_SCHEME`), which names no version.

### Server rendering

- Deploy `@wcstack/server` and the client of the same minor together. The client compares `<wcs-ssr version>` by major.minor and discards a snapshot of another minor: the page is rendered again on the client.
- Since 4.3.0 `@wcstack/server` depends on `@wcstack/state` at exactly its own version, so the server you pin is the engine that renders.
- Since 4.4.0 a client that cannot plan a newer minor's page fails before it touches it, and the server's HTML stays readable. A client up to 4.3 takes the server's rows away first: serve the client of the server's minor.

### Pinned versions with `integrity`

- A digest covers one version's bytes: change each URL and its `integrity` together. Take the digests from the release — the table in its GitHub Release, or its `sri.json` ([sri.md](./sri.md) §2) — never from the CDN.
- Since 4.7.0 `sri.json` carries every file of `@wcstack/state`'s `dist/split` (`packages["@wcstack/state"].split`), and the release notes the import map `integrity` block. Replace the whole block on every upgrade: the chunk names belong to one build, and a list from another build leaves every chunk unchecked while the page works ([sri.md](./sri.md) §5.1).
- A stale digest blocks the script. The browser's console names the file; nothing from wcstack runs to say so, and a page whose router is blocked shows only its static markup.
- `esm.run` URLs cannot carry `integrity` ([sri.md](./sri.md) §3).

### Mixed versions on one page

All the packages of a release come out together, at one version. Up to 4.10.1, only the split entries' add-ons are checked against their core (below); otherwise nothing on the page says that versions are mixed:

- **One package left on an older version** runs, and what the newer page needs from it may be missing. A 4.8 `@wcstack/upload` does not define `<wcs-upload-header>` (4.9.0): the tag stays a plain element, and the upload goes out without its header.
- **The same package loaded twice in two versions**: the copy evaluated first defines the tags and the other does nothing. An old `<script>` placed before the new one runs the old version.
- **An unpinned line** (`https://esm.run/@wcstack/fetch/auto`) follows npm `latest`, and the URL it redirects to names no version. Copying one into a pinned page mixes versions.
- **The split entries** of `@wcstack/state` refuse an add-on of another copy of the engine since 4.7.0 (`[wcs/feature-foreign]`); a core up to 4.6 accepts it, and the add-on does nothing.
- **A tab left open** keeps what it loaded, and loads the rest — a route's add-on, an autoloaded component, a lazy `import()` — from whatever its URLs name after a deploy. Self-hosted files keep the version in their URL, and the old versions stay on the server ([sri.md](./sri.md) §7).

### Rolling back

- Roll back the same way: every package to the old version together, the lint and the test helpers too, server and client together.
- Code that uses what a newer release added does not work on the older one, and most of it fails without a word: `storage-key` (4.6.0) is not an attribute up to 4.5, so the element has no key and saves nothing; `<wcs-upload-header>` (4.9.0) is a plain element, so the upload has no header; `leaveConfirm` bound to a boolean (4.9.0) asks `confirm("true")` / `confirm("false")`; a time zone third on `date` / `time` / `datetime` (4.10.0) stops the state up to 4.9 (`[wcs/filter-arity]`); a skip link `<a href="#main">` (4.10.0) goes to the home route under `<base href>`. Take back the workarounds with the versions.
- What `<wcs-storage>` saved is read by either version: no 4.x release changed how it stores a value.

## Release by release

Each release lists what a working page sees change, then the workarounds it made unnecessary: the symptom up to the release before, the workaround, and what to do now. The workarounds come from the seam apps ([seam-apps.md](./seam-apps.md)) and the `homeroom` upgrade. The CHANGELOG entry of each release has every change.

### 4.0.1 – 4.0.4

2026-10-12 – 13 — [4.0.1](../CHANGELOG.md#401--2026-10-12), [4.0.2](../CHANGELOG.md#402--2026-10-12), [4.0.3](../CHANGELOG.md#403--2026-10-12), [4.0.4](../CHANGELOG.md#404--2026-10-13)

- `@wcstack/state` (4.0.1): `class:` and `attr:` without a name are refused at load with `[wcs/binding-syntax]`; they did nothing. Write `class.NAME:` / `attr.NAME:`, or `className:`.
- `@wcstack/lint`: `wcs/filter-unknown` is an error (4.0.1); `wcs/input-nested-write` and `wcs/storage-init-seed` are new warnings (4.0.2); `wcs/storage-seed-clobber` covers an accessor pair, `wcs/input-nested-write` covers `<wcs-fetch>`'s `body`, and `wcs/base-href-missing` and `wcs/script-order` see pinned URLs, so a pinned page may meet them for the first time (4.0.3); `wcs/router-outlet-misplaced` is a new warning (4.0.4).
- `@wcstack/router` (4.0.4): a `<wcs-outlet>` the router does not use is warned about, `[wcs/router-outlet-misplaced]`.

No workaround became unnecessary. One README example was wrong: the fetch README's POST bound the form object (`body: newUser`) and sent no body the second time; build a new body in the handler that starts the request (4.0.3).

### 4.1.0

2026-10-13 — [CHANGELOG](../CHANGELOG.md#410--2026-10-13)

- `@wcstack/router`: a guard's redirect replaces the history entry (Back returned to the guarded URL and was redirected again). A `<wcs-guard-handler>` guards the landing route without `guard=""`; the route's `guard` attribute is the redirect for a falsy result (default `/`). Designed redirects are not logged, and guards that keep redirecting each other stop after 10, with an error.
- `@wcstack/router`: `data`, `params`, `route-name` and `search` reach state before a route's content is placed, `path` after it.
- `@wcstack/state`: `$watch` fires for a value an element already had when its binding attached — the router's first params, an open `<wcs-sse>`'s `connected` — once, when the watches start. Whether it fired had depended on how fast the page loaded.
- `@wcstack/state` / `@wcstack/view-transition`: only a pass that changes structure (list rows, an `if` branch) runs in a view transition; one that only updates values is applied at once.
- `@wcstack/fetch`: a `<wcs-fetch-header>` without a `value` attribute is not sent (it was sent empty).
- `@wcstack/signals`: a function under any `on…` key of `h()` is a listener; a lowercase `onclick` ran at render.
- `@wcstack/lint`: `wcs/storage-seed-clobber` reports any literal seed, as an error, and `wcs/on-handler-this` is a new error — `--errors-only` can fail.

| Symptom (up to 4.0.4) | Workaround | Now |
|---|---|---|
| `$watch` did not fire for a value the router or an open `<wcs-sse>` already had at load | the same work in `$connectedCallback` (router-admin, state-collab-board) | Remove the copy: the watch fires once when the watches start. A copy that does what the watch does now runs a second time on load. Since 4.2.0 a root getter over such a value fires too. |
| With `<wcs-view-transition>`, each keystroke in a bound input started a page-wide transition, and the click after it was lost | the tag narrowed to the router (`for="router"`) on pages with forms (router-admin) | Remove the narrowing if it was only for this: value updates are applied at once. |
| No way to ask before leaving unsaved changes | a `navigate` listener of the page's own (router-admin) | `<wcs-router data-wcs="leaveConfirm: …">`, bound to a message while there are unsaved changes (a boolean since 4.9.0). A listener you keep no longer makes the router throw `InvalidStateError` when it cancels a navigation. |
| `<wcs-link>` was active on its exact path only | the section link's mark computed by the page (router-admin) | `<wcs-link match="prefix">`: active on the paths under it too, with `aria-current="true"` there. |
| `value:` on `<wcs-fetch-header>` sent an empty header | the attribute bound instead (`attr.value:`) | `value:` sets it; `null` removes the attribute, and a header without one is not sent. |
| No online / offline output | `online` / `offline` listeners on `window` (state-collab-board) | `<wcs-network data-wcs="offline: offline">`. |

### 4.1.1

2026-10-14 — [CHANGELOG](../CHANGELOG.md#411--2026-10-14)

- `@wcstack/lint` and `@wcstack/typescript` know `<wcs-network>`'s `offline`: 4.1.0's reported it as `wcs/tag-member-unknown`, an error.
- `@wcstack/router`: `navigateUrl` / `replaceUrl` to a page whose guard redirects no longer logs `navigate failed: AbortError`.
- `@wcstack/lint`: `wcs/on-handler-this` also reports an alias of `this` (`const state = this`).

No workaround became unnecessary.

### 4.2.0

2026-10-17 — [CHANGELOG](../CHANGELOG.md#420--2026-10-17)

- `@wcstack/router`: `leaveConfirm` also asks before a navigation that leaves the page and that the page may cancel — a link outside the `basename` (a language switch), to another site, a form submission — where the Navigation API is. Accepted, the browser does not ask again.
- `@wcstack/state`: `$watch` on a root getter fires for a first value an element brought, once when the watches start, with `prev` `undefined`.
- `@wcstack/signals`: an object or array `h()` gives a custom element that is not defined yet is held and assigned once it is defined; it was written as the attribute `[object Object]`.
- `@wcstack/lint`: in-place changes through an alias, `Object.assign` or a `$on` handler's state are errors, under the `wcs/nested-assign` / `wcs/array-*` codes. `wcs/submit-without-prevent`, `wcs/route-bare-mustache`, `wcs/layout-slot-missing` and `wcs/signals-dual-entry` are new warnings, which fail `--strict`. `wcs/getter-untracked-read` reports a getter that reads `location`.
- `@wcstack/router` console: `[wcs/layout-slot-missing]` for a layout template without a default `<slot>`, and `[wcs/router-outlet-misplaced]` for an outlet a layout template brings.

| Symptom (up to 4.1.1) | Workaround | Now |
|---|---|---|
| No filter gave "Oct 13, 2026" or an amount in a currency | `Intl.DateTimeFormat` / `Intl.NumberFormat` formatters in getters (router-admin) | `date(en-US,medium)` (a style second on `date` / `time` / `datetime`) and `currency(JPY)`. The getters still work; plurals stay in getters (`Intl.PluralRules`). |
| signals: an object prop for a custom element defined after `h()` arrived as `[object Object]` | the component's module imported before any `h()` creates it (signals-shop) | Either order works. |

### 4.3.0

2026-10-18 — [CHANGELOG](../CHANGELOG.md#430--2026-10-18)

- `@wcstack/fetch`: a url that went empty and comes back is fetched again (`url` A → `null` → A). A route left and entered again loads its data again.
- `@wcstack/router`: a `<wcs-guard-handler>` guards the `<wcs-route>` it is inside (it guarded the route parsed last), and a route's parent is the `<wcs-route>` it is inside: a route after a sibling route inside an element, or after another route inside a `<wcs-layout>`, gets the path it is written with. A guard outside any route, or without a `<script type="module">`, is reported with `console.error` (`[wcs/guard-handler-ignored]`); one outside but after a route at the same level still guards that route — move it inside.
- `@wcstack/lint`: eight rules are errors — `wcs/tag-member-unknown` (which now covers DOM properties such as `hidden:` on a `wcs-*` tag), `wcs/getter-cycle`, `wcs/index-arity`, `wcs/token-misconfigured`, `wcs/token-undeclared` (for `command.`), `wcs/recursion-unsupported`, `wcs/filter-arg-type` and `wcs/input-nested-write`. `--errors-only` can fail on a page it passed. `wcs/filter-input-type` reports a string given to `lt` / `le` / `gt` / `ge`; `wcs/script-order` is an info.
- The console warns about more: `[wcs/fetch-request-superseded]`, `[wcs/fetch-auto-unsafe]`, `[wcs/infinite-scroll-target]`, `[wcs/command-not-ready]` (`<wcs-ws>`, `<wcs-broadcast>`, `<wcs-worker>`, `<wcs-recorder>`), `[wcs/storage-type-invalid]` and the router's `[wcs/base-href-missing]`.
- SSR: `@wcstack/server` depends on `@wcstack/state` at exactly its own version, and the render waits for a request a binding started, within `timeoutMs` (`[wcs/ssr-pending-timeout]` when it runs out). What a reader typed before hydration is kept, and given back with an `input` and a `change`, so a two-way binding writes it to state.

| Symptom (up to 4.2.0) | Workaround | Now |
|---|---|---|
| A route left and entered again kept its old data, or stayed on "Loading…" after a failure: the same url after an empty one sent nothing | `manual` on the read `<wcs-fetch>`, and a `$watch` on its url that emits a `fetch` command (homeroom) | Remove `manual` from the reads and the watches. Keep the `fetch` command or `trigger` for sending the same url again — a retry, a reload after a save. Keep `manual` on an element that changes data: url observation would send it (`[wcs/fetch-auto-unsafe]`). |
| SSR: a `<wcs-link>` in a `for:` row or an `if:` branch was served empty, and threw `Invalid URL` after hydration | plain `<a data-wcs="attr.href: …">` in rows (ssr-news) | `<wcs-link>` in rows. Plain links keep working. |
| SSR: the render did not wait for a `<wcs-fetch>` whose `url` a binding writes, and served "Loading…" | the data loaded in `$connectedCallback` after waiting for the router (ssr-news) | Let the binding write the url; the render waits for the request. |
| SSR: a `<wcs-state src>` could not be server-rendered | an inline state with a nonce (ssr-news) | `renderToString(html, { resolveModule })`. |
| SSR: a strict `style-src` refused the `style` attribute `<wcs-link>` and `<wcs-head>` wrote on the server | `style-src-attr` in the policy (ssr-news) | Drop it if it was for those two: they write none on the server. `<wcs-fetch>` bootstrapped on the server still writes one. |

### 4.4.0

2026-10-18 — [CHANGELOG](../CHANGELOG.md#440--2026-10-18)

- `@wcstack/lint`: the script rules check a state loaded with `<wcs-state src>`, and `wcs/nested-assign`, `wcs/array-mutation`, `wcs/array-index-assign` and `wcs/on-handler-this` are errors there too. New errors: `wcs/path-readonly`, `wcs/token-undeclared` in the script, `wcs/tag-member-unknown` on a custom element the page defines, `wcs/read-path-missing` with a `stateSchema`. New warnings, which fail `--strict`: `wcs/command-token-unbound`, `wcs/write-path-missing`, `wcs/read-path-missing`, `wcs/getter-untracked-read` on the clock, `wcs/updated-callback-unbound` beside a near path.
- `@wcstack/lint`: a state with a top-level spread (`export default { ...defaults(), … }`) has its paths checked only against a `stateSchema`; without one, a `wcs/path-dynamic-unknown` info says so.
- `@wcstack/state` console (the diagnostics add-on, in `/auto` and `.`): `[wcs/read-path-missing]`, `[wcs/post-update-path-missing]`, `[wcs/write-path-missing]`, `[wcs/command-token-unbound]` (a token emitted on purpose while nothing subscribes warns too) and `[wcs/delegated-current-target]`.
- `@wcstack/typescript`: `wcs-schema` writes an open schema for a spread it cannot list; `wcs-schema check` reports the difference.
- SSR: deploy server and client 4.4 together.

| Symptom (up to 4.3.0) | Workaround | Now |
|---|---|---|
| A state with a top-level spread made every key it brings a false `wcs/binding-path-missing`; `wcs-schema` ran out of stack on it | a `stateSchema` written by hand (the tax return draft) | Without a schema those paths are not checked, and the lint says so once. To keep them checked, keep a schema — derived with `wcs-schema` from the state's JSDoc or TypeScript types instead of by hand. |

### 4.5.0

2026-10-20 — [CHANGELOG](../CHANGELOG.md#450--2026-10-20)

- I/O nodes: a disconnect dispatches the resets it makes — `loading: false`, `<wcs-camera>` `active`, `<wcs-recorder>` `recording` / `paused`, `<wcs-speak>` and `<wcs-listen>` state, `<wcs-ws>` `connected` / `loading` / `readyState`, `<wcs-broadcast>` and `<wcs-worker>` `error` ([timing-and-firing-contract.md](./timing-and-firing-contract.md) §22).
- `@wcstack/camera`: a recording interrupted by a disconnect arrives as a clip; without `mime-type`, `mimeType` and the clip carry the type recording started with.
- `"unsupported"` where `"granted"` or `"denied"` was: on an insecure origin and for a feature a Permissions-Policy turns off, from `<wcs-permission>` and the acquirers' `permission`; their `errorInfo` is `capability-missing`. `<wcs-geo>`'s `errorInfo` for a missing Geolocation API is `capability-missing` (it was `position-unavailable`).
- The console warns about more: `[wcs/command-not-ready]` for a refused `<wcs-upload>`, a `<wcs-fetch>` `trigger` without a url and a `notify()` without the permission; `[wcs/storage-unserializable]`, `[wcs/speech-echo]`, `[wcs/camera-keep-alive-missing]`.
- `@wcstack/lint`: `wcs/handle-bound-as-value` is a new warning, which fails `--strict`.
- SSR: deploy server and client 4.5 together.

| Symptom (up to 4.4.0) | Workaround | Now |
|---|---|---|
| A route left with `<wcs-camera>` / `<wcs-recorder>` in it left the page saying the camera was on | a `$watch` on `routeName` that wrote `active`, `recording` and the like back to `false` (state-field-report) | Remove it: the elements publish what a disconnect changes. |
| A Permissions-Policy or an insecure origin looked like the user's refusal | the page read `document.permissionsPolicy` and `isSecureContext` itself (state-field-report) | `permission` is `"unsupported"`; an attempt fails with `errorInfo` `capability-missing` and the reason in `error`. |
| A clip recorded without `mime-type` had no type | a forced `mime-type="video/webm"` and a fallback type for the uploaded `File` (state-field-report) | Leave `mime-type` out; the clip's `Blob` carries the type. |
| The camera preview lost its layout under a `style-src` without `'unsafe-inline'` | `wcs-camera::part(video)` rules that redid it (state-field-report) | Remove them if they only redo the layout: the styles are a constructed stylesheet. |
| A getter that maps a module constant (`PERMS.map(…)`) made its rows false `wcs/binding-path-missing` | a `stateSchema` generated only to silence them (state-field-report) | Not needed for that; keep a schema if you want the paths checked against types. |

### 4.6.0

2026-10-24 — [CHANGELOG](../CHANGELOG.md#460--2026-10-24)

- `@wcstack/upload`: an automatic `<wcs-upload>` given its `files` before its `url` uploads them when the url arrives. A page that set the files first on purpose, expecting nothing to be sent, now uploads.
- The console warns about more: `[wcs/post-uncloneable]`, `[wcs/input-as-attribute]` (every I/O node), `[wcs/fetch-helper-undefined]`, `[wcs/command-not-ready]` for a `<wcs-storage>` without a key.
- `@wcstack/lint`: `.js`, `.ts`, `.jsx`, `.tsx`, `.vue` and `.svelte` files are not read, and are named after the counts (`not read:`); a page with nothing to check is named too. The exit code is unchanged.
- `exports["./auto"]` is an object in every package (`{ types, import }`; `default` in `wcstack`); a script that read it as a string reads `.import`.
- SSR: deploy server and client 4.6 together.

| Symptom (up to 4.5.0) | Workaround | Now |
|---|---|---|
| React and Vue keep `key`, so `<wcs-storage key="…">` gave an element with no key | `el.key = …` in a ref (fw-inventory) | `storage-key="…"` in the markup. A rollback to 4.5 makes it an unknown attribute: nothing is saved. |
| React 19 applies props in the order written: `<wcs-upload files={files} url="…">` sent nothing | `url` written before `files` (fw-inventory) | Either order works. |
| `import("@wcstack/sse/auto")` failed type-checking (`TS7016`) | a declaration of your own, or a `// @ts-expect-error` | Remove it: every `./auto` has `dist/auto.d.ts`. A `@ts-expect-error` left there is itself an error (TS2578). |

### 4.6.1 and 4.6.2

2026-10-24 — [4.6.1](../CHANGELOG.md#461--2026-10-24), [4.6.2](../CHANGELOG.md#462--2026-10-24)

- `@wcstack/typescript` (4.6.1): the peer is `typescript >=5.0 <7`, so a project on TypeScript 7 cannot install it without `--force`; keep `typescript@6`.
- `wcs-tsc` and the VS Code extension (4.6.2) check a getter body that reads `this`: a page that passed may report errors inside its getters.

No workaround became unnecessary.

### 4.7.0

2026-10-25 — [CHANGELOG](../CHANGELOG.md#470--2026-10-25)

- `@wcstack/state`: the errors the engine reports go through `reportError()` instead of `console.error`: `window.onerror` and an `error` listener receive them, the console shows them as uncaught errors, and Playwright's `pageerror` sees them. Under happy-dom, Node and `@wcstack/server` nothing changes.
- `@wcstack/state`: an add-on of another copy of the engine fails the state (`[wcs/feature-foreign]`).
- `@wcstack/state` (`formats`): `date`, `time`, `datetime`, `ymd` and `hms` render nothing for `undefined` / `null`.
- `@wcstack/router`: a `<wcs-guard-handler>` without a `<script type="module">` closes its route — every navigation into it goes to the `guard` path (default `/`). A bundler that processes the HTML (Vite) takes such scripts out.
- `@wcstack/router`: a reload the page asks for (`location.reload()`, `history.go(0)`, `navigation.reload()`) reloads the document.
- `@wcstack/lint`: `wcs/state-src-unread` (info) for a `<wcs-state src>` it cannot read.

| Symptom (up to 4.6.2) | Workaround | Now |
|---|---|---|
| `location.reload()` did nothing under the router | the router taken out of the page before the reload (prod-booking) | Call `location.reload()`. |
| A custom element outside every `@components/` namespace — another library's tag, or a `<wcs-state>` / `<wcs-link>` not defined yet — stopped autoloading with `No matching namespace found`; on the first scan none of the page's components loaded | the autoloader's script placed last, or `<wcs-autoloader>` added once `<wcs-state>` was defined (prod-booking, homeroom) | Place the autoloader where you like. Up to 4.6 the error also meant that no component loaded at all. |
| A date filter failed on a date that arrives later (`null` first) | an `if:` around the date binding (prod-booking) | Remove it: an absent value renders nothing. A value of another type is still refused. |
| The engine's errors went to `console.error` only: an error reporter on `window.onerror` heard none, not even a page that failed to initialize | a `console.error` wrapper, an `$errorCallback` that calls `reportError()`, a hook on `connectedCallbackPromise` (homeroom, prod-booking) | Remove them: every error the engine reports reaches `reportError()`. **An `$errorCallback` takes binding failures away from it**: with one, a failed binding goes to the callback only. One that writes the message into state — the shape the 4.2 skill taught — leaves the error reporter blind to binding failures. Keep it only if it calls `reportError(error)` too. A `console.error` wrapper no longer sees the engine's errors. |
| The split entries had no published digests | an import map `integrity` list computed by hand from the npm tarball | Copy the block from the release notes, or take it from `sri.json`. |

### 4.8.0

2026-10-26 — [CHANGELOG](../CHANGELOG.md#480--2026-10-26)

- I/O nodes: the work an element starts when it is connected begins one microtask later, with its inputs as they are then ([timing-and-firing-contract.md](./timing-and-firing-contract.md) §23), in 17 packages. Code that appends an element and reads its state in the same task (`readyState`, `running`, a timer's `immediate` tick) awaits a microtask.
- `@wcstack/websocket`: an open `<wcs-ws>` closes on a `pagehide` that may put the page in the back/forward cache, and reconnects when it comes back. What arrived meanwhile is not replayed: resync on `connected`.
- I/O nodes: `[wcs/command-not-ready]` is said once per outage, not once per element; a test that counts `console.warn` may see more. `<wcs-idle>`'s `start()` without the permission says it too.

| Symptom (up to 4.7.0) | Workaround | Now |
|---|---|---|
| A connection that died without being closed (sleep, NAT, a proxy) kept `connected: true` | a watchdog of the page's own: the time of the last message, pings, a close and a reopen after a silence (shift-desk) | `stale-after="<ms>"` on `<wcs-sse>` / `<wcs-ws>`. The server still has to send something more often than that. |
| An open `<wcs-ws>` kept the page out of the back/forward cache | the socket closed in `pagehide` and opened again in `pageshow` (shift-desk) | Remove it: the element does both. |
| A bound child of `<wcs-head>` (a bound `<title>`) left nodes behind on every navigation | a static `<title>`, and `document.title` set from a `$watch` (shift-desk) | Bind the `<title>` in `<wcs-head>` again. |

Two README examples were wrong: the notification and speech READMEs used a `debounce` filter, which does not exist and fails the state (`[wcs/filter-unknown]`) — use `<wcs-debounce>`; the idle README's quick start bound the output `active` with a seed and showed "Away" on every load — bind `userState`.

### 4.9.0

2026-10-28 — [CHANGELOG](../CHANGELOG.md#490--2026-10-28)

- `@wcstack/lint`: `wcs/getter-untracked-read` is an error where a binding on the page writes the path the getter reads (`this.monthFetch.value` under `...: monthFetch`) — `--errors-only` can fail. Read the path itself (`this["monthFetch.value"]`).
- `@wcstack/testing`: `mount()` rejects a `<wcs-state>` with nothing to load; it waited for ever.
- `@wcstack/router`: `leaveConfirm` with a boolean — `true` asks with an English default message, `false` asks nothing (it asked "true" and "false").
- `@wcstack/state` console: `[wcs/on-handler-this]` and `[wcs/second-root]`.

| Symptom (up to 4.8.0) | Workaround | Now |
|---|---|---|
| `<wcs-upload>` could send no request header, so an API that wants a token was out of its reach | `UploadCore` imported from the CDN and driven from state (family-ledger, homeroom) | `<wcs-upload-header name="Authorization" data-wcs="value: authHeader">` inside `<wcs-upload>`, with the upload package at the page's version: an older one leaves the tag a plain element, and the upload goes out without the header. |
| An SSE stream the browser gave up on (an HTTP error, `CLOSED`) stayed closed | a timer that waited and reopened it on `errorInfo.recoverable === false` (state-collab-board, shift-desk, family-ledger) | `auto-reconnect` (`reconnect-interval`, `max-reconnects`). Keep the catch-up on `connected`. It refreshes no token in the url. |
| A second `DELETE` answered `204` fired nothing on `status` (the same value) | the end of a request told by `loading` going `true` → `false` (family-ledger) | The response event, `eventToken.value` + `$on` (`detail` `{ value, status, objectURL }`, for every response), as the fetch README says since 4.9. The `loading` edge still works. |
| `mount()` could not load a `<wcs-state src>` (`ERR_UNSUPPORTED_ESM_URL_SCHEME`), and the module's object was shared between mounts | a copy of the state in an inline script (family-ledger), a `file:` document URL in the test config, a fresh `src="./state.js?v=n"` per mount (homeroom) | `mount(html, { resolveModule })`: it maps the URL to the file and imports the module anew for each mount. **A `file:` document URL does harm** once a test changes the document URL (`history.replaceState`): the next tests resolve `src` against that URL and fail to load the state. |
| Rows assigned with `map` in a method, and keys of an object literal assigned to a key seeded `{}`, were false `wcs/binding-path-missing` | a JSDoc `@type` (family-ledger), every key written out in the seed (homeroom) | Not needed for those. A spread inside the literal (`{ ...EMPTY }`) is still not followed: keep the JSDoc or the written-out seed there. |

### 4.10.0

2026-10-30 — [CHANGELOG](../CHANGELOG.md#4100--2026-10-30)

- `@wcstack/state`: with `<wcs-view-transition>`, `$watch` and the `$stream` restart run after the bindings the transition applies (bindings → `$renderedCallback` → `$watch` → `$stream` restart, as without the tag), and what they write is applied in the same transition. Up to 4.9 `$watch` ran first under the tag.
- `@wcstack/router`: a `<wcs-link>` whose `to` has a query is `active` / `aria-current="page"` only on that query. A `to` without a query is unchanged.
- `@wcstack/router`: a link to a bare fragment (`href="#main"`, `href="#"`) stays on the current page and focuses its target; under `<base href>` it navigated to its route. A page that relied on `href="#"` to go home links to it (`<wcs-link to="/">`).
- `@wcstack/state`: a lone argument with a `/`, or `UTC`, is a time zone in `date` / `time` / `datetime`, which take 0–3 arguments; the lint's `wcs/filter-arity` follows.
- `@wcstack/lint`: `wcs/live-region-inserted` is a new warning, which fails `--strict`: a status region inserted together with its text, which a screen reader does not announce.

| Symptom (up to 4.9.0) | Workaround | Now |
|---|---|---|
| With `<wcs-view-transition>`, a login that navigated from a `$watch` came back to the login form, and a `$watch` moved the focus before the field was marked invalid | the navigation and the focus moved to `$renderedCallback` (city-library) | Back in `$watch`. |
| A skip link `<a href="#main">` under `<base href>` took the reader to the home route | an `onclick#prevent:` handler that focuses `#main` (homeroom), or an `href` built from the router's path (city-library) | A plain `<a href="#main">`. **Keeping the `#prevent` handler does harm**: it cancels the router's in-page move, so the URL gets no `#main` and no history entry is made, while the focus still moves and a test of the focus passes. |
| A `<wcs-link match="…">` inside an `if:` / `for:` template reported an uncaught `wcs-link is not connected to a router.` as state built the template's content | the header kept out of the template, shown with `hidden:` (homeroom) | Put it back in the `if:` template. |
| A `<wcs-link>` with a query (a pager, a tab) was the current page everywhere | plain `<a>` with `attr.aria-current:` and `class.…:` bindings (homeroom, city-library) | `<wcs-link>` for links with a query; since 4.10.1 one is current only on an equal query, and `match="prefix"` marks one with more parameters `"true"`. A `to` without a query still compares the path only, so an "All" tab or a page-1 link without parameters stays a plain `<a>` if it must not be current on the other queries. |
| `date` / `time` / `datetime` formatted in the reader's time zone | `Intl.DateTimeFormat(…, { timeZone })` formatters in getters (city-library) | The zone third: `time(ja-JP,short,Asia/Tokyo)`. Not with the 4.9 lint or state: the lint calls it `wcs/filter-arity`, and the state stops. |
| The diagnostics add-on warned `[wcs/binding-path-missing]` for a key under the router's `searchParams` (`if: query.next`) and for keys under an empty `{}` seed filled later | a getter that read `this["query.next"]` (city-library); a seed with every key written out (family-ledger) | `if: query.next`, and a `{}` seed. |
| The lint could not read a root-absolute `<wcs-state src>` under a non-root `<base>` | the page placed so that a relative `src` reached the state (`public/site/index.html` with `src="../app.js"`, city-library) | `src="/app.js"`, and `wcs-validate --root=public`. |

### 4.10.1

2026-10-31 — [CHANGELOG](../CHANGELOG.md#4101--2026-10-31)

- `@wcstack/router`: a `<wcs-link>` whose `to` has a query is `aria-current="page"` only when the URL's query equals `to`'s; add `match="prefix"` to keep the mark, as `aria-current="true"`, where the URL has more parameters.
- `@wcstack/view-transition`: no transition is started before the page has drawn its first frame. A test that counts `document.startViewTransition` calls right after load waits for a frame first.
- `@wcstack/router` (documented): with `<wcs-view-transition>`, `path` comes a frame after `data`, `params`, `routeName` and `searchParams`. Code that runs in that frame for another reason (a response, a timer) reads `routeName` / `params` / `searchParams` or `location`, not `path`.

No workaround became unnecessary.

### 4.11.0

2026-11-01 — [CHANGELOG](../CHANGELOG.md#4110--2026-11-01)

- `@wcstack/state`: the diagnostics add-on warns `[wcs/element-undefined]` about a bound custom element still not defined 5 s after the page was ready, once per tag, and `[wcs/binding-type-expectation]` about a `for:` over a value that is neither an array nor null.
- Every package: a second copy of a package at another version warns once, `[wcs/package-twice]`; the copy evaluated first still runs. Load each package once, every wcstack line at one version.
- `@wcstack/lint`: `wcs/tag-package-missing` (a `wcs-*` tag whose package the page never loads) and `wcs/lint-version-behind` (the page pins a newer minor than the lint) are new warnings, which fail `--strict`.
- `@wcstack/router`: a `to` that ends with `?` — `to="/notices?"`, and the query-only `to="?"` — is the current page only where the URL has no query. Up to 4.10 it compared the pathname only.
- `@wcstack/testing`: `mount()`, `fire()` and `installDom()` throw on an option they do not have. `fire(el, "keydown", { key: "Enter" })` never set the key; dispatch a `KeyboardEvent` yourself.
- `@wcstack/websocket`: a `<wcs-ws>` removed while it connects closes the socket once it opens, and the browser logs nothing.
- `@wcstack/server`: `happy-dom` ^21.0.4, without its high advisories.

| Symptom (up to 4.10.1) | Workaround | Now |
|---|---|---|
| The lint did not follow a spread inside an object literal and reported `wcs/binding-path-missing` for every key under it (`draft: { ...EMPTY_DRAFT }`) | literal seeds with every key written out (homeroom) | `{ ...EMPTY_DRAFT }`. |
| A `<wcs-ws>` removed while it connected made Chromium log "WebSocket is closed before the connection is established." | the `<wcs-ws>` at page level, closed from state once open (homeroom) | Back in the route. |
| An "All" tab or a page-1 link without parameters (`to="/notices"`) was the current page on every query | plain `<a>` with its own `aria-current` (homeroom's pager) | `to="/notices?"`, the current page only where the URL has no query. Over a paged list, an "All" tab needs 4.12's `query-keys`. |

### 4.11.2

2026-11-01 — [CHANGELOG](../CHANGELOG.md#4112--2026-11-01). 4.11.1 reached npm for two packages only and was skipped.

- `@wcstack/router`: a route swap is compared with the routes on screen when it is applied. Under `<wcs-view-transition>`, a Forward within a frame of a Back left the Back's page on screen under the Forward's URL.
- `@wcstack/router`: a navigation overtaken while its guard runs — a link clicked while a loader fetches — places nothing and redirects nowhere. Up to 4.11.0 both routes were shown under the second one's URL, and a guard that refused redirected after the reader had gone elsewhere.

| Symptom (up to 4.11.0) | Workaround | Now |
|---|---|---|
| Under `<wcs-view-transition>`, Back then Forward at once left the Back's page on screen | a test that waits for the page Back went to before it presses Forward (homeroom's spec) | Forward at once. |

### 4.12.0

2026-11-01 — [CHANGELOG](../CHANGELOG.md#4120--2026-11-01)

- `@wcstack/router`: `<wcs-link query-keys>` names the query keys a link compares. With it, the link is also current, `aria-current="true"`, where the URL's query has the same values for those keys. A link without it is unchanged.

| Symptom (up to 4.11.2) | Workaround | Now |
|---|---|---|
| Over a paged list, an "All" tab `to="/notices?"` was current on page 1 only, and with `match="prefix"` on every category | plain `<a>` tabs with `attr.aria-current:` from state (homeroom) | `<wcs-link to="/notices?" query-keys="cat">` and `<wcs-link to="/notices?cat=event" query-keys="cat">`: each is current on every page of its category, one at a time. |

## Still needed on 4.12.0

- A `<wcs-link>` whose `to` has no query, and that has no `query-keys`, compares the path only (router README, "Active state").
- A property binding — `textContent:` included — on a custom element that is not defined yet waits for its definition ([timing-and-firing-contract.md](./timing-and-firing-contract.md) §4.1). Text meant to show before the component loads goes in a child element. Since 4.11 the diagnostics warn when the definition never comes (`[wcs/element-undefined]`), and the lint names a `wcs-*` tag whose package the page does not load (`wcs/tag-package-missing`).
