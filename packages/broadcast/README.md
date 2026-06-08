# @wcstack/broadcast

`@wcstack/broadcast` is a headless cross-tab messaging component for the wcstack ecosystem.

It is not a visual UI widget.
It is an **async primitive node** that turns same-origin cross-context messaging into reactive state — the same way `@wcstack/fetch` turns a network request into reactive state and `@wcstack/websocket` turns a socket into reactive state.

`<wcs-broadcast>` is the showcase for the wc-bindable token protocol crossing a **context boundary**. A BroadcastChannel delivers every post to every other same-origin context (tab, iframe, worker) on the same channel name — but never to the sender itself. So the two directions of the token protocol only close the loop *across* tabs:

- **post** (`state → element`) via the command-token protocol — `command.post: $command.send`
- **message** (`element → state`) via the event-token protocol — `eventToken.message: onMessage`

With `@wcstack/state`, `<wcs-broadcast>` can be bound directly through path contracts:

- **input surface**: `name`, `manual`
- **command surface**: `open`, `post`, `close`
- **output state surface**: `message`, `error`

This means cross-tab synchronization can be expressed declaratively in HTML, without writing `new BroadcastChannel()`, `postMessage()`, `onmessage` listeners, or teardown glue in your UI layer.

`@wcstack/broadcast` follows the [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md) (Core / Shell / Binding Contract) architecture:

- **Core** (`BroadcastCore`) handles channel lifecycle, posting, structured-clone receipt, and error handling
- **Shell** (`<wcs-broadcast>`) connects that state to DOM attributes, lifecycle, and declarative commands
- **Binding Contract** (`static wcBindable`) declares observable `properties`, writable `inputs`, and callable `commands`

## Why this exists

The BroadcastChannel API is, like `fetch` or `WebSocket`, an asynchronous source of values — but it is **self-excluding**: a context never receives its own posts. Imperatively it requires constructing the channel, wiring `message` / `messageerror` listeners, and closing on teardown.

`@wcstack/broadcast` moves that logic into a reusable component and exposes the result as bindable state. A cross-tab notification becomes a **state transition**, not imperative callback wiring.

> **Self-exclusion — open the page in two tabs.** Because a context never hears its own posts, a single `<wcs-broadcast>` in one tab will not see its own `post` reflected back into `message`. The round trip only closes when **another** context (another tab, or another `<wcs-broadcast>` on the same channel name) is listening. Demos in this README assume the page is open in two tabs.

> **Same-origin only, structured clone.** BroadcastChannel works within one origin. Payloads ride the browser's structured clone, so objects pass through as-is — there is **no JSON round-trip** and no need to stringify. A non-cloneable payload (a function, a DOM node) surfaces a `DataCloneError` through the `error` property rather than throwing.

## Install

```bash
npm install @wcstack/broadcast
```

## Quick Start

### 1. Send a message (post)

Drive a post from a DOM click (autoTrigger) or a command-token.

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/broadcast/auto"></script>

<wcs-broadcast id="bc" name="room"></wcs-broadcast>

<!-- Optional DOM triggering: click posts the literal text -->
<input id="msg" value="hello" />
<button data-broadcast-target="bc" data-broadcast-from="#msg">Send</button>
<button data-broadcast-target="bc" data-broadcast-text="ping">Ping</button>
```

`data-broadcast-text` posts a literal string; `data-broadcast-from` posts the `value` (or `textContent`) of the element matched by the selector.

### 2. Cross-tab counter (command-token + event-token)

The duality in one element: `post` is wired from a command-token, and an incoming `message` is received via an event-token. Open this in two tabs and click "Bump" — each tab's count stays in sync.

```html
<wcs-state>
  <script type="module">
    export default {
      count: 0,
      $commandTokens: ["send"],
      $eventTokens: ["onMessage"],
      bump() {
        this.count = this.count + 1;
        this.$command.send.emit(this.count);   // state → element → other tabs
      },
      $on: {
        onMessage: (state, event) => {          // other tabs → element → state
          state.count = event.detail;
        }
      }
    };
  </script>
</wcs-state>

<wcs-broadcast name="counter" data-wcs="
  command.post:       $command.send;
  eventToken.message: onMessage
"></wcs-broadcast>

<button data-wcs="onclick: bump">Bump</button>
<p data-wcs="textContent: count"></p>
```

### 3. Mirror a received value into state

You do not need the event-token to *read* the latest message — bind `message` directly.

```html
<wcs-state>
  <script type="module">
    export default { incoming: null };
  </script>
</wcs-state>

<wcs-broadcast name="room" data-wcs="message: incoming"></wcs-broadcast>
<p data-wcs="textContent: incoming"></p>
```

## Attributes / Inputs

| Attribute | Type    | Default | Description                                                                  |
| --------- | ------- | ------- | ---------------------------------------------------------------------------- |
| `name`    | string  | `""`    | The channel name to join. Changing it re-opens on the new channel.           |
| `manual`  | boolean | `false` | Do not open the channel automatically on connect or on `name` change. Call `open()` instead. Evaluated at connect time and on each `name` change; it is **not** in `observedAttributes`, so toggling `manual` on an already-connected element has no immediate effect (it only changes how the *next* connect or `name` change behaves). |

### DOM trigger attributes (autoTrigger, post-on-click)

| Attribute               | On             | Description                                                              |
| ----------------------- | -------------- | ----------------------------------------------------------------------- |
| `data-broadcast-target` | trigger button | Id of the `<wcs-broadcast>` to drive.                                   |
| `data-broadcast-text`   | trigger button | Literal text to post (takes precedence; empty string is valid).         |
| `data-broadcast-from`   | trigger button | CSS selector; posts the matched element's `value` (or `textContent`).   |

> A DOM-triggered `post` is fire-and-forget; it never rejects. A failed post (e.g. a non-cloneable payload — not possible from a DOM trigger, which only posts strings) surfaces through the `error` property.

## Observable Properties (outputs)

| Property  | Event                    | Description                                                                          |
| --------- | ------------------------ | ------------------------------------------------------------------------------------ |
| `message` | `wcs-broadcast:message`  | The last value received from another context on the channel (structured-clone copy). Never set by this context's own posts. |
| `error`   | `wcs-broadcast:error`    | Normalized `{ name, message }` — `DataCloneError` (non-cloneable post), `DataError` (a peer's message could not be deserialized), `InvalidStateError` (post with no open channel), or `NotSupportedError` (BroadcastChannel unavailable). |

## Commands

| Command | Description                                                                              |
| ------- | --------------------------------------------------------------------------------------- |
| `open`  | Join the channel named by the `name` attribute (closes any previously-open channel).    |
| `post`  | Post a structured-cloneable value to every other context (never rejects — failures go to `error`). |
| `close` | Leave the channel (idempotent).                                                         |

State-driven invocation uses the command-token protocol:

```html
<wcs-broadcast name="room" data-wcs="command.post: $command.send"></wcs-broadcast>
```

## Notes & limitations

- **Self-exclusion is intentional.** A context never receives its own posts — this is the BroadcastChannel contract, not a bug. To see a round trip, have a second context (tab/iframe/worker, or a second `<wcs-broadcast>` on the same channel name) listening. Two `<wcs-broadcast name="x">` elements in the *same* tab do hear each other (they are distinct channel objects); only a single element talking to itself does not.
- **`name` is observed.** Unlike `<wcs-clipboard>`, `<wcs-broadcast>` implements `observedAttributes` for `name`: changing the `name` attribute while connected (and not `manual`) closes the old channel and opens the new one. Clearing the `name` (setting it to an empty string or removing the attribute) is *not* a close: the previously-open channel is kept until you switch to another `name` or call `close()` explicitly. Only a non-empty new value triggers the switch.
- **No wire encoding.** Payloads use structured clone, so there is no JSON stringify/parse step (unlike `<wcs-ws>`, which sends over a text wire). Post objects directly; receivers get a deep copy. Non-cloneable values fail with `DataCloneError` via `error`.
- **No connection state.** A BroadcastChannel is "open" the moment it is constructed — there is no connecting/handshake phase, no `readyState`, and no reconnect (none is needed). The Shell opens synchronously on connect, so there is no `connectedCallbackPromise` / SSR snapshot.
- **Reconnect re-opens.** Removing and re-inserting the element runs `connectedCallback` again, re-opening the channel from the `name` attribute (the source of truth), and `disconnectedCallback` closes it.
- **Silent failure handling (zero-log).** Consistent with the rest of wcstack's zero-dependency philosophy, `<wcs-broadcast>` never logs or throws for runtime failures. A missing BroadcastChannel constructor, a non-cloneable post, or a deserialization failure are surfaced only through the `error` property / `wcs-broadcast:error` event — `post()` resolves and never rejects. Bind `error` to observe and react.

## Headless usage (`BroadcastCore`)

The Core has no DOM dependency beyond the global `BroadcastChannel` and can be used directly with `bind()` from `@wc-bindable/core`:

```typescript
import { BroadcastCore } from "@wcstack/broadcast";

const bus = new BroadcastCore();
bus.addEventListener("wcs-broadcast:message", (e) => {
  console.log((e as CustomEvent).detail); // the received value
});

bus.open("room");
bus.post({ type: "hello", at: Date.now() });
// ...later
bus.close();
```

## License

MIT
