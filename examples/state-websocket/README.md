# state + websocket demo

A local demo combining `@wcstack/state` and `@wcstack/websocket` for real-time communication.
The server includes a built-in Echo / Broadcast WebSocket endpoint.

## What it uses

- `/packages/state/dist/auto.js`
- `/packages/websocket/dist/auto.js`

## Setup

```bash
# 1. Build the packages used by the demo
cd packages/state && npm run build && cd ../..
cd packages/websocket && npm run build && cd ../..

# 2. Install server dependencies
cd examples/state-websocket && npm install && cd ../..

# 3. Start the demo server
node examples/state-websocket/server.js
```

Open `http://localhost:3300`.
Open multiple tabs to see broadcast in action.

## Environment variables

- `PORT`: optional, defaults to `3300`

## WebSocket protocol

The server accepts WebSocket connections at `/ws`.

### Client → Server

```json
{ "type": "echo", "content": "text to echo" }
{ "type": "broadcast", "content": "text to broadcast", "from": "nickname" }
```

### Server → Client

| type | Description |
|------|-------------|
| `echo` | Echo response. `{ content, timestamp }` |
| `broadcast` | Delivered to all clients. `{ content, from, timestamp }` |
| `stats` | Every 3 seconds. `{ clients, uptime }` |

## What the demo shows

- `message`, `connected`, `loading`, and `error` bound from `<wcs-ws>` into `<wcs-state>`
- sending messages via the `send` property from state
- `auto-reconnect` for automatic reconnection
- automatic JSON parsing of incoming messages
- conditional rendering by message type (`for:` + `if:` + `eq` filter)
- real-time client count and server uptime display
