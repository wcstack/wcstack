# Vue + wcstack websocket demo

A framework-interop demo showing `<wcs-ws>` Web Component used inside a Vue 3 application via the `@wc-bindable/vue` adapter.
The server includes a built-in Echo / Broadcast WebSocket endpoint.

## What it demonstrates

**`<wcs-ws>` is a portable IO node.** It encapsulates WebSocket connection management, reconnection, and messaging inside a single, framework-agnostic Custom Element. Previously, using WebSocket in Vue meant choosing between a Vue-specific library or the raw WebSocket API. With `<wcs-ws>`, a thin adapter (`@wc-bindable/vue`) is all it takes to consume the component as a **state subscription** — a unified pattern regardless of framework. The IO node itself is portable: the same `<wcs-ws>` works in React, plain HTML, or any other environment as-is.

### Key highlight: No async code required

WebSocket is inherently asynchronous, yet the application code in this demo contains **no `await`, no `Promise`, no `Suspense`, no `async` functions.**

Typically, using WebSocket in Vue involves:

- Managing connection lifecycle in `onMounted` / `onUnmounted` hooks
- Subscribing to messages via `addEventListener` or `onmessage` callbacks
- Implementing reconnection logic (timers, backoff, retry limits) by hand
- Reflecting connection state in the UI with `Suspense` or loading state

`<wcs-ws>` **encapsulates all of this inside the Web Component.** From the application's perspective, the async nature of WebSocket is completely hidden — all you do is read **synchronous reactive properties** like `ws.connected` and `ws.message`.

```vue
<script setup>
// This is all it takes to sync WebSocket state into Vue reactive state
const { ref: wsEl, values: ws } = useWcBindable({
  message: null,
  connected: false,
  loading: false,
  error: null,
});
</script>

<template>
  <!-- In the template, just read synchronous values -->
  <p>{{ ws.connected ? 'Connected' : 'Disconnected' }}</p>
  <p>{{ ws.message?.content }}</p>
</template>
```

In other words, `<wcs-ws>` transforms the asynchronous WebSocket into **a state machine subscription**. Instead of dealing with an async event stream, the application simply subscribes to properties exposed by the state machine. The async complexity is absorbed by `<wcs-ws>`, and the Vue application **focuses solely on displaying synchronous values.**

## Stack

| Layer | Technology |
|-------|-----------|
| UI | Vue 3 + SFC (`<script setup>`) |
| Build | Vite |
| Adapter | `@wc-bindable/vue` |
| WebSocket | `@wcstack/websocket` (`<wcs-ws>`) |
| Server | Node.js + ws |

## Setup

```bash
# 1. Build the websocket package
cd packages/websocket && npm run build && cd ../..

# 2. Install dependencies & build
cd examples/vue-websocket && npm install && npm run build && cd ../..

# 3. Start the server
node examples/vue-websocket/server.js
```

Open `http://localhost:3302`.
Open multiple tabs to see broadcast in action.

### Development mode

```bash
cd examples/vue-websocket
npm run dev
```

Vite dev server starts with HMR. WebSocket server must be started separately.

## Environment variables

- `PORT`: optional, defaults to `3302`

## How Vue uses `<wcs-ws>` via @wc-bindable

```vue
<script setup>
import { useWcBindable } from "@wc-bindable/vue";

const { ref: wsEl, values: ws } = useWcBindable({
  message: null,
  connected: false,
  loading: false,
  error: null,
});
</script>

<template>
  <wcs-ws ref="wsEl" url="ws://..." auto-reconnect />
  <p>Status: {{ ws.connected ? 'Connected' : 'Disconnected' }}</p>
</template>
```

## WebSocket protocol

Same as the [state-websocket example](../state-websocket/README.md#websocket-protocol).

## What the demo shows

- `<wcs-ws>` used directly in Vue SFC templates
- Automatic property sync via `useWcBindable()` — no manual event listeners
- Sending messages via the `send` property setter
- `auto-reconnect` for automatic reconnection
- Real-time client count and server uptime display
- Standard Vite + Vue build pipeline (SFC, bundling, minification)
