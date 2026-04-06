# Vue + wcstack websocket demo

A framework-interop demo showing `<wcs-ws>` Web Component used inside a Vue 3 application via the `@wc-bindable/vue` adapter.
The server includes a built-in Echo / Broadcast WebSocket endpoint.

## What it demonstrates

**Web Components work in any framework.** The `<wcs-ws>` custom element implements the [wc-bindable protocol](https://github.com/user/wc-bindable-protocol). The `@wc-bindable/vue` adapter provides a `useWcBindable()` composable that automatically syncs all bindable properties into Vue reactive state — no manual `addEventListener` needed.

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
