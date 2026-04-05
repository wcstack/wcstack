# @wcstack/websocket

`@wcstack/websocket` is a headless WebSocket component for the wcstack ecosystem.

It is not a visual UI widget.
It is an **I/O node** that connects WebSocket communication to reactive state.

With `@wcstack/state`, `<wcs-ws>` can be bound directly through path contracts:

- **input / command surface**: `url`, `trigger`, `send`
- **output state surface**: `message`, `connected`, `loading`, `error`, `readyState`

This means real-time communication can be expressed declaratively in HTML, without writing `new WebSocket()`, `onmessage`, or connection glue code in your UI layer.

`@wcstack/websocket` follows the [HAWC](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/main/docs/articles/HAWC.md) architecture:

- **Core** (`WebSocketCore`) handles connection, messaging, reconnection, and async state
- **Shell** (`<wcs-ws>`) connects that state to the DOM
- frameworks and binding systems consume it through [wc-bindable-protocol](https://github.com/wc-bindable-protocol/wc-bindable-protocol)

## Why this exists

Real-time features typically require imperative WebSocket management: connection lifecycle, reconnection logic, message parsing, error handling, and cleanup on disconnect.

`@wcstack/websocket` moves that logic into a reusable component and exposes the result as bindable state.

With `@wcstack/state`, the flow becomes:

1. state determines the `url` (or `trigger` fires)
2. `<wcs-ws>` opens the connection
3. incoming messages arrive as `message`, connection status as `connected`, `loading`, `error`
4. UI binds to those paths with `data-wcs`

This turns real-time communication into **state transitions**, not imperative event wiring.

## Install

```bash
npm install @wcstack/websocket
```

## Quick Start

### 1. Reactive WebSocket from state

When `<wcs-ws>` is connected to the DOM with a `url`, it automatically opens a WebSocket connection. JSON messages are automatically parsed.

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/websocket/auto"></script>

<wcs-state>
  <script type="application/json">
    {
      "lastMessage": null,
      "isConnected": false,
      "isLoading": false
    }
  </script>

  <wcs-ws
    url="wss://example.com/ws"
    data-wcs="message: lastMessage; connected: isConnected; loading: isLoading">
  </wcs-ws>

  <p data-wcs="textContent: isConnected|then('Connected','Disconnected')"></p>
  <pre data-wcs="textContent: lastMessage|json"></pre>
</wcs-state>
```

This is the default mode:

- set `url`
- receive `message`
- optionally bind `connected`, `loading`, `error`, and `readyState`

### 2. Sending messages from state

Use the `send` property to push data to the server. Setting `send` transmits the value immediately; objects are automatically JSON-stringified.

```html
<wcs-state>
  <script type="module">
    export default {
      chatInput: "",
      lastMessage: null,
      outgoing: null,

      sendChat() {
        this.outgoing = { type: "chat", content: this.chatInput };
        this.chatInput = "";
      },
    };
  </script>

  <wcs-ws
    url="wss://example.com/ws"
    data-wcs="message: lastMessage; send: outgoing">
  </wcs-ws>

  <input data-wcs="value: chatInput" placeholder="Type a message">
  <button data-wcs="onclick: sendChat">Send</button>

  <pre data-wcs="textContent: lastMessage|json"></pre>
</wcs-state>
```

### 3. Manual connection with `trigger`

Use `manual` when you want to control when the connection opens.

```html
<wcs-state>
  <script type="module">
    export default {
      shouldConnect: false,
      lastMessage: null,
      isConnected: false,

      openConnection() {
        this.shouldConnect = true;
      },
    };
  </script>

  <wcs-ws
    url="wss://example.com/ws"
    manual
    data-wcs="trigger: shouldConnect; message: lastMessage; connected: isConnected">
  </wcs-ws>

  <button data-wcs="onclick: openConnection">Connect</button>
  <p data-wcs="textContent: isConnected|then('Connected','Disconnected')"></p>
</wcs-state>
```

`trigger` is a **one-way command surface**:

- writing `true` opens the connection
- it resets itself to `false` after the connection is initiated
- the reset emits `wcs-ws:trigger-changed`

```
external write:  false → true   No event (triggers connect)
auto-reset:      true  → false  Dispatches wcs-ws:trigger-changed
```

### 4. Auto-reconnect

```html
<wcs-ws
  url="wss://example.com/ws"
  auto-reconnect
  reconnect-interval="5000"
  max-reconnects="10"
  data-wcs="message: lastMessage; connected: isConnected; error: wsError">
</wcs-ws>
```

When the connection drops unexpectedly (close code other than 1000), `<wcs-ws>` automatically reconnects:

- waits `reconnect-interval` ms (default: 3000)
- retries up to `max-reconnects` times (default: Infinity)
- resets the retry count on successful reconnection

## State Surface vs Command Surface

`<wcs-ws>` exposes two different kinds of properties.

### Output state (bindable async state)

These properties represent the current connection state and are the main HAWC surface:

| Property | Type | Description |
|----------|------|-------------|
| `message` | `any` | Latest received message (JSON auto-parsed) |
| `connected` | `boolean` | `true` while WebSocket is open |
| `loading` | `boolean` | `true` while connecting |
| `error` | `WcsWsError \| Event \| null` | Connection or close error |
| `readyState` | `number` | WebSocket readyState constant |

### Input / command surface

These properties control connection and messaging from HTML, JS, or `@wcstack/state` bindings:

| Property | Type | Description |
|----------|------|-------------|
| `url` | `string` | WebSocket endpoint URL |
| `trigger` | `boolean` | One-way connection trigger |
| `send` | `any` | Set to transmit data (auto-stringifies objects) |
| `manual` | `boolean` | Disables auto-connect on DOM attach |

## Architecture

`@wcstack/websocket` follows the HAWC architecture.

### Core: `WebSocketCore`

`WebSocketCore` is a pure `EventTarget` class.
It contains:

- WebSocket connection management
- automatic reconnection logic
- JSON message parsing
- async state transitions
- `wc-bindable-protocol` declaration

It can run headlessly in any runtime that supports `EventTarget` and `WebSocket`.

### Shell: `<wcs-ws>`

`<wcs-ws>` is a thin `HTMLElement` wrapper around `WebSocketCore`.
It adds:

- attribute / property mapping
- DOM lifecycle integration
- declarative helpers: `trigger`, `send`

This split keeps the connection logic portable while allowing DOM-based binding systems such as `@wcstack/state` to interact with it naturally.

### Target injection

The Core dispatches events directly on the Shell via **target injection**, so no event re-dispatch is needed.

## Headless Usage (Core only)

`WebSocketCore` can be used standalone without the DOM. Since it declares `static wcBindable`, you can use `@wc-bindable/core`'s `bind()` to subscribe to its state:

```typescript
import { WebSocketCore } from "@wcstack/websocket";
import { bind } from "@wc-bindable/core";

const core = new WebSocketCore();

const unbind = bind(core, (name, value) => {
  console.log(`${name}:`, value);
});

core.connect("wss://example.com/ws", {
  autoReconnect: true,
  reconnectInterval: 5000,
});

// Send a message
core.send(JSON.stringify({ type: "ping" }));

// Clean up
core.close();
unbind();
```

This works in Node.js, Deno, Cloudflare Workers — anywhere `EventTarget` and `WebSocket` are available.

## URL Observation

By default, `<wcs-ws>` automatically opens a connection when:

1. it is connected to the DOM and `url` is set
2. the `url` attribute changes while connected to the DOM

Set the `manual` attribute to disable auto-connect and control the connection explicitly via `connect()` or `trigger`.

## Programmatic Usage

```javascript
const wsEl = document.querySelector("wcs-ws");

// Connect manually
wsEl.connect();

// Send data
wsEl.sendMessage(JSON.stringify({ type: "chat", content: "hello" }));

console.log(wsEl.message);    // latest message
console.log(wsEl.connected);  // boolean
console.log(wsEl.loading);    // boolean
console.log(wsEl.error);      // error info or null
console.log(wsEl.readyState); // WebSocket readyState

// Close
wsEl.close();
```

## Optional DOM Triggering

If `autoTrigger` is enabled (default), clicking an element with `data-wstarget` triggers the corresponding `<wcs-ws>` element:

```html
<button data-wstarget="my-ws">Connect</button>
<wcs-ws id="my-ws" url="wss://example.com/ws" manual></wcs-ws>
```

Event delegation is used — works with dynamically added elements. The `closest()` API handles nested elements (e.g., icon inside a button).

If the target id does not match any element, or the matched element is not a `<wcs-ws>`, the click is silently ignored.

This is a convenience feature.
In wcstack applications, **state-driven triggering via `trigger`** is usually the primary pattern.

## Elements

### `<wcs-ws>`

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | `string` | — | WebSocket endpoint URL |
| `protocols` | `string` | — | Comma-separated subprotocol list |
| `manual` | `boolean` | `false` | Disable auto-connect |
| `auto-reconnect` | `boolean` | `false` | Enable automatic reconnection |
| `reconnect-interval` | `number` | `3000` | Reconnection delay in ms |
| `max-reconnects` | `number` | `Infinity` | Maximum reconnection attempts |

| Property | Type | Description |
|----------|------|-------------|
| `message` | `any` | Latest received message (JSON auto-parsed) |
| `connected` | `boolean` | `true` while WebSocket is open |
| `loading` | `boolean` | `true` while connecting |
| `error` | `WcsWsError \| Event \| null` | Error info |
| `readyState` | `number` | WebSocket readyState constant |
| `trigger` | `boolean` | Set to `true` to open connection |
| `send` | `any` | Set to transmit data |

| Method | Description |
|--------|-------------|
| `connect()` | Open the WebSocket connection |
| `sendMessage(data)` | Send data over the connection |
| `close(code?, reason?)` | Close the connection |

## wc-bindable-protocol

Both `WebSocketCore` and `<wcs-ws>` declare `wc-bindable-protocol` compliance, making them interoperable with any framework or component that supports the protocol.

### Core (`WebSocketCore`)

`WebSocketCore` declares the bindable async state that any runtime can subscribe to:

```typescript
static wcBindable = {
  protocol: "wc-bindable",
  version: 1,
  properties: [
    { name: "message",    event: "wcs-ws:message" },
    { name: "connected",  event: "wcs-ws:connected-changed" },
    { name: "loading",    event: "wcs-ws:loading-changed" },
    { name: "error",      event: "wcs-ws:error" },
    { name: "readyState", event: "wcs-ws:readystate-changed" },
  ],
};
```

Headless consumers call `core.connect(url)` directly — no `trigger` needed.

### Shell (`<wcs-ws>`)

The Shell extends the Core declaration with `trigger` and `send` so binding systems can control the connection declaratively:

```typescript
static wcBindable = {
  ...WebSocketCore.wcBindable,
  properties: [
    ...WebSocketCore.wcBindable.properties,
    { name: "trigger", event: "wcs-ws:trigger-changed" },
    { name: "send",    event: "wcs-ws:send-changed" },
  ],
};
```

## TypeScript Types

```typescript
import type {
  WcsWsError, WcsWsCoreValues, WcsWsValues
} from "@wcstack/websocket";
```

```typescript
// WebSocket error
interface WcsWsError {
  code?: number;
  reason?: string;
  message?: string;
}

// Core (headless) — 5 async state properties
// T defaults to unknown; pass a type argument for typed `message`
interface WcsWsCoreValues<T = unknown> {
  message: T;
  connected: boolean;
  loading: boolean;
  error: WcsWsError | Event | null;
  readyState: number;
}

// Shell (<wcs-ws>) — extends Core with trigger and send
interface WcsWsValues<T = unknown> extends WcsWsCoreValues<T> {
  trigger: boolean;
  send: unknown;
}
```

## Why this works well with `@wcstack/state`

`@wcstack/state` uses path strings as the only contract between UI and state.
`<wcs-ws>` fits this model naturally:

- state determines the `url` or fires `trigger`
- `<wcs-ws>` opens and manages the connection
- incoming data arrives as `message`; status as `connected`, `loading`, `error`
- UI binds to those paths without writing WebSocket glue code
- outgoing data flows via the `send` property

This makes real-time communication look like ordinary state updates.

## Framework Integration

Since `<wcs-ws>` is HAWC + `wc-bindable-protocol`, it works with any framework through thin adapters from `@wc-bindable/*`.

### React

```tsx
import { useWcBindable } from "@wc-bindable/react";
import type { WcsWsValues } from "@wcstack/websocket";

interface ChatMessage { type: string; content: string; }

function Chat() {
  const [ref, { message, connected, loading }] =
    useWcBindable<HTMLElement, WcsWsValues<ChatMessage>>();

  return (
    <>
      <wcs-ws ref={ref} url="wss://example.com/ws" auto-reconnect />
      {loading && <p>Connecting...</p>}
      {connected && <p>Connected</p>}
      {message && <pre>{JSON.stringify(message)}</pre>}
    </>
  );
}
```

### Vue

```vue
<script setup lang="ts">
import { useWcBindable } from "@wc-bindable/vue";
import type { WcsWsValues } from "@wcstack/websocket";

interface ChatMessage { type: string; content: string; }

const { ref, values } = useWcBindable<HTMLElement, WcsWsValues<ChatMessage>>();
</script>

<template>
  <wcs-ws :ref="ref" url="wss://example.com/ws" auto-reconnect />
  <p v-if="values.loading">Connecting...</p>
  <p v-else-if="values.connected">Connected</p>
  <pre v-if="values.message">{{ values.message }}</pre>
</template>
```

### Svelte

```svelte
<script>
import { wcBindable } from "@wc-bindable/svelte";

let message = $state(null);
let connected = $state(false);
</script>

<wcs-ws url="wss://example.com/ws" auto-reconnect
  use:wcBindable={{ onUpdate: (name, v) => {
    if (name === "message") message = v;
    if (name === "connected") connected = v;
  }}} />

<p>{connected ? "Connected" : "Disconnected"}</p>
{#if message}
  <pre>{JSON.stringify(message)}</pre>
{/if}
```

### Solid

```tsx
import { createWcBindable } from "@wc-bindable/solid";
import type { WcsWsValues } from "@wcstack/websocket";

interface ChatMessage { type: string; content: string; }

function Chat() {
  const [values, directive] = createWcBindable<WcsWsValues<ChatMessage>>();

  return (
    <>
      <wcs-ws ref={directive} url="wss://example.com/ws" auto-reconnect />
      <Show when={values.connected} fallback={<p>Disconnected</p>}>
        <p>Connected</p>
      </Show>
      <Show when={values.message}>
        <pre>{JSON.stringify(values.message)}</pre>
      </Show>
    </>
  );
}
```

### Vanilla — `bind()` directly

```javascript
import { bind } from "@wc-bindable/core";

const wsEl = document.querySelector("wcs-ws");

bind(wsEl, (name, value) => {
  console.log(`${name} changed:`, value);
});
```

## Configuration

```javascript
import { bootstrapWebSocket } from "@wcstack/websocket";

bootstrapWebSocket({
  autoTrigger: true,
  triggerAttribute: "data-wstarget",
  tagNames: {
    ws: "wcs-ws",
  },
});
```

## Design Notes

- `message`, `connected`, `loading`, `error`, and `readyState` are **output state**
- `url`, `trigger`, and `send` are **input / command surface**
- `trigger` is intentionally one-way: writing `true` connects, reset emits completion
- `send` transmits immediately and resets to `null` — set it each time you want to send
- JSON messages are automatically parsed on receive; objects are auto-stringified on send
- `manual` is useful when connection timing should be controlled explicitly
- Auto-reconnect only fires on abnormal close (code other than 1000)

## License

MIT
