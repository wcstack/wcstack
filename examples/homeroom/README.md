# A class's notice board, in the version it was written on and the one it was upgraded to

3年B組 連絡帳 — the notice board of a primary-school class. The teacher posts notices (with a deadline and attachments),
the parents read them, ask questions under a notice and get the answer live, and report their child's absence; each
computer keeps its own settings (the text size, whether a notice lists its attachments). The UI is in Japanese.

The app is ordinary on purpose. What this example keeps is **its age**: it was written on wcstack 4.2.0 and upgraded two
weeks later, by the same author, from the CHANGELOG, the release notes, the READMEs and the skill
([docs/seam-apps.md](../../docs/seam-apps.md#homeroom-2026-10-31)). Both versions are here, side by side, served by one
server at one origin, so that a deploy and a rollback can happen under an open tab and both versions read the same
stored values:

- `v4.2.0/` — the app as it was written on 4.2.0: every URL pinned `@4.2.0`, and its ten workarounds, each marked
  `workaround:`.
- `public/` — the app as it is now: the unpinned one-liners, and none of the workarounds the releases since made
  unnecessary but one (below).

Packages: `@wcstack/state`, `router`, `fetch`, `upload`, `storage`, `websocket`, `network`, `view-transition`,
`autoloader`; `@wcstack/testing` for the unit tests.

## Run it

```bash
cd examples/homeroom
npm install                     # `ws`, and the published 4.2.0 packages under npm aliases (for WCS_LOCAL=1)
node server.js                  # http://localhost:5566/ — the current app (PORT=… to change)
PUBLIC_DIR=v4.2.0 node server.js   # the 4.2.0 app
WCS_LOCAL=1 node server.js      # no CDN: the current app on this repository's packages/*/dist,
                                # the 4.2.0 app on node_modules/<pkg>-4.2.0
```

Without `WCS_LOCAL` the pages load what they name: `public/` the npm `latest` release through
`https://esm.run/@wcstack/<pkg>/auto`, `v4.2.0/` `https://esm.run/@wcstack/<pkg>@4.2.0/auto`. An app of your own pins
every URL to one version, as `v4.2.0/` does, and changes them all together; `public/` is unpinned so that it follows the
repository.

Accounts: the teacher `sato` / `sensei1`; the parents `tanaka` / `oya1` (田中 一郎's) and `suzuki` / `oya2` (鈴木 二郎's).
The data is in memory, seeded with 25 notices; `TOKEN_TTL=<seconds>` (default 1800) sets how long a login lasts.

| URL | |
|---|---|
| `/login?next=…` | Log in; a deep link while logged out comes here and goes back after |
| `/notices?cat=homework&page=2` | The notices: a category tab and a page, both in the URL; unread marks, deadlines, attachment counts |
| `/notices/25` | A notice, its attachments, and its questions and answers, live over a WebSocket |
| `/notices/new`, `/notices/25/edit` | The teacher's form: title, category, body, a deadline, attachments (PDF / PNG / JPEG, 5 MB); the server's 422 next to each field; asks before leaving with unsaved changes |
| `/absences`, `/absences/new` | The absence reports (a parent's own; the teacher sees all) and the form, with its 422 |
| `/settings` | The text size and the attachments list — this computer only |

The API, the socket and the test hooks are listed at the top of `server.js`. **The test hooks are open to anyone** — they
reset the data, expire every token, drop and hold sockets, inject failures, switch the copy served — which is what an
example needs and what a real server must not ship.

## Layout

| Path | |
|---|---|
| `server.js` | The API, the WebSocket at `/ws/notices/:id`, the static files with the SPA fallback, one of the two copies at `/` (`PUBLIC_DIR`, or `POST /api/_test/public-dir { "dir": "v4.2.0" }` while it runs), the test hooks, and a log of what it saw (`GET /api/_test/log`: every attachment upload with how its token came, every socket opened and closed). Node's built-ins and `ws`; it serves its own files, since it switches the directory it serves |
| `public/index.html` | The page: the scripts, the routes and their guards, every view's markup and its `data-wcs` bindings |
| `public/state.js` | The root state (`<wcs-state src="./state.js">`): the session, each view's data, the forms, the live questions |
| `public/lib/format.js` | Pure helpers: dates in Japan time, labels, the list URLs, the questions merge |
| `public/components/` | `<hr-avatar>` and `<hr-cat-badge>`, the app's own, loaded by `<wcs-autoloader>` (`"@components/hr/"` in the import map) |
| `public/error-reporter.js` | The error banner and `POST /api/client-errors`, on the page's `error` listener |
| `v4.2.0/` | The same files as they were on 4.2.0 |
| `tests/unit/` | Vitest + happy-dom + `@wcstack/testing`: the real `public/state.js` mounted with `mount(html, { resolveModule })`, and the helpers |

`diff -r v4.2.0 public` shows what the upgrade changed, the landing here included.

## What the upgrade removed

The 4.2.0 app worked around ten things. Seven became unnecessary by 4.10.1 and the author removed them; two more went
when the app moved here after 4.11.0; one stays.

| Workaround on 4.2.0 | Made unnecessary by | Now | The spec's test that fails without it |
|---|---|---|---|
| `UploadCore` imported from the CDN and driven from state, to send the token with an attachment | 4.9 `<wcs-upload-header>` | `<wcs-upload>` + `<wcs-upload-header name="Authorization" data-wcs="value: authHeader">`, one file per upload | the attachment upload (the server logs `auth: "header"`) |
| the autoloader's script placed after state's | 4.7: a tag outside the `@components/` namespaces no longer stops autoloading | first, like the other scripts | every test: on 4.2.0 the autoloader throws on `<wcs-state>` (or on `<wcs-upload-header>`, placed last) and loads no component |
| the header static, hidden with `hidden:`, not in `<template data-wcs="if:">` | 4.10: `match` on a `<wcs-link>` not yet connected | `<template data-wcs="if: showHeader">`, the teacher's link in `if: isTeacher` | every test: on 4.2.0 each header link throws "wcs-link is not connected to a router" |
| the reads `manual`, fetched by a `$watch` per url | 4.3: a url that went empty and comes back is fetched again | the url getters alone (`null` off their page); `command.fetch` for an explicit reload | a notice opened is no longer unread back on the list; a new absence is on the list |
| the skip link's `onclick#prevent:` handler (under `<base href="/">`, `#main` went to `/`) | 4.10: a link to a bare fragment stays on the page | a plain `<a href="#main">` — the handler, kept, cancelled the router's in-page move | the skip link |
| a `console.error` wrapper in the error reporter (and `$errorCallback`) | 4.7: the engine's errors go through `reportError()` | the page's `error` listener alone | an error the engine reports shows the banner and reaches the server once |
| `?v=` on the state's `src` and a `file:` document URL, in the unit tests | 4.9 `mount(html, { resolveModule })` | `resolveModule` | (the unit tests) |
| literal seeds instead of `{ ...EMPTY_DRAFT }`, for the lint | 4.11: the lint reads a spread of a module constant | `draft: { ...EMPTY_DRAFT }`, `formErrors: { ...EMPTY_FORM_ERRORS }`, `absenceErrors: { ...EMPTY_ABSENCE_ERRORS }` | (the lint: 4.10.1's gives this page nine `wcs/binding-path-missing`) |
| `<wcs-ws>` at page level, closed from state only once open (a socket removed while connecting made Chromium warn) | 4.11: a socket still connecting is closed once it opens | `<wcs-ws>` in the notice's route; one `$watch` closes it when the url goes away on the notice itself | leaving a notice while its socket connects |
| **kept**: the badge's label in a child `<span>`, not `textContent:` on `<hr-cat-badge>` | — | a binding on a custom element other than `attr.*` / `class.*` / `style.*` / … waits for its definition, so with a late component the label would be blank; 4.11 only says so (`[wcs/element-undefined]`, 5 s after the page is ready) | the components arriving late |

The pager was plain `<a>` too: `<wcs-link>` marked every page link as the current page up to 4.9, and a link without a
query (page 1) on every query up to 4.10. It is `<wcs-link>` now, page 1 of every notice being `to="/notices?"` — an
explicit, empty query, the current page only where the URL has none (4.11). The category tabs stay plain `<a>` with
their own `aria-current`: in this app a tab is current on every page of its category, which no `to` says (without
`match="prefix"` "宿題" would be current on its first page only; with it, "すべて" on every query). The router still
takes their clicks.

Run on the published 4.2.0 packages, the current app fails all 20 tests of the spec. With the autoloader placed last,
the header static and `<wcs-upload-header>` taken out — the three changes whose errors fail every test — 9 still fail,
each removed workaround its own: the pager, the upload, the skip link, the list and the absences not loaded again, the
socket left connecting, the error reporter (and the two upgrade tests, which look for this tree's files). On the 4.10.1
packages, the pager and the socket fail.

## The lint

```bash
node packages/lint/dist/cli.cjs --strict examples/homeroom/public/index.html   # 0 error(s), 0 warning(s), 0 info (strict)
node packages/lint/dist/cli.cjs examples/homeroom/v4.2.0/index.html            # 0 error(s), 6 warning(s), 0 info
```

The 4.2.0 page keeps its six `wcs/live-region-inserted` warnings (4.10): its status messages are inserted with their
text, so no screen reader announces them — on 4.2.0 too; the current page says them through regions that are always in
the page. They are kept because the page is kept as it shipped. CI's `wcs-validate` runs `--errors-only`, so they do not
fail it. `wcs/lint-version-behind` does not fire: the page pins an older minor than the lint.

## The unit tests

```bash
cd examples/homeroom && npm install && npm test     # Vitest + happy-dom, 37 tests, on the published @wcstack/testing
```

`tests/unit/state.test.js` mounts the page's real `public/state.js` with `@wcstack/testing` and drives it through
stand-in elements on the same event-token surface the page uses: the tabs and the pager, the questions merged by id,
the form's 422 and 401, a logout in another tab, the absence form, the settings. `tests/unit/format.test.js` checks the
helpers. CI does not run them (no example's Vitest suite runs in CI); the devDependencies are the published `^4.11.0`,
which this tree's committed dists are.

## The seams it crosses, and the spec

`e2e/tests/homeroom.spec.ts` (20 tests, Chromium) starts this server with `WCS_LOCAL=1` on port 7300 + 10 × the worker
index. Every test checks that the console has no error and no wcstack warning; the browser's own
`Failed to load resource` lines for the HTTP errors a test provokes are counted apart.

| Seam | What the spec checks |
|---|---|
| the guards × `<wcs-storage>` × `next` | a deep link while logged out lands there after the login, with its query; a logout reaches the server with its token; Back after it shows no member page; a logout in another tab sends this one to the login with `next`, and back after logging in |
| query ⇄ state ⇄ fetch × `<wcs-link>` | the category tab and the page in the URL, through a reload and Back / Forward; `aria-current` on the shown tab and the shown page only; an opened notice no longer unread on the list |
| `<wcs-ws>` × a route × reconnect | a question and its answer live between two browsers; the socket dropped and held while the teacher answers — the answer arrives once it is back, nothing doubled; a notice left while its socket connects closes it without a browser warning |
| `<wcs-upload>` × a bearer token | the attachment goes up with the `Authorization` header (as the server saw it); edit and save twice |
| a form × the server | the 422 next to each field with `aria-invalid`; the leave confirm on a link and on Back; a token expiring mid-form — the login over the form, and the save goes through |
| `<wcs-storage>` × a reload | the settings and the session |
| the router × `<base href="/">` | the skip link stays on the page and focuses the content |
| errors × the page's reporter | an error the engine reports shows the banner and reaches `/api/client-errors` once |
| `<wcs-autoloader>` × late components | the page works before its components arrive, and the badges read |
| versions × one server | the same flows send the same requests from `v4.2.0/` and `public/`; a tab left open on `v4.2.0/` while the server switches keeps working on 4.2.0 (a question asked over its socket) and a reload brings the current app, still logged in; the session and the settings read both ways, an upgrade and a rollback |

## Known limits

- **Chromium prints `Failed to load resource: … status of 401 / 422 / …`** for every failed request. That line is the
  browser's, not the app's, and no page can remove it.
- **A question sent into a dying socket** stays in its box until the server sends it back. If the connection drops at
  that moment the page says it cannot confirm the delivery; after the reconnect the list is loaded again and, if the
  question arrived, the box is cleared — if it did not, the parent sends it again (nothing is resent by itself).
- **After saving a notice, Back shows the same notice once more**: the form's history entry is replaced by the notice,
  as in `examples/router-admin`.
- **Back, then Forward within a frame, can leave the page Back went to on screen** under the Forward's URL — the list
  under `/notices/new` — when the route swap animates: the router compares the Forward with the routes before the Back,
  whose swap is still waiting in the view transition ([docs/seam-apps.md](../../docs/seam-apps.md), open). A reload
  shows the right page. The spec waits for the page before it presses Forward.
- **A `<wcs-upload>` 401 looks like an expired token**: should the header ever go missing, Save turns into a login
  loop. The spec checks every upload carries it.
- **Attachments download from `/files/<random key>/<name>`**, outside `/api/`: a download link cannot carry the token, so
  anyone with the link can download the file.
- **Packages of different versions side by side say nothing.** Since 4.11 a package loaded twice in two versions warns
  (`[wcs/package-twice]`), but an upgrade of some packages only runs without a word (the minors are compatible), and an
  unpinned line names no version, even after its redirect.
- **The back/forward cache** was not verifiable here (Playwright's Chromium restored neither version from it).
- Only Chromium was tested.
