# vanilla + websocket demo

The framework-free baseline of the [websocket-chat](../README.md) scenario:
plain JavaScript and hand-built DOM on top of the same headless `<wcs-ws>` node.

`@wc-bindable/core`'s `bind()` streams the element's wcBindable outputs
(`connected` / `loading` / `error` / `message`) into a small view-state object,
and sending goes through the element's public `sendMessage()` command. No
engine, no build step — the whole app is one `<script type="module">`.

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

- `<wcs-ws>` as a portable IO node consumed WITHOUT any reactive engine
- `bind()` as the minimal wc-bindable consumer (mirror properties → render)
- sending via the `sendMessage()` command method
- `auto-reconnect` handled entirely inside the element
