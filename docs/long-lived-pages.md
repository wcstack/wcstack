# Pages that stay open

**日本語版**: [long-lived-pages.ja.md](./long-lived-pages.ja.md)

A page opened at the start of a shift and left open — a support desk, a dashboard on a wall screen, a chat — goes through things a page loaded and closed within minutes never meets. This guide lists them, says what wcstack does in each, and what the page has to do itself. It comes from the `shift-desk` seam app, a support-desk console run through a simulated shift ([seam-apps.md](./seam-apps.md)).

## What happens to a page that stays open

| Event | What the browser does |
|---|---|
| The tab is hidden | Timers are throttled (Chromium: at most once a minute after five minutes hidden). `requestAnimationFrame` stops. |
| The laptop sleeps | Nothing runs. On wake, timers that came due fire once — not once per missed period. Connections may have died without being closed, and the network may have changed with no `online` event. |
| The page is frozen | Chromium freezes background tabs (Page Lifecycle `freeze` / `resume`): no task runs until it resumes. |
| The user leaves and comes back with Back | The page may come back from the back/forward cache (`pageshow` with `persisted`): no reload, nothing is connected again. |
| The tab is discarded | Under memory pressure the browser drops the tab and reloads it when it is shown (`document.wasDiscarded`): what was not saved is gone. |
| The tab is duplicated | The new tab gets a copy of the history and of session storage. |
| Time passes | The date changes at midnight, the clock moves at a DST change, a token expires, the server is redeployed, the network flaps. |

## What wcstack does

- **`$connectedCallback`** runs when the `<wcs-state>` element is connected: on load, and when the element is put back after a removal. It does **not** run when the page wakes from sleep, resumes from a freeze, comes back from the back/forward cache, or becomes visible — see [One wake handler](#one-wake-handler).
- **`<wcs-timer>` ticks are not time.** A hidden tab's ticks are throttled and a sleeping laptop's are lost: a 1-second timer counts a few ticks over an hour asleep. Use the tick to read the clock (`Date.now()`) and keep the time in state; do not count ticks, and do not read `Date.now()` in a getter (the lint says `wcs/getter-untracked-read`: a getter does not re-run when time passes).
- **`<wcs-raf>`** stops in a hidden tab (`suspended` is `true`) and reports `dt = 0` on the first frame after; `dt` and `elapsed` measure *active* time. A chart drawn against the wall clock needs the clock: integrating `dt` puts it behind by every hidden minute. A sleep with the tab visible is not a visibility change, so one frame after it can carry a `dt` of the whole sleep.
- **`<wcs-wakelock>`** asks for the lock again when the page is visible again (the browser releases it on hide).
- **`<wcs-sse>`** lets the browser reconnect after a drop, but not after an HTTP error (`CLOSED`) — the page reopens it. Since 4.9, `auto-reconnect` reopens it instead, with the element's `url` at that moment (`reconnect-interval`, `max-reconnects`, as on `<wcs-ws>`). Since 4.8, `stale-after` notices a stream that died without being closed. Its README says how to catch up after a reconnect.
- **`<wcs-ws>`** reconnects on a close with `auto-reconnect`. Since 4.8, `stale-after` notices a connection that died without being closed, and the element closes before the page may enter the back/forward cache and reconnects when it comes back.
- **I/O nodes in a route.** `@wcstack/router` puts a route's same nodes back on every entry. Since 4.8, the work they start on connect uses the new route's inputs ([timing-and-firing-contract.md](./timing-and-firing-contract.md) §23).
- **`[wcs/command-not-ready]`** — a command refused because the element is not ready (a `send` on a closed socket) warns once per outage since 4.8, not once per element: a route's element lives all day.
- **`<wcs-storage>`** keeps what it saved across a reload or a discard. A duplicated tab copies session storage.

## What the page does

### One wake handler

A page that must catch up after a gap listens for the ways a gap ends, and handles them in one place. `visibilitychange` (to visible), `pageshow` with `persisted`, `resume` and `online` each say "you may have missed something"; a clock gap says it after a sleep that changed none of them — a tick every second that sees much more than a second since the last.

```html
<wcs-timer interval="1000" data-wcs="tick: tick"></wcs-timer>
```

```js
let onWakeEvent = null; // a listener is not state: keep it in the module

export default {
  tick: 0,
  now: Date.now(),
  $connectedCallback() {
    onWakeEvent = (e) => {
      if (e.type === "visibilitychange" && document.visibilityState !== "visible") return;
      if (e.type === "pageshow" && !e.persisted) return;
      this.onWake();
    };
    for (const type of ["visibilitychange", "resume"]) document.addEventListener(type, onWakeEvent);
    for (const type of ["pageshow", "online"]) window.addEventListener(type, onWakeEvent);
  },
  $disconnectedCallback() {
    for (const type of ["visibilitychange", "resume"]) document.removeEventListener(type, onWakeEvent);
    for (const type of ["pageshow", "online"]) window.removeEventListener(type, onWakeEvent);
  },
  $watch: {
    tick() {
      const now = Date.now();
      if (now - this.now > 15000) this.onWake(); // slept, frozen or throttled
      this.now = now;
    },
  },
  async onWake() {
    // refresh the token first, then: reopen streams from your own position,
    // reload what is on screen, poll what you poll, flush an outbox,
    // and hold notifications back for a moment (below)
  },
};
```

Keep the handler idempotent: several of these events arrive together after one wake. And refreshing the token first does not hold back the timers that came due during the sleep: they fire on wake, before the refresh returns, with the old token — a request that fails with 401 then runs again once the refresh is done (see [Tokens](#tokens)).

### The page's visibility in state

No element gives the page's visibility as an output. Write it from the event (in the handler above, or alone): `this.pageHidden = document.visibilityState === "hidden"`. Use it to notify only while hidden, or to pause work nobody sees.

### Notifications after a wake

Everything that arrived while the laptop slept arrives at once on wake. A page that notifies per event shows dozens; hold notifications back for a few seconds after a wake and show one summary ("22 new urgent tickets").

### Bound what grows

A list fed by a stream for eight hours holds every event. Keep the last N (`this.events = [...this.events, e].slice(-200)`), cap chat histories and chart points, and render the rows that matter rather than every row.

### Bursts

A reconnect's replay, or a server that catches up, sends many events at once. Each SSE message is its own task, so applying them one by one renders once per event. Buffer them and apply the buffer every 50 ms in one write.

### Tokens

A token expires during a shift. A token in a stream's URL (an `EventSource` cannot send headers) is the one the stream opened with: refresh it before you reopen, or authenticate the stream with a cookie. Since 4.9, `<wcs-sse auto-reconnect>` reopens with the `url` as it is at the attempt, so a token the page already refreshed into it is used; it does not refresh one itself. Several `<wcs-fetch>` that all need the token: refresh once — share one promise for the refresh — and run again what failed with 401.

### Drafts

A draft that belongs to a record (a ticket's reply) wants a key per record in local storage — not one fixed key, which follows the user from record to record, and not session storage, which a duplicated tab copies and a closed tab loses.

### Versions

A page open all day and one opened after a deploy run different versions if they load an unpinned `latest`, and they share local storage and broadcast channels. Pin the versions ([sri.md](./sri.md)).

## Testing a page that stays open

- Playwright's clock (`page.clock.install()`, then `runFor` / `fastForward` / `pauseAt`) moves the page's timers, `Date` and `requestAnimationFrame` — not the browser's own timers (an `EventSource`'s reconnect, a WebSocket), and not your server's clock. `runFor` runs every animation frame it covers; `fastForward` fires each due timer once.
- Playwright starts Chromium with `--disable-back-forward-cache`: launch with `ignoreDefaultArgs: ["--disable-back-forward-cache"]` (and `channel: "chromium"` — the headless shell never restores) to test a restore, and read `performance.getEntriesByType("navigation")[0].notRestoredReasons` when the page is not restored. A page served with `Cache-Control: no-store` is not restored either.
- A headless page is never hidden, and CDP's `Page.setWebLifecycleState` does not freeze a visible page: emulate hiding and freezing in the page, and say so.
- A dead connection is a server that stops writing but keeps the connection open.
