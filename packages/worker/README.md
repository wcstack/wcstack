# @wcstack/worker

`@wcstack/worker` is a headless Web Worker component for the wcstack ecosystem.

It is not a visual UI widget.
It is an **async primitive node** that turns a Dedicated Worker into reactive state — the same way `@wcstack/fetch` turns a network request into reactive state and `@wcstack/websocket` turns a socket into reactive state.

`<wcs-worker>` owns a background thread and exposes its message-passing surface through the wc-bindable token protocol:

- **post** (`state → element`) via the command-token protocol — `command.post: $command.run`
- **message** (`element → state`) via the event-token protocol — `eventToken.message: onResult`

With `@wcstack/state`, `<wcs-worker>` can be bound directly through path contracts:

- **input surface**: `src`, `type`, `name`, `manual`, `keep-alive`, `restart-on-error`, `max-restarts`, `restart-interval`
- **command surface**: `start`, `post`, `terminate`
- **output state surface**: `message`, `error`, `errorInfo`, `running`

This means offloading work to a worker thread can be expressed declaratively in HTML, without writing `new Worker()`, `postMessage()`, `onmessage` listeners, or teardown glue in your UI layer.

`@wcstack/worker` follows the [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md) (Core / Shell / Binding Contract) architecture:

- **Core** (`WorkerCore`) owns the worker lifecycle, posting, structured-clone receipt, error handling, and opt-in restart-on-error
- **Shell** (`<wcs-worker>`) connects that state to DOM attributes, lifecycle, and declarative commands
- **Binding Contract** (`static wcBindable`) declares observable `properties`, writable `inputs`, and callable `commands`

## Why this exists

A Worker is, like `fetch` or `WebSocket`, an asynchronous source of values — but it also **owns a resource** (a background thread). Imperatively it requires constructing the worker, wiring `message` / `messageerror` / `error` listeners, and terminating on teardown.

`@wcstack/worker` moves that logic into a reusable component and exposes the result as bindable state. A computed result coming back from a worker becomes a **state transition**, not imperative callback wiring.

> **Bus-style, not RPC.** `post` is fire-and-forget and results arrive on `message`; there is no built-in request/response correlation. If you need to match a reply to a specific request, include a correlation id in your payload and have the worker echo it back (or await `message` for the next value when only one request is in flight).

> **Structured clone, no JSON round-trip.** Payloads ride the browser's structured clone (symmetrical with `@wcstack/broadcast`, deliberately unlike `<wcs-ws>` which sends over a text wire). Post objects directly; the worker receives a copy. A non-cloneable payload (a function, a DOM node) surfaces a `DataCloneError` through the `error` property rather than throwing.

> **ESM by default.** The worker is created with `{ type: "module" }` unless you set `type="classic"`.

## Install

```bash
npm install @wcstack/worker
```

## Quick Start

### 1. Run a job and read the result

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/worker/auto"></script>

<wcs-state>
  <script type="module">
    export default { result: null };
  </script>
</wcs-state>

<wcs-worker id="job" src="./compute.js" data-wcs="message: result"></wcs-worker>

<!-- Optional DOM triggering: click posts the resolved text to the worker -->
<input id="n" value="42" />
<button data-worker-target="job" data-worker-from="#n">Run</button>

<p data-wcs="textContent: result"></p>
```

`data-worker-text` posts a literal string; `data-worker-from` posts the `value` (or `textContent`) of the element matched by the selector.

### 2. post (command-token) + result (event-token)

The duality in one element: `post` is wired from a command-token, and an incoming `message` is received via an event-token.

```html
<wcs-state>
  <script type="module">
    export default {
      input: 10,
      output: null,
      $commandTokens: ["run"],
      $eventTokens: ["onResult"],
      compute() {
        this.$command.run.emit(this.input);   // state → worker
      },
      $on: {
        onResult: (state, event) => {          // worker → state
          state.output = event.detail;
        }
      }
    };
  </script>
</wcs-state>

<wcs-worker src="./compute.js" data-wcs="
  command.post:       $command.run;
  eventToken.message: onResult
"></wcs-worker>

<button data-wcs="onclick: compute">Compute</button>
<p data-wcs="textContent: output"></p>
```

## Attributes / Inputs

| Attribute          | Type    | Default    | Description                                                                 |
| ------------------ | ------- | ---------- | --------------------------------------------------------------------------- |
| `src`              | string  | `""`       | The worker script URL. Changing it terminates the old worker and spawns the new script. |
| `type`             | string  | `"module"` | `"module"` (ESM) or `"classic"`.                                            |
| `name`             | string  | `""`       | Optional worker name, passed to the `Worker` constructor `name` option (aids DevTools / error identification). Applied at spawn time — see the note on `type` below. |
| `manual`           | boolean | `false`    | Do not spawn automatically on connect or on `src` change. Call `start()` instead. |
| `keep-alive`       | boolean | `false`    | Do **not** terminate the worker on disconnect — it outlives the element. Ownership transfers to you: call `terminate()` to free the thread. |
| `restart-on-error` | boolean | `false`    | Re-spawn a fresh worker after an uncaught error inside the worker script.    |
| `max-restarts`     | number  | `Infinity` | Upper bound on the **cumulative** number of automatic restarts over the worker's lifetime (not consecutive crashes — the counter is not reset by a stable run). Reset only by a fresh `start()` / `src` change. |
| `restart-interval` | number  | `0`        | Delay in ms before an automatic restart.                                     |

### DOM trigger attributes (autoTrigger, post-on-click)

| Attribute            | On             | Description                                                            |
| -------------------- | -------------- | --------------------------------------------------------------------- |
| `data-worker-target` | trigger button | Id of the `<wcs-worker>` to drive.                                    |
| `data-worker-text`   | trigger button | Literal text to post (takes precedence; empty string is valid).       |
| `data-worker-from`   | trigger button | CSS selector; posts the matched element's `value` (or `textContent`). |

The DOM trigger **always posts a string** — the literal `data-worker-text`, or the resolved element's `value` / `textContent`. It is a convenience for simple text payloads and intentionally does not parse, coerce, or structure the value. To send structured-clone data (objects, typed arrays, transferables), drive `post` via the command-token protocol (`command.post: $command.run`) or call `element.post(data, transfer?)` imperatively.

> **autoTrigger is on by default.** The first `<wcs-worker>` to connect installs a single **document-level `click` listener** (a click on a `data-worker-target` element posts to the referenced worker, calling `event.preventDefault()`). If you don't use the DOM shortcut, opt out via the bootstrap entry:
>
> ```js
> import { bootstrapWorker, getConfig } from "@wcstack/worker";
> bootstrapWorker({ autoTrigger: false });      // no document click listener
> bootstrapWorker({ triggerAttribute: "data-run" }); // rename the trigger attribute (default: data-worker-target)
> getConfig();                                   // read the effective (deep-frozen) config
> ```
>
> Call `bootstrapWorker()` before the elements connect. (`setConfig` is internal; configure through `bootstrapWorker`.)

## Observable Properties (outputs)

| Property  | Event                         | Description                                                                          |
| --------- | ----------------------------- | ------------------------------------------------------------------------------------ |
| `message` | `wcs-worker:message`          | The last value posted back by the worker (structured-clone copy). Re-fires on every message, even when the value is unchanged. |
| `error`   | `wcs-worker:error`            | Normalized `{ name, message, filename?, lineno?, colno? }` — `DataCloneError` (non-cloneable post), `DataError` (a worker message could not be deserialized), `InvalidStateError` (post with no running worker), a script `Error` (uncaught error in the worker, with location), or a spawn failure (bad URL / CSP / unsupported). |
| `errorInfo` | `wcs-worker:error-info-changed` | Serializable failure taxonomy `WcsIoErrorInfo \| null` (stable `code` / `phase` / `recoverable`), derived from the same failure as `error`. Additive — the `error` shape is unchanged. |
| `running` | `wcs-worker:running-changed`  | `true` while a worker is spawned and not yet terminated.                              |

## Commands

| Command     | Description                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------- |
| `start`     | Spawn the worker from the `src` attribute (terminates any previously-spawned worker; idempotent on the same `src`). |
| `post`      | Post a structured-cloneable value to the worker (never rejects — failures go to `error`). The headless `WorkerCore.post(data, transfer?)` also accepts a transfer list. |
| `terminate` | Terminate the worker (idempotent).                                                          |

State-driven invocation uses the command-token protocol:

```html
<wcs-worker src="./compute.js" data-wcs="command.post: $command.run"></wcs-worker>
```

## CSS styling with `:state()`

`<wcs-worker>` reflects two boolean output states onto its
[`ElementInternals` `CustomStateSet`](https://developer.mozilla.org/en-US/docs/Web/API/CustomStateSet),
so you can style it directly from CSS with the `:state()` pseudo-class — no
`data-wcs` binding or extra class toggling required.

| State | On when |
|-------|---------|
| `running` | `wcs-worker:running-changed` fires with `true` (cleared on `false`) |
| `error` | `wcs-worker:error` fires with a non-`null` detail (cleared on `null`) |

```css
wcs-worker:state(running) ~ .busy-indicator { display: block; }
wcs-worker:state(running) ~ .busy-indicator { display: none; } /* default */

form:has(wcs-worker:state(error)) .banner { display: block; }
```

Unlike attributes or classes, `:state()` cannot be written from outside the
element, so there is no risk of confusing this output state with an input.

**Browser support** (`:state(x)` syntax): Chrome/Edge 125+, Safari 17.4+,
Firefox 126+. In older browsers the states are simply never set — `:state()`
selectors never match, but `<wcs-worker>` itself keeps working normally
(graceful degradation, never-throw).

**SSR**: `:state()` cannot be serialized into HTML, so server-rendered markup
never carries these states on first paint (`@wcstack/server` is unaffected).
If you need to style the pre-hydration gap, pair your rule with
`wcs-worker:not(:defined)` instead.

### Debugging

Custom states are invisible in DevTools' Elements panel and `attachInternals()`
cannot be called twice, so there is no console way to inspect them directly.
Two debug-only aids are provided for that:

- `el.debugStates` — a **snapshot** array of the currently-on state names
  (e.g. `["running"]`). It is not part of `wc-bindable` (not a bind target)
  and its shape is not a guaranteed contract — use it for debugging only.
- The `debug-states` attribute (opt-in, default off) mirrors state changes
  onto `data-wcs-state-running` / `data-wcs-state-error` attributes on the
  element, so the Elements panel highlights them as they toggle:

  ```html
  <wcs-worker src="./compute.js" debug-states></wcs-worker>
  ```

**Write your CSS against `:state()`, not `data-wcs-state-*`.** The mirrored
attributes exist purely to make state changes visible while debugging with
DevTools open; they are not a supported styling hook.

## Notes & limitations

- **Bus-style message model.** No request/response correlation is built in; `post` is fire-and-forget and replies arrive on `message`. An RPC-style `request(data): Promise` is a possible future addition for imperative use.
- **No "ready" signal.** A worker accepts `postMessage` immediately (the platform queues messages until the script loads), and there is no standard "script loaded" event. `running` means "spawned and not terminated", **not** "ready to serve requests". If you need a true ready signal, have the worker `post` a ready message on startup and observe it via `message`.
- **`keep-alive` transfers ownership.** Without `keep-alive`, the worker is terminated on disconnect (like `<wcs-ws>` / `<wcs-broadcast>` close). With `keep-alive`, the worker survives disconnect and you become responsible for calling `terminate()` — otherwise the thread leaks. A consequence of this ownership transfer: with both `keep-alive` and `restart-on-error`, a restart pending at disconnect (an error that scheduled a `restart-interval` timer) is **not** cancelled and will fire after the element leaves the DOM, re-spawning a fresh worker on the now-detached element. This is intentional — `keep-alive` means the lifecycle is yours past disconnect — but it means the cleanest way to stop a `keep-alive` worker is an explicit `terminate()`, which also clears any pending restart.
- **`restart-on-error` is opt-in and bounded.** An uncaught error inside the worker does not auto-terminate it on the platform. When `restart-on-error` is set, a fresh worker is spawned after `restart-interval` ms, up to `max-restarts` times (mirrors `<wcs-ws>` reconnect bounding). The restart counter is **cumulative over the worker's lifetime**: it counts the total number of restarts since the last `start()` and is **not** reset by a period of stable operation. So `max-restarts` bounds total restarts, not consecutive crashes — a worker that recovers and later fails again still draws down the same budget. The counter resets only on a fresh `start()` (or a `src` change, which calls `start()`). Once the budget is exhausted, calling `start()` again with the **same** `src` is idempotent and will not re-spawn — call `terminate()` then `start()` (or change `src`) to reset the counter and spawn fresh. **Set `max-restarts` when using it** — the defaults (`max-restarts="Infinity"`, `restart-interval="0"`) mean a worker that throws immediately on load will re-spawn in a tight `setTimeout(0)` loop, flooding `wcs-worker:error` / `wcs-worker:running-changed` and starving the main thread. A small positive `restart-interval` and a finite `max-restarts` bound the blast radius.
- **A restart does not replay `post` state.** Each restart calls `new Worker(src)` and produces a *fresh* process with no memory of prior messages; the Core does not re-send any earlier `post`s. If a worker needs initialization state to function (a config message, a transferred port), it must request or rebuild it on startup (e.g. `post` a ready signal and have the page reply), because restart-on-error will not re-deliver it.
- **`src` is observed; `type` / `name` are applied at spawn.** Changing the `src` attribute while connected (and not `manual`) terminates the old worker and spawns the new script; only a non-empty new value triggers the switch. `type` and `name` are read at spawn time and are **not** in `observedAttributes` — changing them on an already-running worker has no effect until the next spawn (a `src` change, or a `terminate()` + `start()`). Likewise, re-calling `start()` with the same `src` is idempotent and ignores changed options.
- **Transferables are an escape hatch.** `transfer` (ArrayBuffer ownership, MessagePort) cannot be expressed through `data-wcs` data wiring. Use the imperative `element.post(data, transfer)` (or `WorkerCore.post(data, transfer)`); the declarative layer carries structured-clone data only.
- **Silent failure handling (zero-log).** Consistent with wcstack's zero-dependency philosophy, `<wcs-worker>` never logs or throws for runtime failures. A bad script URL, a CSP `worker-src` block, a non-cloneable post, a deserialization failure, and an uncaught worker error are surfaced only through the `error` property / `wcs-worker:error` event — `post()` returns and never rejects. Bind `error` to observe and react.
- **`errorInfo` taxonomy.** An **additive** bindable output (`wcs-worker:error-info-changed`) that classifies the same failure surfaced on `error` into a serializable `WcsIoErrorInfo` with a stable `code` / `phase` / `recoverable`, without changing the `error` shape. A missing `Worker` constructor (SSR / unsupported, where `new Worker()` throws a `TypeError` / `ReferenceError`) is `capability-missing` (phase `probe`); calling `start()` with no `src` is `invalid-argument` (phase `start`); any other failure — an uncaught worker `Error`, a `DataError` deserialization failure, a `DataCloneError` / `InvalidStateError` post failure, or a spawn failure — is `worker-error` (phase `execute`). Every worker failure is `recoverable: false` (no automatic retry recovers it). `errorInfo` stays in lockstep with `error` (same transitions, cleared alongside it). The shared `WcsIoErrorInfo` type and the `WCS_WORKER_ERROR_CODE` constants are exported.
- **`src` runs as code — trust it.** The `src` value is passed straight to `new Worker(src)`, which executes the script with the page's privileges; the tag does not validate or sandbox the origin. Only point `src` at scripts you trust (treat it like a `<script src>`), and prefer a `Content-Security-Policy` with an explicit `worker-src` allowlist to constrain where workers may load from — especially if `src` can be influenced by data binding.
- **Dedicated Worker only.** SharedWorker and Worklets are out of scope for this tag.

## Headless usage (`WorkerCore`)

The Core has no DOM dependency beyond the global `Worker` and can be used directly with `bind()` from `@wc-bindable/core`:

```typescript
import { WorkerCore } from "@wcstack/worker";

const core = new WorkerCore();
core.addEventListener("wcs-worker:message", (e) => {
  console.log((e as CustomEvent).detail); // the value posted back by the worker
});

core.start("./compute.js");
core.post({ task: "sum", values: [1, 2, 3] });
// transfer an ArrayBuffer (ownership moves to the worker)
const buf = new ArrayBuffer(1024);
core.post(buf, [buf]);
// ...later
core.terminate();
```

## License

MIT
