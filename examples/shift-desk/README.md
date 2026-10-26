# state + router + 12 I/O nodes demo (a support desk's console, open for a whole shift)

An operator logs in at the start of a shift and leaves the page open until the end of it, sometimes overnight: the queue of open tickets with the time left before each one's SLA breaches, a ticket's conversation live, today's counters, a wall screen for the team, presence, notifications while the tab is hidden. Nothing here is hard for a minute. The hard part is time: the laptop sleeps with the page open, the tab stays hidden for an hour, the operator looks something up on another site and presses Back, the day changes at midnight, the token expires mid-sentence, a connection dies without being closed, and thousands of events arrive in a day.

Packages: `@wcstack/state`, `router`, `fetch`, `sse`, `websocket`, `storage`, `broadcast`, `timer`, `debounce` (`<wcs-throttle>`, `<wcs-debounce>`), `notification`, `idle`, `network`, `wakelock`, `raf`.

## Run it

The server needs [`ws`](https://www.npmjs.com/package/ws) for the chat; the packages load from a CDN ([esm.run](https://esm.run), npm `latest`):

```bash
cd examples/shift-desk && npm install && node server.js        # http://localhost:3000   (PORT=… to change)
WCS_LOCAL=1 node examples/shift-desk/server.js                 # the repository's packages/*/dist instead of the CDN
```

Users `ana`, `ben` and `carl`, password `pw`; carl is the other operator, and the server lets him claim a ticket now and then. The server builds on `examples/shared/server.js` — copy `examples/shared/` along with this directory if you take it out of the repo. The data lives in memory, with 25 seeded tickets.

Switches: `TICK_MS` (a new ticket every so many ms of server time, default 20000; `0` for none), `PING_MS` (the chat's ping, default 20000), `TOKEN_TTL` (an access token's life, default 15 minutes), `START_AT` (the server's clock at start, in ms). A page URL may carry `?stale=<ms>`: the page goes out with that `stale-after` on its stream and its chat.

| URL | |
|---|---|
| `/login` | Log in (`?next=` is where to go afterwards) |
| `/` | The queue: the open tickets, most urgent first, with age, SLA countdown and owner; the notification preferences, the other tabs, the recent activity |
| `/tickets/:id` | One ticket (`:id(int)`): claim, close, the conversation live, the reply box with its draft, the outbox for this ticket |
| `/wall` | The wall screen: open / urgent / breached, the load of the last hour drawn every frame, the screen kept on |
| `http://127.0.0.1:3000/elsewhere` | Another site, to leave to and come back from with Back |

API: `POST /api/login`, `POST /api/refresh` (401 `{ error: "revoked" }`), `GET /api/tickets?status=open|mine|closed` (`{ seq, tickets }`: `seq` is the last event the snapshot includes), `GET /api/tickets/:id`, `POST /api/tickets/:id/claim` (409 `{ error: "claimed", by }`), `POST /api/tickets/:id/replies` (`{ text, clientId }`; the same `clientId` again returns the first answer; 409 when closed, 422 for an empty or long text), `POST /api/tickets/:id/close`, `GET /api/stats/today` (the server's local day), `GET /api/events?since=&token=` (SSE, each event with `id:`, honours `Last-Event-ID`), `WS /ws/chat?ticket=&token=` (messages, typing, a ping every `PING_MS`). Every other `/api/*` needs `Authorization: Bearer`; `?delay=<ms>` slows an answer and `?fail=1` makes it 500. Test hooks (`POST`, never 502): `/api/test/reset?at=`, `/api/test/time?at=|add=`, `/api/test/tick?ms=`, `/api/test/ping?ms=`, `/api/test/drop`, `/api/test/restart?ms=` (502 for that long), `/api/test/blackhole` (stop writing to every open stream and socket without closing them), `/api/test/token-ttl?ms=`, `/api/test/expire`, `/api/test/revoke`, `/api/test/burst?n=`, `/api/test/customer?ticket=&text=`; `GET /api/test/state` (the server's view: open ids, today, the connections, every stream opened and chat joined) and `GET /api/test/ticket?id=`.

## Things to try

- Open a ticket and close the laptop's lid for a while. On waking, the queue catches up (the stream reopens from the last event the page applied), the token is refreshed before anything else asks with the old one, the chat reconnects and the ticket reloads; what arrived meanwhile is told in one notification, not one per ticket.
- `curl -X POST localhost:3000/api/test/blackhole`: the server stops writing and closes nothing, as after a sleep or behind a NAT. Within a minute the header says "Reconnecting…", then "Live" again, and the queue has what it missed. `http://localhost:3000/tickets/1?stale=5000` shortens the wait.
- On a ticket, go to `http://127.0.0.1:3000/elsewhere` and press Back: the page comes back from the back/forward cache (Chromium), the chat reconnects, the queue catches up.
- Move from one ticket to another (a parameter-only navigation): the chat joins the new ticket only — `GET /api/test/state` lists the joins.
- Write half a reply, open another ticket, come back, reload: each ticket keeps its own draft.
- DevTools → Network → Offline, send two replies: they wait in the outbox and go once each when the network is back. Then `curl -X POST localhost:3000/api/test/revoke` and `…/expire` with a reply half written: the login page says the drafts are kept, and after logging in you are back on the ticket with the reply in the box.
- Midnight needs both clocks: the e2e spec moves the page's (Playwright's clock) and the server's (`/api/test/time`) together, and at local midnight the counters start again from zero and the date in the header changes. Moving only the server's — `START_AT` a day ahead — shows what the page does with an answer for another day: it does not show the counters of another day, and says which day the server is on.
- Open the same ticket in two tabs: each says so, and the queue in a third marks the ticket "(open in another tab)".
- Leave `/wall` on a screen: the wake lock keeps it on; hide the tab and the frames stop, show it and the chart is right at once.

## The seams it crosses

| Seam | How the page handles it |
|---|---|
| Time × timers | One key, `now`, is written from `Date.now()` by a 1-second `<wcs-timer>`; every getter that needs the time reads `this.now`. A tick is a reminder to read the clock, never a measure: after a sleep the next tick reads the real time, and a gap of more than 15 s between ticks is how the page notices it slept. `<wcs-raf>`'s `dt` only moves the wall's chart between ticks (it is active time, not wall time). |
| One wake handler | A sleep, a freeze, a back/forward-cache restore and a long hidden spell all end in `onWake()` ([docs/long-lived-pages.md](../../docs/long-lived-pages.md), "One wake handler"): the listeners for `visibilitychange`, `resume`, `pageshow` (persisted), `online` and the clock gap are added in `$connectedCallback` and removed in `$disconnectedCallback`. It refreshes the token first (awaited), reopens the stream from the page's position, gives the chat a fresh token, reloads the ticket, polls today's counters, tells the other tabs, flushes the outbox, and sums up notifications for 15 s. Everything in it is safe to run twice. |
| The queue × the stream | A `<wcs-fetch>` snapshot gives `{ seq, tickets }`; `<wcs-sse>`'s url carries `since=<seq>` and the token (an `EventSource` cannot send headers). The url is kept fixed while the stream is open and moved only when the page reopens the stream on purpose (the sse README, "Catching up after a reconnect"); events at or below the applied `seq` are skipped. |
| A connection that died without being closed | `stale-after` on both elements: the server makes a ticket every 20 s and pings the chat every 20 s, so `<wcs-sse stale-after="60000">` and `<wcs-ws stale-after="45000">` treat a minute (45 s) of silence as a lost connection. When `errorInfo` says the stream is recoverable, the page moves `since` to the last event it applied, so the stream the element opens again asks from there. |
| A stream that gave up | An HTTP error (a 502 while the server restarts, a 401 for an expired token in the url) ends the `EventSource`: the page reopens it with backoff, after a token refresh, when `errorInfo.recoverable === false`. |
| A route's `<wcs-ws>` × parameter-only navigation | The chat lives in the ticket route; its url is `chatUrl` from the route's `id`. Moving from ticket 3 to ticket 7 joins 7 only. On every reconnect the ticket is reloaded, since what was said meanwhile is not replayed. |
| `<wcs-head>` × hundreds of navigations | The ticket route's title is bound: `<wcs-head><title data-wcs="textContent: ticketTitle"></title></wcs-head>`. The DOM stays flat over a shift of ticket after ticket. |
| `<wcs-ws>` × the back/forward cache | The element closes on a persisted `pagehide` and reconnects on `pageshow`, so a ticket page can be restored instead of reloaded. The stream needs nothing: an `EventSource` does not keep a page out of the cache, and the wake handler reopens it. |
| A token × several elements | The token is in the session (`<wcs-storage>`, local storage, read by the route guard and shared by the tabs). One refresh in flight at a time serves every caller: the fetches' 401 (`eventToken.value`), the wake handler, the outbox. A refused refresh ends the session with "Your session ended. Log in again — your drafts are kept." and `?next=` back to the page. |
| Drafts × tickets × tabs | A draft belongs to its ticket, not to the window: `<wcs-storage data-wcs="key: draftKey; value#init=element: draft">`, one local-storage key per ticket. It survives closing the tab, a crash, a discard; a second tab on the same ticket shares it, and the ticket page says so. |
| Offline × an outbox | `<wcs-network>`'s `offline` shows a banner; a reply written offline, or one that failed for the network or a 5xx, waits in an outbox (`<wcs-storage>`) and is sent in order when the network or the session is back, with the `clientId` it was given first, so the server keeps it once. |
| Midnight | "Today" is the operator's local day, from `now`. At local midnight the counters start again from zero and the server is asked at once; an answer for another day than the page's (around midnight, or another time zone) is not shown. |
| Thousands of events | Stream events are applied in 50-ms batches; the 200 most urgent rows are rendered, each with its SLA countdown; the activity feed, the conversation and the chart's samples are capped. |
| Notifications × a hidden tab | `<wcs-notify>` tells of a new urgent ticket or a message on the operator's own tickets while the tab is hidden — one notification per kind per batch, and after a wake a sum ("12 new urgent tickets") rather than one per ticket. |
| Presence | `<wcs-idle>`'s `userState` after Enable presence (`requestPermission()` needs the click). |
| Two tabs | `<wcs-broadcast>`: each tab says which ticket it has open (every 30 s, and `bye` on `pagehide`); a tab that stopped saying it — frozen, asleep — is forgotten after 90 s. A tab's id is in memory, so a duplicated tab gets its own. |

## What building it found

A first-time author built it from the public documents and the published 4.7.0 ([docs/seam-apps.md](../../docs/seam-apps.md), "shift-desk"): 25 frictions; of 16 mistakes made on purpose, 10 told nothing, and the lint flagged 1; the lint's 10 warnings on the app were all false. What 4.8.0 did about them, in short:

| Found | 4.8.0 |
|---|---|
| A bound child of `<wcs-head>` left nodes behind on every navigation | fixed: one bound clone per child |
| On a parameter-only navigation, the route's `<wcs-ws>` joined the previous ticket's chat first | the connect-time work is decided a microtask later, with the inputs then (timing contract §23), in 17 packages |
| A connection that died without being closed was never noticed: the queue froze 80 tickets behind with "Live" in the header | `stale-after` on `<wcs-sse>` and `<wcs-ws>` |
| An open `<wcs-ws>` kept the page out of the back/forward cache | the element closes on `pagehide` and reconnects on `pageshow` |
| `[wcs/command-not-ready]` was said once per page life; idle's `start()` without permission said nothing | once per outage; idle warns |
| False lint warnings under a getter's `@returns` and a method with a call as a default parameter | read; the app has 0 warnings |
| No document on what a page left open needs; the sse README's catch-up recipe reconnected on every event; the idle README's example showed "Away" on every load | [docs/long-lived-pages.md](../../docs/long-lived-pages.md); the READMEs fixed |

Landing it here removed the workarounds 4.8.0 made unnecessary:

- **A watchdog for silent connections** — the page timed the last stream event and the last chat frame, sent its own chat pings, and closed and reopened either after a minute of silence. `stale-after` does it in the elements; the server's 20-s ticket rhythm and chat ping stay, as what the elements listen for.
- **Closing the chat in `pagehide` and reopening it in `pageshow`** (a `close` command and a flag) — the element does both.
- **A static `<title>` in the ticket route and `document.title` set from a `$watch`** — the bound `<title>` no longer leaks.
- **"Reopen when `readyState === 2`"**, guarded against the `CLOSED` an element has before it ever connects — `errorInfo.recoverable === false` says the stream gave up.
- **Presence from idle's `active` with a seed overwritten on load** — the page binds `userState`, `null` until the detector started.

Kept, because a page that stays open needs them by design: the wake handler, the token refreshed before anything else on a wake, the batching and the caps, the outbox with its `clientId`, the per-ticket draft key, the stats' day check.

## Known limits

- **The packages follow npm `latest`.** The one-liners are unpinned, as in the other examples; a console used for a whole shift in production pins versions with `integrity` ([docs/sri.md](../../docs/sri.md)).
- **Presence needs a click on every load**: Idle Detection asks for permission inside a user gesture, and a reload, a discard or a new tab starts without one. Chromium only.
- **No element gives the page's visibility**: the wake handler and "notify while hidden" use plain listeners ([docs/long-lived-pages.md](../../docs/long-lived-pages.md)).
- **What was said in the chat while it was down is not replayed**: the ticket is reloaded on every reconnect instead.
- **A wake's first requests may still carry the old token**: timers that fell due during the sleep run while the wake handler waits for the refresh. They are answered 401 and go again after it — the console shows `Failed to load resource: … 401`.
- **The SLA countdown trusts the client's clock** against the server's `createdAt`: the API has no server time to correct a skew with.
- **Only the 200 most urgent rows are rendered**, and the conversation shows the last 200 messages (with a line saying how many are hidden).
- **Two tabs on one ticket share its draft**: the last keystroke wins in both boxes.
- **The data lives in memory**: a restart brings back the 25 seeded tickets, and every session ends.

## Tests

`e2e/tests/shift-desk.spec.ts` (`WCS_LOCAL=1`, one server per worker on port 5700 + 10 × the worker index) checks the queue against the server's open tickets after a snapshot, a burst and a deep-link reload; a claim lost to carl (409, "carl claimed it first.") and a ticket claimed and closed; a parameter-only navigation joining only the new ticket's chat; a stream and a chat gone silent without a close coming back through `stale-after` from the page's own position; an hour asleep (Playwright's clock and the server's time hook): no login asked, the token renewed, the queue caught up, one notification; local midnight; the node count over 100 round trips between the queue and two tickets; drafts per ticket across navigation and reload; the offline outbox sent once each; a refused refresh with a half-written reply and two in the outbox; Back from another site restoring the page from the back/forward cache with the chat reconnected (full Chromium, launched by the test without `--disable-back-forward-cache`); two tabs.
