# React + wcstack websocket demo

A framework-interop demo showing `<wcs-ws>` Web Component used inside a React 19 application via the `@wc-bindable/react` adapter.
The server includes a built-in Echo / Broadcast WebSocket endpoint.

## What it demonstrates

**Web Components work in any framework.** The `<wcs-ws>` custom element implements the [wc-bindable protocol](https://github.com/user/wc-bindable-protocol). The `@wc-bindable/react` adapter provides a `useWcBindable()` hook that automatically syncs all bindable properties into React state — no manual `addEventListener` needed.

## Stack

| Layer | Technology |
|-------|-----------|
| UI | React 19 + JSX |
| Build | Vite |
| Adapter | `@wc-bindable/react` |
| WebSocket | `@wcstack/websocket` (`<wcs-ws>`) |
| Server | Node.js + ws |

## Setup

```bash
# 1. Build the websocket package
cd packages/websocket && npm run build && cd ../..

# 2. Install dependencies & build
cd examples/react-websocket && npm install && npm run build && cd ../..

# 3. Start the server
node examples/react-websocket/server.js
```

Open `http://localhost:3301`.
Open multiple tabs to see broadcast in action.

### Development mode

```bash
cd examples/react-websocket
npm run dev
```

Vite dev server starts with HMR. WebSocket server must be started separately.

## Environment variables

- `PORT`: optional, defaults to `3301`

## How React uses `<wcs-ws>` via @wc-bindable

```jsx
import { useWcBindable } from "@wc-bindable/react";

function App() {
  const [wsRef, ws] = useWcBindable({
    message: null,
    connected: false,
    loading: false,
    error: null,
  });

  return (
    <>
      <wcs-ws ref={wsRef} url="ws://..." auto-reconnect="" />
      <p>Status: {ws.connected ? "Connected" : "Disconnected"}</p>
    </>
  );
}
```

## WebSocket protocol

Same as the [state-websocket example](../state-websocket/README.md#websocket-protocol).

## What the demo shows

- `<wcs-ws>` rendered inside a React component tree
- Automatic property sync via `useWcBindable()` — no manual event listeners
- Sending messages via the `send` property setter
- `auto-reconnect` for automatic reconnection
- Real-time client count and server uptime display
- Standard Vite build pipeline (JSX, bundling, minification)
