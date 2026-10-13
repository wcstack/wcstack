# state + sse + fetch + storage + network demo (shared task board)

A small team's board with three columns (To do / Doing / Done). Everyone sees the same board: a change made in one browser appears in the others within a second, your own changes show at once and are undone with a message if the server refuses them, and the board survives a dropped connection and going offline.

## Run it

The packages load from a CDN ([esm.run](https://esm.run)), so Node.js alone is enough:

```bash
node examples/state-collab-board/server.js              # http://localhost:3000
PORT=3481 node examples/state-collab-board/server.js
WCS_LOCAL=1 node examples/state-collab-board/server.js  # use the locally built packages/*/dist
```

The server builds on `examples/shared/server.js` — copy `examples/shared/` along with this directory if you take it out of the repo. Cards live in memory: a restart brings back the six starting cards.

Open the board in **two browsers** (or a normal and a private window), give each a name, and change cards in one of them.

## Things to try

- Add, move (◀ ▶), rename (Edit or double-click; Enter saves, Escape cancels) and delete a card in one browser — the other shows each change once, with the name of whoever made it.
- `curl -X POST localhost:3000/api/test/fail-next`, then move a card → it moves, goes back, and the page says why ("Server error. Your change was undone.").
- Start renaming a card in one browser, rename the same card in the other and save there first, then save the first → `409`: the card shows the other version, and the message says who changed it first.
- `curl -X POST localhost:3000/api/test/drop-streams`, then change cards with `curl` (the API below) → the indicator goes to `Reconnecting…` and back to `Live`, and every change is there, none twice.
- DevTools → Network → Offline → the banner appears and every control that changes the board is disabled; change cards in the other browser, go back online → caught up.
- Reload → the board as the server has it, and your name is remembered.

`POST /api/test/reset` puts the six starting cards back (the e2e spec uses it between tests).

## Server API

Cards are `{ id, title, column, order, version, updatedBy }`.

| Request | Answer |
|---|---|
| `GET /api/cards` | `{ cards, seq }` — `seq` is the id of the latest event |
| `GET /api/events` | Server-Sent Events: one `card` event per change, `id: <seq>`, data `{ type: "added" \| "updated" \| "deleted", card }`. With `Last-Event-ID` the missed events are replayed first; an id more than 100 events old gets one `resync` event instead |
| `POST /api/cards` `{ title, column, by }` | `201` card |
| `PATCH /api/cards/:id` `{ title?, column?, version, by }` | `200` card, `404`, or `409 { error, card }` when `version` is not the current one |
| `DELETE /api/cards/:id?by=` | `204` or `404` |

## The seams it crosses

| Seam | How the page handles it |
|---|---|
| Snapshot ↔ event stream | `<wcs-fetch manual>` loads `GET /api/cards` into `snapshot` once the stream is open; `<wcs-sse events="card,resync">` hands every event to `$on.cardEvent` through `eventToken.message`. Events carry the server's `seq`: until a snapshot is applied they are buffered, and anything at or below the snapshot's `seq` is skipped. |
| Server truth ↔ my pending changes | `serverCards` is the board as the server last told us; `ops` holds my changes the server has not answered yet. The `cards` getter lays `ops` over `serverCards`. A refused change is undone by dropping its op; a `409` takes the server's card from the answer. Cards are replaced by id and only by a newer `version`, so my own change arriving twice (answer and event) changes nothing, and an `added` event that matches a pending add of mine retires the temporary card. |
| Several requests at once | The changes are plain `fetch()` calls in `async` methods: one `<wcs-fetch>` is one request at a time, and moves of two cards may overlap. |
| Concurrent edits | Each change sends the `version` it started from — an edit sends the version from when editing began — so the server answers `409` instead of overwriting someone else's change. |
| Reconnect ↔ catch-up | `EventSource` reconnects by itself, but sends `Last-Event-ID` only after the stream delivered an event with an `id:`. When none has arrived, the page loads the snapshot again; a `resync` event does the same. A stream that ended in `CLOSED` (an HTTP error) is reopened with `close()` + `connect()` after 2 s, and the board is loaded again. |
| Online ↔ offline | `<wcs-network data-wcs="offline: offline">` (not `online`: a `data-wcs` name starting with `on` is an event binding). Offline, the indicator says so, a banner appears and the controls are disabled; back online, the stream reconnects and catches up as above. |
| Who I am | `<wcs-storage key="state-collab-board:name" data-wcs="value#init=element: userName">` with a `null` seed keeps the name across reloads; it is sent as `by` with every change. |

## What building it found

This example was built by an author new to wcstack from the public documents only, as one of the seam apps ([docs/seam-apps.md](../../docs/seam-apps.md), "router-admin, state-collab-board, signals-shop"). What it found, and what 4.1.0 did about it:

- `$watch` did not fire for a value an element already had when its binding attached — an `<wcs-sse>` that opened before state bound the page — so the board loaded or not depending on load speed. 4.1.0 fires the watch once when the watches start; the page needs no `$connectedCallback` workaround.
- There was no online / offline output; the page listened on `window`. 4.1.0 adds `<wcs-network>`'s `offline`.
- An `$on` handler written with `this`, like a `$watch` handler, failed with a misleading message. 4.1.0 lint reports `this.…` in an `$on` handler (`wcs/on-handler-this`).
- The READMEs did not say that one `<wcs-fetch>` is one request at a time, that `Last-Event-ID` comes only after an event with an `id:`, or that a `CLOSED` stream is not retried. They do now.
- Found later and fixed: lint did not see an in-place change through `Object.assign` or a local alias (`const cards = this.serverCards; cards[i] = card` — assigning the same array back does not replace the row), nor a write made in `$on` through `state` as the cause of `wcs/getter-untracked-read`. It reports both now.

The real-browser spec is `e2e/tests/state-collab-board.spec.ts`.
