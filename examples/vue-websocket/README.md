# Vue + wcstack websocket demo

A framework-interop demo showing `<wcs-ws>` Web Component used inside a Vue 3 application via the `@wc-bindable/vue` adapter.
The server includes a built-in Echo / Broadcast WebSocket endpoint.

## What it demonstrates

**Web Components work in any framework.** The `<wcs-ws>` custom element implements the [wc-bindable protocol](https://github.com/user/wc-bindable-protocol). The `@wc-bindable/vue` adapter provides a `useWcBindable()` composable that automatically syncs all bindable properties into Vue reactive state — no manual `addEventListener` needed.

## What it uses

- Vue 3 (ESM via esm.sh, no build step)
- `@wc-bindable/vue` adapter
- `/packages/websocket/dist/auto.js`

## Setup

```bash
# 1. Build the websocket package
cd packages/websocket && npm run build && cd ../..

# 2. Install server dependencies
cd examples/vue-websocket && npm install && cd ../..

# 3. Start the demo server
node examples/vue-websocket/server.js
```

Open `http://localhost:3302`.
Open multiple tabs to see broadcast in action.

## Environment variables

- `PORT`: optional, defaults to `3302`

## How Vue uses `<wcs-ws>` via @wc-bindable

```js
import { useWcBindable } from "@wc-bindable/vue";

setup() {
  // All wc-bindable properties are automatically synced
  const { ref: wsEl, values: ws } = useWcBindable({
    message: null,
    connected: false,
    loading: false,
    error: null,
  });

  // ws.connected, ws.message, etc. are live Vue reactive state
  return { wsEl, ws };
}
```

```html
<wcs-ws ref="wsEl" url="ws://..." auto-reconnect />
<p>Status: {{ ws.connected ? 'Connected' : 'Disconnected' }}</p>
```

## WebSocket protocol

Same as the [state-websocket example](../state-websocket/README.md#websocket-protocol).

## What the demo shows

- `<wcs-ws>` used directly in Vue templates
- Automatic property sync via `useWcBindable()` — no manual event listeners
- Sending messages via the `send` property setter
- `auto-reconnect` for automatic reconnection
- Real-time client count and server uptime display
- Fully ESM, buildless (Import Maps + esm.sh)
