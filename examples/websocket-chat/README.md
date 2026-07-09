# websocket-chat — one scenario, five stacks

The same real-time Echo / Broadcast chat, built five ways on top of the same
`<wcs-ws>` IO node and the same WebSocket server. The point: **the IO node is
portable** — connection management, auto-reconnect and JSON parsing live inside
the custom element, and each stack only decides how to *render* its state.

| Variant | Stack | Port | Build |
|---------|-------|------|-------|
| [`vanilla/`](vanilla/) | Plain JS + `@wc-bindable/core` `bind()` | 3304 | none (CDN) |
| [`state/`](state/) | `@wcstack/state` (`data-wcs` binding) | 3300 | none (CDN) |
| [`signals/`](signals/) | `@wcstack/signals` (`bindNode()` + `h()`/`For()`) | 3305 | none (CDN) |
| [`react/`](react/) | React 19 + `@wc-bindable/react` | 3301 | Vite |
| [`vue/`](vue/) | Vue 3 + native custom-element binding | 3302 | Vite |

`shared/` holds the demo server (static files + `/ws` endpoint), the `ws`
dependency and the common stylesheet. When copying a single variant out of this
repo, take `shared/` along with it.

## Setup

```bash
# 1. Install the shared WebSocket server dependency (once)
cd examples/websocket-chat/shared && npm install && cd ../../..

# 2. Start a buildless variant (vanilla / state / signals)
node examples/websocket-chat/state/server.js     # http://localhost:3300
node examples/websocket-chat/vanilla/server.js   # http://localhost:3304
node examples/websocket-chat/signals/server.js   # http://localhost:3305

# 3. React / Vue need an install + build first
cd examples/websocket-chat/react && npm install && npm run build && node server.js  # http://localhost:3301
cd examples/websocket-chat/vue   && npm install && npm run build && node server.js  # http://localhost:3302
```

Every variant speaks the same protocol, so you can open different variants in
different tabs and broadcast between them. See the
[state variant's README](state/README.md#websocket-protocol) for the message
protocol.
