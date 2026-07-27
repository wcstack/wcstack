# vanilla + websocket demo

The framework-free baseline of the [websocket-chat](../README.md) scenario:
plain JavaScript and hand-built DOM on top of the same IO logic — consumed as
**`WebSocketCore` directly**, no element at all.

`bind()` only requires the consumer-side `EventTarget` surface plus a
`constructor.wcBindable` declaration, and a wcstack Core is exactly that
(a normative surface — see
[async-io-node-guidelines §3.9](../../../docs/async-io-node-guidelines.md)),
so the adapter binds the headless Core as a first-class target: no custom
element, no `customElements` registry, no definition timing. `bind()` streams
the Core's wcBindable outputs (`connected` / `loading` / `error` / `message`)
into a small view-state object, `core.connect(url, options)` starts the socket
(auto-reconnect included), and sending goes through the Core's `send()`
command. No engine, no build step — the whole app is one
`<script type="module">`.

## What it uses

- `@wcstack/websocket` via CDN (`esm.run`)
- `@wc-bindable/core` via CDN import map

## Setup

```bash
# 1. Install shared WebSocket server dependencies (once per checkout)
cd examples/websocket-chat/shared && npm install && cd ../../..

# 2. Start the demo server
node examples/websocket-chat/vanilla/server.js
```

Open `http://localhost:3304`.
Open multiple tabs (any variant) to see broadcast in action.

## Environment variables

- `PORT`: optional, defaults to `3304`

## WebSocket protocol

Same as the [state variant](../state/README.md#websocket-protocol).

## What the demo shows

- the portable IO node consumed WITHOUT any reactive engine — and without the
  element: `bind(new WebSocketCore(), …)` binds the headless Core directly
- `bind()` as the minimal wc-bindable consumer (mirror properties → render),
  demonstrating that the protocol only needs the `EventTarget` surface
- manual Core lifecycle: `core.connect(url, { autoReconnect, … })` replaces the
  element variants' attributes; sending via the Core's `send()` command
- `auto-reconnect` handled entirely inside the Core
