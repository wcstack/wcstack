# state + router + 6 I/O nodes demo (a household budget for two)

家計簿 — a household budget that two people keep together, each on their own laptop. The UI is in Japanese and the amounts are yen. A month's page lists its entries with a category filter and a sort that live in the URL, the total, and each category's spending against its budget; an entry form with a receipt photo and the server's validation; the month's budgets; settings kept on this laptop only. When the other person adds, edits or deletes an entry or changes a budget, the open month updates by itself, and saving an entry the other person changed in the meantime is a conflict to resolve.

It was written by a first-time author who entered through the AI authoring skill alone — a different model, which read nothing of the repository ([docs/seam-apps.md](../../docs/seam-apps.md#family-ledger-2026-10-27)). The seams are the ones the first round of seam apps crossed; the author is what changed.

Packages: `@wcstack/state`, `router`, `fetch`, `storage`, `sse`, `upload`, `network`, `clipboard`; `@wcstack/testing` for the headless tests.

## Run it

The packages load from a CDN ([esm.run](https://esm.run), npm `latest`); the server uses Node's built-ins only:

```bash
node examples/family-ledger/server.js                # http://localhost:3000   (PORT=… to change)
WCS_LOCAL=1 node examples/family-ledger/server.js    # the repository's packages/*/dist instead of the CDN
```

The server builds on `examples/shared/server.js` — copy `examples/shared/` along with this directory if you take it out of the repo. The page is in `public/`. The data lives in memory, seeded with entries and budgets in 2026-09 and 2026-10.

Users: `mom@example.com` (母) and `dad@example.com` (父), password `pass`. Open the app in **two browsers** (or a normal and a private window) and log in as each.

| URL | |
|---|---|
| `/login` | Log in (`?next=` is where to go afterwards) |
| `/` | This month |
| `/months/2026-10?category=food&sort=-amount` | A month: the total, a bar per category against its budget (red when over), the entries. `category` and `sort` (`date`, `-date`, `amount`, `-amount`) are in the URL |
| `/entries/new`, `/entries/:id/edit` | The entry form: date, amount, category, memo, a receipt photo (JPEG / PNG / WebP, 5 MB at most); Delete on the edit page |
| `/budgets/2026-10` | The month's budget per category |
| `/settings` | The default category of a new entry and whether the month shows the memo column — this browser only |

`?delay=<ms>` and `?fail=1` on any page of the app go along with every API call that page makes (`/months/2026-10?delay=3000`). The month's 再試行 (Retry) drops `fail`, so the retry can succeed.

API: `POST /api/login` (`{ email, password }` → `{ token, expiresAt, user }`), `GET /api/categories`, `GET /api/entries?month=`, `GET /api/entries/:id`, `POST /api/entries` (`clientId` makes it idempotent; 422 `{ errors: { field: message } }`), `PUT /api/entries/:id` (with `version`; 409 `{ error: "conflict", current }`), `DELETE /api/entries/:id` (204), `POST /api/entries/:id/receipt` (multipart, the field `file`; 413, 415), `GET` / `PUT /api/budgets?month=` (422 per category), `GET /api/events?token=` (SSE: `entry-created` / `-updated` / `-deleted`, `budget-updated`, each with `id:`; honours `Last-Event-ID`; `retry: 3000`). Every `/api/*` but the login needs `Authorization: Bearer` (the stream: `?token=`, as an `EventSource` sends no header); a token lives 30 minutes. `?delay=<ms>` slows any answer and `?fail=1` makes it 500.

Test hooks (`POST`, never 502): `/__reset`, `/__token-ttl?ms=`, `/__expire` (every token now), `/__drop` (close every stream), `/__restart?ms=` (close every stream and answer 502 to everything for that long), `/__receipt-max?bytes=` (the largest receipt the server takes); `GET /__log` — the server's view: every stream request with its status, every receipt upload with how its token came (`header`, `query`, `none`) and the answer.

## Things to try

- Open `/months/2026-09?category=food&sort=-amount` while logged out → log in → exactly that view. Reload any page → the same page, data and filter.
- Two browsers on the same month: add an entry or change a budget in one → the other's month changes within a second, total and bars too.
- Open the same entry in both, save in one, then in the other → "あなたが編集している間に、この記録が更新されました。" with the other version: load theirs, or overwrite with yours.
- `curl -X POST localhost:3000/__expire` while an entry form has changes, then save → the login page; after logging in you are back on the form with what you typed.
- Attach a receipt: it goes up after the entry is saved, with the same bearer token (`GET /__log` shows `"auth": "header"`). A text file or a 6 MB image is refused before anything is sent.
- `curl -X POST "localhost:3000/__restart?ms=5000"` with a month open → "リアルタイム更新が切れました。再接続しています…", then the stream comes back by itself and the month catches up.
- DevTools → Network → Offline → the banner, saving disabled; add an entry in the other browser, go back online → caught up.
- Change an entry and leave by a link, by Back, or by closing the tab → asked each time.

## The seams it crosses

| Seam | How the page handles it |
|---|---|
| The route guard × `<wcs-storage>` | The session (the token) is in local storage through `<wcs-storage key="ledger.session" data-wcs="value#init=element: session">`. One guard on the parent route reads it from local storage inside the function — it runs before the state has loaded on a page load — and sends a visitor without one to `/login?next=<the path and query>`. |
| The query ⇄ state ⇄ fetch | `category` and `sort` are the router's `searchParams`; the selects write the URL (`navigateUrl`), not the state. Each request's `url` is a getter that is `null` until it makes sense and until the token is there; a month's response is shown only when it is the month on screen (`value.month === this.month`), since `value` keeps the previous response while the next one is in flight. |
| A token × every request | `<wcs-fetch-header name="Authorization" data-wcs="value: authHeader">` on each `<wcs-fetch>`, `<wcs-upload-header>` on the upload, `?token=` on the stream. Any 401 ends the session and goes to `/login?next=<here>`; a form with changes is kept in the page's state for the way back. |
| 422 and 409 × the form | The server's field errors go next to their fields; a 409 shows the version on the server, with "load theirs" and "overwrite". A create carries a `clientId`, so a resend is answered with the first entry. |
| A receipt × the entry | The file is checked (type, 5 MB) when chosen. After the entry is saved, `<wcs-upload manual>` gets its `url` from the saved entry, then `files` and `trigger`; success is the response event, a refusal is `error` with its status — the entry stays saved and the page moves to its edit form to try again. |
| The other person's changes over SSE | `<wcs-sse auto-reconnect reconnect-interval="3000">`: an event for the open month or its budget refetches it. A drop the browser reconnects itself asks with `Last-Event-ID` once an event has arrived; a stream the browser gave up on (a 502 while the server restarts) is reopened by the element; when it is connected again the page refetches what is on screen. |
| A request that finished | A `DELETE` answers 204 every time, and `status` fires nothing for the same value: the page takes the response event (`eventToken.value: deleteDone` + `$on`, `event.detail.status`). |
| Leaving a form | `leaveConfirm` is a string while the form has changes (a link, Back and closing the tab ask), and `null` while it has none or the session just ended. |
| Offline | `<wcs-network offline>` shows a banner and disables saving; back online, the page refetches what is on screen. |
| Tests | `@wcstack/testing`'s `mount(html, { resolveModule })` mounts the page's real `public/state.js` — with its `import` of `./lib.js` — under happy-dom. |

## What building it found

The author's friction log, its 26 mistakes on purpose, and how each claim was reproduced and classified are in [docs/seam-apps.md](../../docs/seam-apps.md#family-ledger-2026-10-27). What 4.9.0 did about them, in short:

| Found | 4.9.0 |
|---|---|
| `<wcs-upload>` could send no header, so a receipt for an API that wants a bearer token was out of the element's reach | `<wcs-upload-header>` |
| The page reopened an SSE stream that gave up (a 502) with its own 3-second timer — the third seam app to write it | `<wcs-sse auto-reconnect>` |
| A second `204` delete never finished: `status` fires nothing for the same value; `value` keeps the previous response | the fetch README says both, and what to take instead |
| `@wcstack/testing`'s `mount()` hung on a `<wcs-state>` with no source and could not load a `src` state | `mount(html, { resolveModule })`, and a message instead of the hang |
| `leaveConfirm: dirty` (a boolean) asked `confirm("false")` | `true` asks with a default message, `false` asks nothing |
| False lint warnings for rows assigned with `map` and a `{}` seed; a getter reading `this.monthFetch.value` left the page on "読み込み中…" as a warning | the assignments are read; an error where a binding writes the path |

Landing it here removed the workarounds 4.9.0 made unnecessary:

- **`UploadCore` imported from the CDN** to send the token with the receipt — `<wcs-upload manual>` with `<wcs-upload-header name="Authorization" data-wcs="value: authHeader">`, loaded with the other packages, before state.
- **The 3-second loop that reopened the stream after it gave up** (`openLiveLater`, `liveTimer`, a `connect` command token) — `auto-reconnect reconnect-interval="3000"`; the catch-up when the stream is connected again stays.
- **Delete told by watching `deleteFetch.loading` go `true` → `false`** — the response event, `eventToken.value: deleteDone` and `$on`, reading `event.detail.status` (a 404 — deleted by the other person — counts as gone).
- **The JSDoc on `budgetRows`** — the lint reads rows assigned with `map` now.
- **The tests' copy of `lib.js` pasted into an inline state** (and the setup file that turned `URL.createObjectURL` off for it) — `mount(html, { resolveModule })` over the real `state.js`.

Kept, with a comment saying why: the JSDoc on the fetched categories (the lint cannot know a response's shape); `summaries` mapped again into an object literal (the lint does not follow an imported helper); and `fieldErrors` seeded with every key. The 4.9 lint would take a `{}` seed with object literals assigned to it, but the state's diagnostics add-on looks at the value on load and warns `[wcs/binding-path-missing]` for every `fieldErrors.*` binding, saying updates will be dropped — they are not ([docs/seam-apps.md](../../docs/seam-apps.md#landing-family-ledger-in-examples-2026-10-28)).

The published lint gives the page 0 errors, 0 warnings and 0 infos (`--strict` too).

## Known limits

- **The packages follow npm `latest`.** The one-liners are unpinned, as in the other examples; production pins versions with `integrity` ([docs/sri.md](../../docs/sri.md)).
- **A logout in another tab is half done in this one**: the header empties, but the month stays on screen until the next navigation, which the guard sends to the login; a login in another tab changes who this tab is without a word. The app has no reaction to the session changing under a page that is not navigating — [router-auth](../router-auth/) shows one `$watch` on the session that leaves member pages.
- **A stream whose token expired is retried every 3 s**, each a 401 (an `EventSource` cannot tell a 401 from a 502), with the "再接続しています…" banner, until the page's next request finds the expiry and asks for the login. Tokens are not refreshed.
- **A draft survives a forced login**, which stays in the page; a reload on the login page loses it.
- **The server's 413 / 415 are reached only through `/__receipt-max`**: the page refuses a file of another type or over 5 MB before sending it.
- **Firefox logs "The connection … was interrupted while the page was loading."** on a full navigation with the stream open. Closing the stream in `beforeunload` would avoid it, but a leave prompt answered "stay" would then leave the page without its stream (the sse README).
- **The data lives in memory**: a restart of the server brings back the seeded entries, and every session ends.

## Tests

```bash
cd examples/family-ledger && npm install && npm test     # Vitest + happy-dom: the month's totals, the entry form's field errors
```

`tests/lib.test.js` checks the pure helpers (totals, budgets, filter and sort, CSV, formatting); `tests/form.test.js` mounts the entry form with the page's real `public/state.js` (`resolveModule`) and checks the server's 422 next to each field, the 409 notice and the two-way binding.

[`e2e/tests/family-ledger.spec.ts`](../../e2e/tests/family-ledger.spec.ts) (`WCS_LOCAL=1`, one server per worker on port 5900 + 10 × the worker index) turns the author's checks into Chromium tests: a reload on every page; a deep link while logged out; Back and Forward between months and forms, and Back after logging out; adding, editing and deleting twice; two browsers seeing an entry and a budget change live; the 409 with "load theirs" and "overwrite"; a token expiring mid-edit; the 422 next to each field; the receipt sent with the `Authorization` header (as the server saw it) and the refused files; a slow and a failing server, and quick month switching; offline and the catch-up; the server restarting and the stream coming back by itself (a 502, then a 200 the element opened); the leave confirm on a link, on Back and on closing the tab; CSV and settings. Every test checks that the console has no wcstack warnings or errors; the browser's own `Failed to load resource` lines for the HTTP errors a test provokes are counted apart.
