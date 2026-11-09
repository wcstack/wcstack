# みどり市民会館 — wcstack islands on a page it does not own

A seam app ([docs/seam-apps.md](../../docs/seam-apps.md), community-hall): written by a first-time author from the public documents only, on wcstack 4.19.0, and landed here without the workarounds 4.20.0 made unnecessary. The guide it led to is [docs/islands.md](../../docs/islands.md); its e2e spec is [e2e/tests/community-hall.spec.ts](../../e2e/tests/community-hall.spec.ts).

The hall's site is rendered by its own small CMS (`server.js` + `templates/`), uses **htmx 2.0.11** for boosted
navigation, the live search and the booking fragment, and gets five **wcstack** islands without becoming a
single-page app:

| Island | Where | What it does |
|---|---|---|
| マイリスト | ☆ on every card (home, list, もっと見る/search cards, event page), count in the header, `/my` | stored in `localStorage` (`<wcs-storage>`), the same in every tab at once; `/my` loads the details with `<wcs-fetch>` |
| 空席 | every card and the event page | live from `GET /api/seats/stream` (`<wcs-sse>`); 満席 at 0; refetched after a reconnect |
| 予約 | the booking fragment of an event page | tickets 大人/子ども/シニア 0–6, live total, one name per ticket (kept when counts change or a ticket is removed), 422 by the fields, 409, confirmation, asks before leaving |
| 絞り込み | `/events` | dates, category chips, 空席ありのみ, sort — drives the CMS's htmx search; everything in the URL (reload, bookmark, Back/Forward) |
| 予約ウィジェット | partner sites (旅館みどり荘) | event, live seats and a short booking form, on another origin, Turbo, alongside the partner's own wcstack 4.17.0 |

## Run it

```bash
cd examples/community-hall
npm install          # htmx, Turbo, and the inn's wcstack 4.17.0 — served from node_modules
npm start            # hall: http://localhost:5621/   inn (partner demo): http://localhost:5622/
WCS_LOCAL=1 npm start   # the hall's and the widget's wcstack from this repository's packages/*/dist
npm run lint         # @wcstack/lint over every template (templates/, inn/)
npm run lint:rendered   # the pages as the browser gets them, --strict, with the states read (--root=public)
npm test             # vitest + happy-dom + @wcstack/testing: booking logic, the page state, the widget state
```

Node 22. Without `WCS_LOCAL`, the hall's wcstack comes from `esm.run` (the latest release), so the pages need the
network. Ports: `HALL_PORT` / `INN_PORT` (5621/5622; the rendered lint uses 5633/5634). The browser flows are
[e2e/tests/community-hall.spec.ts](../../e2e/tests/community-hall.spec.ts) (Chromium, `WCS_LOCAL=1`).

The template lint passes the fragments (`templates/card.html`, `booking.html`, …) with `wcs/state-absent` infos: they
have no state, so their paths are checked by `npm run lint:rendered`, which lints them inside their pages.

Test hooks: `?delay=<ms>` on `/api/*` and fragments, `POST /api/_test/fail {path,status,times}`,
`POST /api/_test/seats {id,remaining}`, `POST /api/_test/reset`.

## How the islands sit on a CMS + htmx site

- **One root state per page.** The layout has one `<wcs-state src="/js/site.js">`; every island is a key of it
  (`booking.*`, `filter.*`, the seat and star maps). Boosted navigation replaces the body and with it the root, and
  since 4.20 each root evaluates the module anew, so each page starts with a fresh state. What the CMS knows about the page (the seats it rendered,
  the URL's filters, the event's id and prices) is in `<script type="application/json" id="page-seed">`.
- **Markup htmx inserts** (cards from the search and もっと見る, the booking fragment) is handed to wcstack's binder in
  `public/js/hall.js` on `htmx:load`, and what htmx throws away from those regions — the cards the server rendered
  first included — is let go of on `htmx:beforeCleanupElement` (`release`, 4.20).
- **Wording lives in the templates.** The states hold only values and flags; every sentence of the booking section,
  the filter summary, the seat labels and the widget is in `templates/*.html` (the e2e test edits
  `templates/booking.html` and sees the change with no JavaScript touched).
- **The CMS's `{{ }}` and wcstack:** the state sets `$behavior.enableMustache: false`, and islands use `data-wcs`
  and comment bindings (`<!--@@: … -->`) only — so CMS braces never meet wcstack's, and an event title containing `{{`
  is just text.
- **Back / Forward** come from the server (`hx-history="false"`): htmx's snapshot would hold the already-rendered DOM,
  which cannot be bound again (`[wcs/rendered-copy]`).

## The partner snippet (予約ウィジェット)

Paste where the widget should appear (the `<script>` may also go in `<head>`; pasting it twice is harmless):

```html
<script type="module" src="https://<the hall's site>/widget/midori-booking.js"></script>
<midori-booking event="12"></midori-booking>
```

- `event` is the event's number (the number in the hall's URL `/events/12`). Several widgets, for several events, may
  be on one page.
- The widget lives in its own shadow root: your stylesheet does not change it and its styles do not leak into your page.
- It brings its own wcstack in a scoped custom-element registry, so a page that already uses wcstack (any
  version) keeps its own. **Browsers:** Chrome / Edge 146+ and Safari 26+. Firefox has no scoped registries yet:
  there the widget shows a link to the event on the hall's site instead of the form (it would otherwise run silently
  on *your* wcstack version).
- Works with Turbo Drive (and plain pages): a widget starts fresh on each page; Turbo's previews get a placeholder.
- It talks to the hall's API from your origin; the hall must list your origin for CORS (`INN_ORIGIN` in
  `server.js` — one origin today).

The inn's demo site is `inn/` (three pages; the widget on the top page and two widgets on 周辺のイベント), served by
`server.js` on the second port with Turbo 8.0.23, its own stylesheet (which deliberately restyles `button`, `input`
and `[hidden]`) and its own wcstack 4.17.0 contact form.

## What does not work, or is fragile

- **Firefox: no widget form** (see above). Only Chromium was tested; Safari not at all.
- **Back / Forward re-request the page** from the server (no htmx snapshot), so they cost a round trip and the scroll
  position is not restored. A half-filled booking form is lost on Back once the visitor confirms leaving.
- **The leave-page question on Back** works by stopping htmx's `popstate` handler and pushing the URL back; it relies
  on htmx registering its listener in the bubbling phase (true in 2.0.11).
- **The binder hand-off** (`hall.js`) knows the regions htmx swaps into (`#results`, `#booking-slot`): a new region
  needs adding there.
- **Stream gap:** the page refetches `/api/seats` whenever the stream reconnects; changes made while a page was
  offline are caught up then, not replayed. On the hall's pages there is no "reconnecting" notice (the widget has one).
- **htmx attributes inside wcstack templates** (`for:` / `if:` rows) are never processed by htmx; keep them outside.
- **Two widgets for the same event** are independent forms (by design); they do not share what was typed.
- **The rendered-page lint** must be told about new pages (`scripts/lint-rendered.mjs`).
- Booking confirmation emails are not sent (the text says so; there is no mail in this demo).

## Files

- `server.js` — CMS `render()`, pages and fragments, the API and SSE, test hooks, the inn's site on the second port.
- `templates/` — every page, fragment and the widget's markup. `inn/` — the partner's pages and stylesheet.
- `public/js/site.js` (page state), `public/js/booking-core.js` (pure booking logic), `public/js/hall.js` (htmx glue),
  `public/widget/` (the widget), `public/css/hall.css`.
- `tests/unit/` (Vitest), `scripts/lint-rendered.mjs`.
- The author's friction log, life events and mistakes on purpose are summarized in
  [docs/seam-apps.md](../../docs/seam-apps.md) (community-hall).
