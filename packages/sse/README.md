# @wcstack/sse

`@wcstack/sse` is a headless Server-Sent Events (`EventSource`) component for the wcstack ecosystem.

It is not a visual UI widget.
It is a **one-way I/O node** that connects an SSE stream to reactive state.

With `@wcstack/state`, `<wcs-sse>` can be bound directly through path contracts:

- **input / command surface**: `url`, `trigger` (plus the connection options `withCredentials`, `events`, `raw`, `manual`)
- **output state surface**: `message`, `connected`, `loading`, `error`, `readyState`

This means server-pushed streaming can be expressed declaratively in HTML, without writing `new EventSource()`, `onmessage`, or connection glue code in your UI layer.

`@wcstack/sse` follows the [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md) (Core / Shell / Binding Contract) architecture:

- **Core** (`SseCore`) handles connection, message parsing, and async state
- **Shell** (`<wcs-sse>`) connects that state to DOM attributes, lifecycle, and declarative commands
- **Binding Contract** (`static wcBindable`) declares observable `properties`, writable `inputs`, and callable `commands`

## Relationship to `@wcstack/websocket`

`<wcs-sse>` is the **receive-only, one-way** counterpart of `<wcs-ws>`. The shape is the same, but SSE is simpler:

| | `<wcs-ws>` | `<wcs-sse>` |
|---|---|---|
| Direction | bidirectional | **server → client only** |
| Send | `send` / `sendMessage()` | — (not available) |
| Reconnection | manual (`auto-reconnect`) | **native** (handled by the browser) |
| Named events | — | **`events` attribute** (`event:` field) |
| Wire format | text/binary frames | UTF-8 text only |

If you only consume a stream, prefer `<wcs-sse>`: there is less to configure and reconnection is automatic.

## Install

```bash
npm install @wcstack/sse
```

## Quick Start

### 1. Reactive stream from state

When `<wcs-sse>` is connected to the DOM with a `url`, it automatically opens an `EventSource`. JSON payloads are automatically parsed.

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/sse/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      lastMessage: null,
      isConnected: false,
      isLoading: false,

      get connectionLabel() {
        return this.isConnected ? "Connected" : "Disconnected";
      },
      get lastMessageJson() {
        return JSON.stringify(this.lastMessage, null, 2);
      },
    };
  </script>

  <wcs-sse
    url="/events"
    data-wcs="message: lastMessage; connected: isConnected; loading: isLoading">
  </wcs-sse>

  <p data-wcs="textContent: connectionLabel"></p>
  <pre data-wcs="textContent: lastMessageJson"></pre>
</wcs-state>
```

This is the default mode:

- set `url`
- receive `message`
- optionally bind `connected`, `loading`, `error`, and `readyState`

### 2. The `message` shape

Every received event — the unnamed `message` plus any named events you subscribe to — is delivered as a single object:

```ts
{
  event: string;        // event type ("message" for unnamed events)
  data: unknown;        // parsed payload (raw string when `raw` is set)
  lastEventId: string;  // the SSE `id:` field, if present
}
```

State-side code branches on `event` to decide what to do. This keeps the binding surface a single, statically-declared property while still supporting SSE's named events.

### 3. Named events

SSE streams can label events with an `event:` field:

```
event: price
data: {"symbol":"AAPL","value":189.2}

event: trade
data: {"side":"buy","qty":10}
```

List the names you want in the `events` attribute (comma-separated). They are funneled into the same `message` property; `message.event` tells you which one fired.

```html
<wcs-sse
  url="/market"
  events="price, trade"
  data-wcs="message: lastEvent">
</wcs-sse>
```

Unnamed `data:` lines always arrive as `message` (event type `"message"`) without any configuration.

### 4. Raw text streams

By default, string payloads that parse as JSON are auto-parsed. For plain-text streams (logs, progress, token streams) where you want the literal string — and to avoid surprises like `"123"` becoming the number `123` — set `raw`.

```html
<wcs-sse url="/log" raw data-wcs="message: lastLine"></wcs-sse>
```

### 5. Manual connection with `trigger`

Use `manual` when you want to control when the connection opens.

```html
<wcs-state>
  <script type="module">
    export default {
      shouldConnect: false,
      lastMessage: null,
      isConnected: false,

      get connectionLabel() {
        return this.isConnected ? "Connected" : "Disconnected";
      },
      openStream() {
        this.shouldConnect = true;
      },
    };
  </script>

  <wcs-sse
    url="/events"
    manual
    data-wcs="trigger: shouldConnect; message: lastMessage; connected: isConnected">
  </wcs-sse>

  <button data-wcs="onclick: openStream">Connect</button>
  <p data-wcs="textContent: connectionLabel"></p>
</wcs-state>
```

`trigger` is a **one-way command surface**:

- writing `true` initiates a connection attempt (`connect()`)
- it resets itself to `false` after the attempt is initiated
- the reset emits `wcs-sse:trigger-changed`

```
external write:  false → true   No event (triggers connect)
auto-reset:      true  → false  Dispatches wcs-sse:trigger-changed
```

Note: `trigger` always performs the auto-reset and emits `wcs-sse:trigger-changed`, but it does **not** guarantee a new connection opens. If `url` is unset, or the element is already connected to the same `url`, `connect()` is a no-op (the latter is the idempotency guard that absorbs the upgrade double-fire) — in those cases only the reset fires. Call `close()` first if you need to reopen the same `url`.

## Reconnection is native

Unlike `<wcs-ws>`, there is **no** `auto-reconnect` / `reconnect-interval` / `max-reconnects` configuration. `EventSource` reconnects automatically when the connection drops, and the server controls the delay via the SSE `retry:` field.

`<wcs-sse>` surfaces this through state:

- while the browser is reconnecting, `loading` is `true`, `connected` is `false`, `readyState` is `CONNECTING (0)`
- on a permanent failure (e.g. non-2xx response, wrong content type), `readyState` becomes `CLOSED (2)` and `loading` is `false`
- `error` holds the latest error `Event`

To stop reconnection, call `close()` (or remove the element from the DOM).

## State Surface vs Command Surface

### Output state (bindable async state)

| Property | Type | Description |
|----------|------|-------------|
| `message` | `WcsSseMessage \| null` | Latest received event `{ event, data, lastEventId }` (JSON auto-parsed) |
| `connected` | `boolean` | `true` while the stream is open |
| `loading` | `boolean` | `true` while connecting or reconnecting |
| `error` | `Event \| Error \| null` | Connection error |
| `readyState` | `number` | `EventSource` readyState constant |

### Input / command surface

| Property | Type | Description |
|----------|------|-------------|
| `url` | `string` | SSE endpoint URL |
| `withCredentials` | `boolean` | Send credentials with the request |
| `events` | `string` | Comma-separated named events to subscribe to |
| `raw` | `boolean` | Disable JSON auto-parsing |
| `trigger` | `boolean` | One-way connection trigger |
| `manual` | `boolean` | Disables auto-connect on DOM attach |

## Architecture

`@wcstack/sse` follows the CSBC architecture.

### Core: `SseCore`

`SseCore` is a pure `EventTarget` class. It contains:

- `EventSource` connection management
- named-event subscription funneled into `message`
- JSON message parsing (with `raw` opt-out)
- async state transitions
- `wc-bindable-protocol` declaration for observable state and callable commands

It can run headlessly in any runtime that supports `EventTarget` and `EventSource`.

### Shell: `<wcs-sse>`

`<wcs-sse>` is a thin `HTMLElement` wrapper around `SseCore`. It adds:

- attribute / property mapping
- DOM lifecycle integration
- declarative helper: `trigger`
- `wc-bindable-protocol` inputs for DOM-facing configuration

### Target injection

The Core dispatches events directly on the Shell via **target injection**, so no event re-dispatch is needed.

## Headless Usage (Core only)

`SseCore` can be used standalone without the DOM. Since it declares `static wcBindable`, you can use `@wc-bindable/core`'s `bind()` to subscribe to its state:

```typescript
import { SseCore } from "@wcstack/sse";
import { bind } from "@wc-bindable/core";

const core = new SseCore();

const unbind = bind(core, (name, value) => {
  console.log(`${name}:`, value);
});

core.connect("/events", { events: ["price", "trade"] });

// Clean up
core.close();
unbind();
```

This works in any runtime where `EventTarget` and `EventSource` are available.

## Programmatic Usage

```javascript
const sseEl = document.querySelector("wcs-sse");

// Connect manually
sseEl.connect();

console.log(sseEl.message);    // latest { event, data, lastEventId }
console.log(sseEl.connected);  // boolean
console.log(sseEl.loading);    // boolean
console.log(sseEl.error);      // error info or null
console.log(sseEl.readyState); // EventSource readyState

// Close
sseEl.close();
```

## Elements

### `<wcs-sse>`

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | `string` | — | SSE endpoint URL |
| `with-credentials` | `boolean` | `false` | Send credentials cross-origin |
| `events` | `string` | — | Comma-separated named events to subscribe to |
| `raw` | `boolean` | `false` | Disable JSON auto-parsing |
| `manual` | `boolean` | `false` | Disable auto-connect |

| Property | Type | Description |
|----------|------|-------------|
| `message` | `WcsSseMessage \| null` | Latest received event (JSON auto-parsed) |
| `connected` | `boolean` | `true` while the stream is open |
| `loading` | `boolean` | `true` while connecting or reconnecting |
| `error` | `Event \| Error \| null` | Error info |
| `readyState` | `number` | `EventSource` readyState constant |
| `trigger` | `boolean` | Set to `true` to open connection |

| Method | Description |
|--------|-------------|
| `connect()` | Open the SSE connection |
| `close()` | Close the connection |

## wc-bindable-protocol

Both `SseCore` and `<wcs-sse>` declare a `wc-bindable-protocol` contract, making them interoperable with any framework, adapter, remote proxy, or tooling layer that understands the protocol.

### Core (`SseCore`)

```typescript
static wcBindable = {
  protocol: "wc-bindable",
  version: 1,
  properties: [
    { name: "message",    event: "wcs-sse:message" },
    { name: "connected",  event: "wcs-sse:connected-changed" },
    { name: "loading",    event: "wcs-sse:loading-changed" },
    { name: "error",      event: "wcs-sse:error" },
    { name: "readyState", event: "wcs-sse:readystate-changed" },
  ],
  commands: [
    { name: "connect" },
    { name: "close" },
  ],
};
```

Headless consumers call `core.connect(url, options)` directly — no `trigger` needed. The Core does not declare `inputs` because options are provided through the `connect()` command.

### Shell (`<wcs-sse>`)

```typescript
static wcBindable = {
  ...SseCore.wcBindable,
  properties: [
    ...SseCore.wcBindable.properties,
    { name: "trigger", event: "wcs-sse:trigger-changed" },
  ],
  inputs: [
    { name: "url", attribute: "url" },
    { name: "withCredentials", attribute: "with-credentials" },
    { name: "events", attribute: "events" },
    { name: "raw", attribute: "raw" },
    { name: "manual", attribute: "manual" },
    { name: "trigger" },
  ],
  commands: [
    { name: "connect" },
    { name: "close" },
  ],
};
```

## TypeScript Types

```typescript
import type {
  WcsSseMessage, WcsSseCoreValues, WcsSseValues,
  WcsSseInputs, WcsSseCoreCommands, WcsSseCommands
} from "@wcstack/sse";
```

```typescript
// A received event
interface WcsSseMessage<T = unknown> {
  event: string;
  data: T;
  lastEventId: string;
}

// Core (headless) — 5 async state properties.
// `error` is the raw failure: the `error` Event from EventSource, or the Error
// thrown by the EventSource constructor. SSE error events carry no structured
// fields, so the raw value is surfaced (nothing to normalize).
interface WcsSseCoreValues<T = unknown> {
  message: WcsSseMessage<T> | null;
  connected: boolean;
  loading: boolean;
  error: Event | Error | null;
  readyState: number;
}

// Shell (<wcs-sse>) — extends Core with trigger
interface WcsSseValues<T = unknown> extends WcsSseCoreValues<T> {
  trigger: boolean;
}

interface WcsSseInputs {
  url: string;
  withCredentials: boolean;
  events: string;
  raw: boolean;
  manual: boolean;
  trigger: boolean;
}

interface WcsSseCoreCommands {
  connect(url: string, options?: {
    withCredentials?: boolean;
    events?: string[];
    raw?: boolean;
  }): void;
  close(): void;
}

interface WcsSseCommands {
  connect(): void;
  close(): void;
}
```

## Configuration

```javascript
import { bootstrapSse } from "@wcstack/sse";

bootstrapSse({
  tagNames: {
    sse: "wcs-sse",
  },
});
```

## Design Notes

- `message`, `connected`, `loading`, `error`, and `readyState` are **output state**
- `url`, `trigger` are **input / command surface**; `withCredentials`, `events`, `raw` are connection options
- `message` carries `{ event, data, lastEventId }` so named events share one bindable property — branch on `event` in state
- `trigger` is intentionally one-way: writing `true` connects, reset emits completion
- JSON payloads are auto-parsed on receive; use `raw` for literal text streams
- Reconnection is native — there is no reconnect configuration; `close()` stops it
- `manual` is useful when connection timing should be controlled explicitly
- `wcs-sse:error` is a **property-change notification** (wc-bindable model), not just a failure signal: it fires with `detail` = the error on failure, and again with `detail = null` when a connection establishes/recovers and the `error` property clears. Treat `error == null` as "no current error", not "no error ever happened"

## License

MIT
