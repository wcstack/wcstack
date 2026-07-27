# websocket-chat — one scenario, five stacks

The same real-time Echo / Broadcast chat, built five ways on top of the same
IO logic and the same WebSocket server. The point: **the IO node is portable**
— connection management, auto-reconnect and JSON parsing live inside
`WebSocketCore`, and each stack only decides how to *consume* it: four variants
bind the `<wcs-ws>` element that wraps it (declaratively with `data-wcs`, or
via a `@wc-bindable` adapter), while the signals variant consumes the Core
class directly — no element at all.

| Variant | Stack | Consumes | Port | Build |
|---------|-------|----------|------|-------|
| [`vanilla/`](vanilla/) | Plain JS + `@wc-bindable/core` `bind()` | `<wcs-ws>` element | 3304 | none (CDN) |
| [`state/`](state/) | `@wcstack/state` (`data-wcs` binding) | `<wcs-ws>` element | 3300 | none (CDN) |
| [`signals/`](signals/) | `@wcstack/signals` (`bindNode()` + `h()`/`For()`) | `WebSocketCore` directly | 3305 | none (CDN) |
| [`react/`](react/) | React 19 + `@wc-bindable/react` | `<wcs-ws>` element | 3301 | Vite |
| [`vue/`](vue/) | Vue 3 + `@wc-bindable/vue` | `<wcs-ws>` element | 3302 | Vite |

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
