# React + wcstack websocket demo

A framework-interop demo showing `<wcs-ws>` Web Component used inside a React 19 application via the `@wc-bindable/react` adapter.
The server includes a built-in Echo / Broadcast WebSocket endpoint.

## What it demonstrates

**`<wcs-ws>` is a portable IO node.** It encapsulates WebSocket connection management, reconnection, and messaging inside a single, framework-agnostic Custom Element. Previously, using WebSocket in React meant choosing between a React-specific library or the raw WebSocket API. With `<wcs-ws>`, a thin adapter (`@wc-bindable/react`) is all it takes to consume the component as a **state subscription** — a unified pattern regardless of framework. The IO node itself is portable: the same `<wcs-ws>` works in Vue, plain HTML, or any other environment as-is.

### Key highlight: No async code required

WebSocket is inherently asynchronous, yet the application code in this demo contains **no `await`, no `Promise`, no `Suspense`, no `async` functions.**

Typically, using WebSocket in React involves:

- `useEffect` with cleanup functions to manage connection lifecycle
- Subscribing to messages via `addEventListener` or `onmessage` callbacks
- Implementing reconnection logic (timers, backoff, retry limits) by hand
- Reflecting connection state in the UI with `Suspense` or loading state

`<wcs-ws>` **encapsulates all of this inside the Web Component.** From the application's perspective, the async nature of WebSocket is completely hidden — all you do is read **synchronous properties** like `ws.connected` and `ws.message`.

```jsx
// This is all it takes to sync WebSocket state into React state
const [wsRef, ws] = useWcBindable({
  message: null,
  connected: false,
  loading: false,
  error: null,
});

// In JSX, just read synchronous values
<p>{ws.connected ? "Connected" : "Disconnected"}</p>
<p>{ws.message?.content}</p>
```

In other words, `<wcs-ws>` transforms the asynchronous WebSocket into **a state machine subscription**. Instead of dealing with an async event stream, the application simply subscribes to properties exposed by the state machine. The async complexity is absorbed by `<wcs-ws>`, and the React application **focuses solely on displaying synchronous values.**

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
# 1. Install shared WebSocket server dependencies
cd examples/shared/websocket && npm install && cd ../../..

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
