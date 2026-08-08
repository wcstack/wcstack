# state + sse + network demo (live metrics, two idioms)

The same Server-Sent Events **endpoint**, consumed two ways on the same page. Each idiom opens its own `EventSource`, and the server generates samples per connection, so the two panels never show the same numbers — they are two independent readings of the same feed shape:

- **Left panel** — `<wcs-sse>`: the *tag* owns the connection. Named events flow into state through `eventToken.message` and are folded by a `$on` handler.
- **Right panel** — `$streams`: the *state* owns the connection. An `EventSource` is bridged into a **`ReadableStream`** and folded into a single reactive property. `ReadableStream` is the bridge shape to reach for: on abort a parked read is force-unwound through `reader.cancel()` (fully rescued), whereas an async generator parked on an `await` is only partially rescued — it stops on its next resume, not on the abort itself.

`<wcs-sse>` and `$streams` compete for the same job, so this demo deliberately runs them **side by side** instead of chaining them — the point is to show when to pick which.

## Getting Started

```bash
node examples/state-sse-dashboard/server.js
```

Open http://localhost:3000. All three packages (`state` / `sse` / `network`) load from the CDN — `$streams` ships since v1.19.0, so no local build is needed.

## The punchline: switch hosts

The **host A / host B** buttons change the feed. Both panels reconnect — but:

- the left panel's history reset is **three manual lines** in `setHost()` (the tag reconnects itself when `sseUrl` changes, but the folded history in state does not reset itself);
- the right panel needs **none of that**: `args: (state) => ({ host: state.host })` captures the dependency, so writing `host` aborts the old `EventSource` and restarts the fold from `initial` (switchMap semantics).

## Other things on display

- **Named SSE events**: `events="metric,deploy"` funnels every named event into the single `message` output; `message.event` says which one fired. The occasional `deploy` event drives the banner on the left panel.
- **Bounded folds**: both sides keep a last-20 window plus a count. Backpressure is explicitly abandoned in this stack, so *bounded* aggregation is the contract for long-lived streams.
- **Native reconnection, and where it stops**: `<wcs-sse>` adds no reconnection logic — kill and restart the server and watch `EventSource` recover on its own (the `retry: 3000` hint comes from the stream). The right panel's bridge ignores those same transient `error` events (`readyState` still `CONNECTING`) for exactly that reason, and calls `controller.error()` only once `readyState` reaches `CLOSED` — a terminal failure such as a bad status or content-type. That is the one path that drives `$streamStatus.metrics` to `error` and renders `$streamError.metrics`.
- **network tile**: `<wcs-network>` is a pure monitor of the Network Information API — connection *quality* (`effectiveType` / `downlink` / `rtt` / `saveData`), **not** online/offline, with no attributes and no commands. Its initial snapshot is dispatched synchronously on connect, possibly before the bindings attach — and nothing is lost, because all five are output-only `wcBindable` members: the element is their authority, so state reads the current value as each binding attaches and takes later changes from the events.
