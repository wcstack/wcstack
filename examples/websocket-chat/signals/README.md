# signals + websocket demo

The [websocket-chat](../README.md) scenario on `@wcstack/signals`: fine-grained
signals driving real DOM, with the same IO logic underneath — consumed as
**`WebSocketCore` directly**, no element at all.

Every other variant binds the `<wcs-ws>` element; this one imports the Core
class that element wraps and hands it straight to `bindNode()` (Cores are
`EventTarget`s carrying the same wc-bindable descriptor — a normative surface,
see [async-io-node-guidelines §3.9](../../../docs/async-io-node-guidelines.md)).
Because no custom element is involved, there is no `customElements` registry,
no upgrade, and no definition timing to manage: the import is the only
dependency. `bindNode()` adapts the Core's outputs (`connected` / `loading` /
`error` / `message`) into read signals, an `effect()` routes incoming messages
into a keyed log rendered by `For()`, and `core.connect(url, options)` starts
the socket (auto-reconnect included — connection management and JSON parsing
live in the Core, exactly as in the element variants). Fully buildless —
everything is imported from the CDN.

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

- **Core-direct binding**: `bindNode(new WebSocketCore())` — the wc-bindable IO
  node consumed with no element and no `customElements` registry
- manual Core lifecycle: `core.connect(url, { autoReconnect, … })` replaces the
  element variants' `url` attribute (the reconnect policy moves into options)
- `effect()` routing a message stream into view state (log vs stats heartbeat)
- keyed list rendering with `For()` (log rows are never rebuilt)
- sending via the Core's `send()` command (never-throw: sending while
  disconnected lands on the `error` signal)
