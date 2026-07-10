# signals + websocket demo

The [websocket-chat](../README.md) scenario on `@wcstack/signals`: fine-grained
signals driving real DOM, with the same headless `<wcs-ws>` node underneath.

`bindNode()` adapts the element's wcBindable outputs (`connected` / `loading` /
`error` / `message`) into read signals, an `effect()` routes incoming messages
into a keyed log rendered by `For()`, and the `url` input is written reactively
with `bindInput()`. Fully buildless — everything is imported from the CDN.

## What it uses

- `@wcstack/websocket` via CDN (`esm.run`)
- `@wcstack/signals/dom` via CDN import map (re-exports the headless core)

## Setup

```bash
# 1. Install shared WebSocket server dependencies (once per checkout)
cd examples/websocket-chat/shared && npm install && cd ../../..

# 2. Start the demo server
node examples/websocket-chat/signals/server.js
```

Open `http://localhost:3305`.
Open multiple tabs (any variant) to see broadcast in action.

## Environment variables

- `PORT`: optional, defaults to `3305`

## WebSocket protocol

Same as the [state variant](../state/README.md#websocket-protocol).

## What the demo shows

- `bindNode()` adapting a wc-bindable IO node into signals
- `effect()` routing a message stream into view state (log vs stats heartbeat)
- keyed list rendering with `For()` (log rows are never rebuilt)
- reactive input writing with `bindInput()` (`url` starts the connection)
- sending via the `sendMessage()` command method
