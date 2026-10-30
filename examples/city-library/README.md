# state + router + 6 I/O nodes + view-transition demo (a city library's site, in three languages)

The patron site of a city library in Tokyo, in Japanese, English and Arabic (right to left), built for people who use a keyboard alone, a screen reader, reduced motion, 200 % zoom, another language or another time zone. A catalogue whose search lives in the URL, with filters, a sort and pages; an item page with its copies; holds placed through a form the server validates; the reader's holds and fees; a hold becoming ready, announced while the reader is anywhere on the site; the opening hours of the three branches, always in Tokyo time; display settings.

It was written by a first-time author from the public documents and the AI authoring skill only, to find where packages meet badly for those readers ([docs/seam-apps.md](../../docs/seam-apps.md#city-library-2026-10-29)). There was no screen reader: the author walked every flow with the keyboard, read the accessibility tree, logged every text change of every live region, and ran axe, in Chromium, Firefox and WebKit.

Packages: `@wcstack/state`, `router`, `fetch`, `sse`, `storage`, `debounce`, `timer`, `media-query`, `view-transition`.

## Run it

The packages load from a CDN ([esm.run](https://esm.run), npm `latest`); the server uses Node's built-ins only:

```bash
node examples/city-library/server.js                # http://localhost:5520   (PORT=… to change)
WCS_LOCAL=1 node examples/city-library/server.js    # the repository's packages/*/dist instead of the CDN
```

`/` goes to `/ja/`, `/en/` or `/ar/` — the language chosen before, or the browser's. The page is `public/index.html`; the data lives in memory (`data.js`).

Library cards: `1001` (a Japanese name), `1002` (English), `1003` (Arabic), PIN `1234`.

| URL (under `/ja/`, `/en/` or `/ar/`) | |
|---|---|
| `/` | Home: a search box, today's hours of each branch |
| `/search?q=tokyo&type=book&branch=central&sort=-year&page=2` | The catalogue. Every filter is in the URL; typing in the box refines in place |
| `/items/3` | An item and its copies: branch, status, due date |
| `/items/3/hold` | Place a hold (members only): pickup branch, how to be told, a phone number for SMS |
| `/login?next=…` | Log in |
| `/account`, `/account/fees` | The reader's holds (cancel one in a dialog) and fees (members only) |
| `/hours?from=2026-10-22` | The week's opening hours of each branch in Tokyo time, and in the reader's own when it is another zone (`from` picks the week — the one of London's DST change here) |
| `/settings` | Motion: follow the system, or no animations (kept on this browser) |

API: `POST /api/login`, `GET /api/catalog`, `/api/items/:id`, `/api/branches`, `/api/hours`, `/api/stream?token=` (SSE: `hold-ready`, `hold-expired`, each with `id:`), and with a bearer token `GET /api/me/holds`, `/api/me/fees`, `POST /api/holds` (422 per field, 409 when already held), `DELETE /api/holds/:id`. Every `/api/*` takes `?lang=` for its messages, `?delay=<ms>` and `?fail=1`.

Test hooks (`POST`): `/__reset`, `/__ready?hold=<id>[&days=N]` (the hold is ready, a `hold-ready` event), `/__expire?hold=<id>`, `/__resend?hold=<id>[&sameId=1]` (the same news again), `/__streams` (the cards with an open stream).

## Things to try

- Keyboard only: Tab to the skip link on any page (it shows when focused), Enter → the focus is on `<main>`, the URL is the same page plus `#main`.
- Search for `tokyo`, change the type: the line under the form says the new count; a screen reader hears it once, from a region outside the router.
- Page 2 of the catalogue: only "2" says "current page".
- Open an item while logged out → "Log in to place a hold" → log in with `1002` / `1234` → the hold form. Send it empty → the focus is on the pickup branch, already marked invalid and described by its error; the summary links to each field.
- `curl -X POST "localhost:5520/__ready?hold=1"` with a hold placed → "Your hold … is ready at Central Library." appears once, wherever you are; `/__resend?hold=1` says nothing new.
- Open `/en/hours` with your system's time zone set to Los Angeles or London: the hours are Tokyo's, and a fourth column shows yours.
- Fill in the hold form, then pick another language → asked in the page's language; "Cancel" keeps you, your input and the language you had.
- Turn on reduced motion, or choose "No animations" in the settings: pages change without the cross-fade.

## The seams it crosses

| Seam | How the page handles it |
|---|---|
| The language in the basename | A synchronous `<head>` script settles the language (the URL, the remembered choice, the browser's), writes `<html lang dir>`, adds `<base href="/<lang>/">` and repairs a URL without one. Every URL on the page is root-absolute, the states' `src` included. The dictionary is an ES module, mounted as the `i18n` volume |
| A skip link under `<base>` | A plain `<a href="#main">`: the router keeps a link to a bare fragment on the page and focuses its target |
| After a navigation | `focus="heading"` and `announce="title"` on the router; messages that outlive a navigation ("hold placed", "hold cancelled") and the search's result count go to regions outside the router, written after the navigation (a `$watch` on `path`) |
| The search in the URL | The form follows the router's `searchParams`; submitting and the selects navigate; typing refines with `replaceUrl` behind `<wcs-debounce>`. The count is written from the response event, not from `value` and the current query |
| Pages | `<wcs-link to="?…&page=N">`: a link with a query is the current page only on that query |
| Logging in | The guards read the session from `localStorage` (where `<wcs-storage>` keeps it); one `$watch` on the token moves the login on to `next`, leaves member pages on a logout or a 401, and closes the stream — with `<wcs-view-transition>` on the page |
| The 422 | Each field gets `aria-invalid` and `aria-describedby` from the server's errors; a summary counts them and links to each; a `$watch` moves the focus to the first |
| The cancel `<dialog>` | `command.showModal` / `command.close`; after a confirmed cancel the row goes, so the focus goes to the list's heading |
| A hold becoming ready | `<wcs-sse auto-reconnect>`; each piece of news is written once (deduplicated) into a `role="log"` region outside the router |
| Time zones | The hours, due dates and fee dates are Tokyo's: the `date` / `time` filters with the zone third (`time(,short,Asia/Tokyo)`) |
| Right to left | Logical CSS properties only; `<bdi>` around titles; U+2068 … U+2069 around a title or a query inside a sentence a getter composes |
| Motion | `<wcs-view-transition naming="auto">` skips under `prefers-reduced-motion: reduce`, and is `disabled` by the "No animations" setting |

## What building it found

The author's friction log (28 entries), the 20 mistakes made on purpose, and how each claim was reproduced and classified are in [docs/seam-apps.md](../../docs/seam-apps.md#city-library-2026-10-29). What 4.10.0 did about them, in short:

| Found | 4.10.0 |
|---|---|
| Adding `<wcs-view-transition>` broke the documented login: the `$watch` navigated to `next` before `<wcs-storage>` saved the session, and the guard sent the reader back; a `$watch` moved the focus before the field was marked invalid | `$watch` runs after the bindings the transition applies |
| Under `<base href>` a skip link (`href="#main"`) took the reader to the home route | the router keeps a link to a bare fragment on the page |
| Every pagination link said "current page" | a `<wcs-link>` with a query is current only on that query |
| The date filters formatted in the reader's zone and took none: Thursday 09:00 in Tokyo read as Wednesday 17:00 in Los Angeles | `date` / `time` / `datetime` take a time zone third |
| `if: query.next` was reported "silently dropped" | not reported under an object an element writes |
| 108 false lint warnings on the documented i18n page; a root-absolute `src` was not read | fixed, and `--root=<dir>`; a new warning for a status region inserted with its text |

Landing it here removed the workarounds 4.10.0 made unnecessary:

- **The page at `public/site/index.html` with `src="../app.js"`**, so that the browser (under `<base href="/ja/">`) and the lint (relative to the file) both found the state — the page is `public/index.html` with `src="/app.js"` and `src="/i18n/state.js"`, read by the lint with `--root=public`.
- **The focus moved from `$renderedCallback(paths)`** after a 422 — back in a `$watch` on the errors.
- **The getter `loginRedirected`** reading `this["query.next"]` — `if: query.next`.
- **The Tokyo-time `Intl.DateTimeFormat` formatters** for the hours, due dates and fee dates — the `date` / `time` filters with the zone; the rows hold instants (`Date`).
- **The skip link's `attr.href`** built from the router's path and query plus `#main` — a plain `<a href="#main">`.
- **The login that navigated from `$renderedCallback`** once `localStorage` held the token — the `$watch` on the token, as [router-auth](../router-auth/) does.

Added while landing it: the 422 summary links to each field (in-page fragment links — it is what makes the 422 a structural update, the case the `$watch` focus broke on up to 4.9), page numbers in the pager, a JSDoc `@type` on the dictionary so the lint checks every `i18n.t.*` binding against the English catalog.

Kept, each with a comment saying why:

- **The result count written from the response event** (`eventToken.value` + `$on`), into the line under the form and a visually hidden region outside the router — derived from `value` and the current query, it said the new query with the previous total first; a region in the route body is inserted with its text and is not announced. The router README teaches both since 4.10.
- **The `typing` flag**: the URL watch keeps what is being typed, and only a typed value is written to the URL — the debounce's first settle on a deep link would write `""` over `?q=`.
- **The page-level status region** for messages that outlive a navigation, emptied when a navigation commits (a `$watch` on `path`).
- **The focus moved to the holds' heading** after a confirmed cancel: the dialog gives it back to the row's button, which leaves with its row.
- **The language switch marks the choice in `sessionStorage`**, and the next page's head script commits it — the page cannot tell whether the reader accepted the leave prompt. The head script reads the remembered language raw: `<wcs-storage>` stores a string as it is, not as JSON.
- **`isolate()`** (U+2068 … U+2069) around text of the other direction inside a composed sentence: a `textContent:` binding cannot carry `<bdi>`.
- **Two getters that format time themselves**: the reader's own column on the hours page (a weekday with the time and the zone's name — a filter's style is a whole date or a whole time) and a ready hold's "kept until {date} ({relative})" (a date inside a sentence the dictionary orders).
- **`next` after a 401 read from the URL** (`addressNow()`), not from the router's `path`: with `<wcs-view-transition>` the router sends `path` once the route's content is drawn, a frame after `routeName`, and a 401 landing in that frame (leaving Fees for Holds) sent the reader back to Fees after the login.
- **The pager's page-1 link names `page=1`**, and the shown page's link is the URL as it is: a link with a query is current when the URL has every parameter it names, so a link that left `page` out — the clean URL of a new search — would be current on every page.

## Lint

```bash
node packages/lint/dist/cli.cjs --root=examples/city-library/public examples/city-library/public/index.html
```

0 errors, 0 warnings and 0 infos (`--strict` too). Without `--root` — as the repository's CI scans every page — the two root-absolute `<wcs-state src>` are not read: two `wcs/state-src-unread` infos, and nothing in the states is checked.

## Known limits

- **The packages follow npm `latest`.** The one-liners are unpinned, as in the other examples; production pins versions with `integrity` ([docs/sri.md](../../docs/sri.md)).
- **The first paint waits for the first view transition.** A state update that lands before the page has painted (the branches and the hours on load) runs inside a view transition, and Chromium holds the page's first paint until its update callback — 0.2–0.8 s later in Chromium, up to 2.5 s in Playwright's headless shell; under reduced motion the page paints at once ([docs/seam-apps.md](../../docs/seam-apps.md#landing-city-library-in-examples-2026-10-30)).
- **No screen reader was used.** What a reader hears is inferred from the accessibility tree and the live regions' text changes.
- **WebKit** (Playwright's build on Windows, not Safari): its renderer crashed on this page's view transitions, Tab skips links (Safari's default), and leaving a half-filled form for another language asked twice, the browser's own prompt first.
- **`ar` formats Latin digits**; Arabic-Indic digits come from a region subtag (`ar-EG`), which the page does not use.
- **The data lives in memory**: a restart of the server forgets the sessions and the holds.

## Tests

[`e2e/tests/city-library.spec.ts`](../../e2e/tests/city-library.spec.ts) (`WCS_LOCAL=1`, one server per worker on port 7100 + 10 × the worker index) turns the author's checks into 18 Chromium tests, 7 of them (tagged `@browsers`) in Firefox too: keyboard only from the home page's search to a placed hold, with the 422's focus landing on a field already marked invalid; the 422 summary's links moving in the page; the cancel dialog and where the focus goes back; the skip link on a deep URL, in English and Arabic; `aria-current` only on the shown page; the login under `<wcs-view-transition>` landing on `next`, Back to the page before it, and Back after logging out; the header's login without `next`; a hold becoming ready, written once into the page-level region (a `MutationObserver` on its text) though the server sends it three times; the hours from Los Angeles and London, the due dates and fees in Tokyo dates; `/`, `/ja/`, `/en/`, `/ar/` with `lang` and `dir`, the language switch as a plain link and the remembered choice; the leave prompt when switching language mid-form; reduced motion and "No animations" (no transition started); a reload on every page; Back and Forward through every page; the result count heard once per response and typing written with `replaceUrl`; a member deep link and a 401 sending the reader to the login and back. Every test checks that the console has no wcstack warnings or errors; the browser's own `Failed to load resource` lines for the HTTP errors a test provokes are counted apart.
