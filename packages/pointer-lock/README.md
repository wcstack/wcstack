# @wcstack/pointer-lock

`@wcstack/pointer-lock` is a headless Pointer Lock API component for the wcstack ecosystem.

It is not a visual UI widget.
It is an **async primitive node** that turns the Pointer Lock API's lock state into reactive state — the same way `@wcstack/fullscreen` turns the Fullscreen API's active state into reactive state.

With `@wcstack/state`, `<wcs-pointer-lock>` can be bound directly through path contracts:

- **input surface**: `target`
- **output state surface**: `active`, `error`
- **commands**: `requestPointerLock`, `exitPointerLock`

`@wcstack/pointer-lock` follows the [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md) (Core / Shell / Binding Contract) architecture:

- **Core** (`PointerLockCore`) wraps `Element.requestPointerLock()` / `document.exitPointerLock()` / `document.pointerLockElement`, self-filtering the `document`-scoped `pointerlockchange` event against its own resolved target
- **Shell** (`<wcs-pointer-lock target="...">`) resolves *which* element to operate on from the DOM, manages display and lifecycle
- **Binding Contract** (`static wcBindable`) declares the observable `active` property and the `requestPointerLock`/`exitPointerLock` commands

## A narrow-purpose node — read this before reaching for it

Unlike most wcstack IO nodes, `<wcs-pointer-lock>` is **not** aimed at the project's main use case of building declarative SPA UI. The Pointer Lock API's real-world usage is almost exclusively **games and canvas/WebGL rendering UI** that need the mouse's *relative* movement (`movementX`/`movementY`) — first-person camera controls, drawing-tool panning, and similar. Those consumers typically already run an imperative `requestAnimationFrame` loop and have less reason to route input through a declarative binding layer than, say, a video player reaching for `<wcs-fullscreen>`.

Reach for this node when you need a declarative *lock on/off* switch (e.g. a "Enable mouse look" button wired via the command-token protocol) — not as a source of `movementX`/`movementY` data. See below.

## `movementX`/`movementY` are out of scope (v1)

`mousemove` events fired while the pointer is locked carry `movementX`/`movementY` deltas. **This Core does not expose them, in any version up to this one.** They are high-frequency data (potentially hundreds of events/sec) that do not fit the same-value-guarded, declarative `properties` model this protocol is built around — piping them through `wc-bindable` as-is would risk flooding the bound state with per-frame updates.

If a future version adds them, the design intent (see `docs/pointer-lock-tag-design.md` §3) is to gate them behind an explicit opt-in and pair them with `@wcstack/debounce`/`@wcstack/throttle` for rate-limiting, keeping the "no unbounded firehose" property intact for instances that don't opt in. For now, if you need raw `movementX`/`movementY`, read them directly off `mousemove` in your own imperative code alongside this node's `active` state.

## The `target` attribute decides what is locked

Like `@wcstack/fullscreen`, this Shell does not lock *itself* — it is a hidden control tag that operates on a **referenced element** via the `target` attribute, using the same 3-mode resolution as `@wcstack/intersection`:

| `target`         | operates on            | `display`   |
|------------------|--------------------------|-------------|
| *omitted*        | first element child      | `contents`  |
| `"#selector"`    | the matched element       | `none`      |
| `"self"`         | the element itself        | `block`     |

## Install

```bash
npm install @wcstack/pointer-lock
```

## Quick Start

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/pointer-lock/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["lockPointer", "unlockPointer"],
      locked: false,
    };
  </script>
</wcs-state>

<canvas id="scene" width="640" height="480"></canvas>
<wcs-pointer-lock target="#scene"
  data-wcs="active: locked; command.requestPointerLock: $command.lockPointer; command.exitPointerLock: $command.unlockPointer">
</wcs-pointer-lock>

<button data-wcs="onclick: $command.lockPointer">Enable mouse look</button>
<button data-wcs="hidden: locked|not; onclick: $command.unlockPointer">Release</button>
```

The buttons never touch `<wcs-pointer-lock>` directly: their clicks emit the `lockPointer`/`unlockPointer` command tokens, and `<wcs-pointer-lock>` subscribes to them via `command.requestPointerLock: $command.lockPointer` / `command.exitPointerLock: $command.unlockPointer` (the [command-token protocol](../state/) — the element with the command method is the *subscriber*, not the emitter).

Every bound state path must be declared up front — `locked: false` here; binding an undeclared path throws at initialization. Negation in a `data-wcs` path is done with the `|not` filter (`locked|not`), not a leading `!` — paths do not support prefix operators.

`requestPointerLock()` **requires a user-gesture context** — see below.

## User gesture requirement

`Element.requestPointerLock()` rejects with `NotAllowedError` when called outside a user-gesture context (e.g. a synchronous click handler). This node cannot manufacture a gesture on your behalf: **the responsibility for calling `requestPointerLock` from within an actual user gesture belongs to the caller.** Wire the command-token protocol (`command.requestPointerLock: $command.<token>` on `<wcs-pointer-lock>`, emitted by a button's `onclick: $command.<token>`) — calling it from a `setTimeout` or deep inside a `.then()` chain loses the gesture context and the call will reject, `error` will be set, but no exception will propagate (never-throw).

## Observable Properties (outputs)

| Property   | Event                       | Description |
| ---------- | ---------------------------- | ------------ |
| `active`   | `wcs-pointer-lock:change`    | `true` when `document.pointerLockElement` is this instance's resolved target, `false` otherwise. |

`error` (see Commands below) is exposed as a plain getter, not as a `wcBindable` property — it only changes as a side effect of a command call, mirroring `@wcstack/fullscreen`. The most recent failure is one of: a rejected promise (e.g. `NotAllowedError` for a gesture-less call), `{ message: "Pointer Lock API is not supported." }` when the platform API is missing, `{ message: "Pointer Lock target could not be resolved." }` when `target` did not resolve to an element, or `null` if the last attempt succeeded / nothing has failed yet.

## Commands

| Command              | Async | Description |
| --------------------- | ----- | ------------ |
| `requestPointerLock`  | yes   | Resolve `target` and call `requestPointerLock()` on it. Never-throw: failures (an unresolvable `target`, `NotAllowedError` for a missing gesture, or an unsupported API) are captured into `error`, not thrown. |
| `exitPointerLock`     | **no**| Calls `document.exitPointerLock()`. **Synchronous** — unlike `@wcstack/fullscreen`'s `exitFullscreen()` (which is Promise-based), `exitPointerLock()` returns `void`. Silent no-op if nothing is currently locked or the API is unsupported. |

## Attributes / Inputs

| Attribute | Description |
| --------- | ------------ |
| `target`  | Selector (or `"self"`) identifying the element to lock. See "The `target` attribute decides what is locked" above. Omitted → first element child. |

## Multiple instances — read `active` per-instance, not "is *anything* locked"

`document.pointerLockElement` is a single document-wide value — at most one element can be locked at a time. When several `<wcs-pointer-lock>` instances exist simultaneously (e.g. `target="#a"` and `target="#b"`), each instance compares `document.pointerLockElement` against **its own** resolved target, not merely "is the document locked". Locking `#a` makes the `target="#a"` instance report `active: true` and the `target="#b"` instance report `active: false` — even though *some* element (`#a`) is locked document-wide.

## Vendor prefixes

Some older WebKit builds expose `webkitRequestPointerLock` / `webkitExitPointerLock` / `webkitPointerLockElement` / the `webkitpointerlockchange` event instead of the standard names. API resolution happens **at call time** (never cached), probing the standard name first and falling back to the legacy name — this lets an unsupported environment (neither name present) be detected correctly and lets tests install/remove the API freely.

## Notes & limitations

- **User gesture required.** See above — this is a platform constraint, not something this node can work around.
- **`exitPointerLock()` is synchronous**, unlike `@wcstack/fullscreen`'s Promise-based `exitFullscreen()`. It carries no `_gen` generation guard of its own (only `requestPointerLock()`, being asynchronous, needs one); it is still wrapped in `try/catch` defensively so a non-conformant implementation can never throw out of it.
- **`movementX`/`movementY` are out of scope for v1.** See above.
- **No autoTrigger.** Because `requestPointerLock()` needs a user-gesture context, the primary activation path is the command-token protocol (`command.requestPointerLock: $command.<token>` on `<wcs-pointer-lock>`) rather than a `data-*target` click shortcut.
- **SSR (`@wcstack/server`).** Declares `static hasConnectedCallbackPromise = true` and exposes `connectedCallbackPromise`; since `observe()` is synchronous, this promise always settles immediately.

## Headless usage (`PointerLockCore`)

The Core has no DOM dependency (beyond calling the Pointer Lock platform API) and can be used directly with `bind()` from `@wc-bindable/core`:

```typescript
import { PointerLockCore } from "@wcstack/pointer-lock";

const lock = new PointerLockCore();
lock.addEventListener("wcs-pointer-lock:change", (e) => {
  console.log((e as CustomEvent).detail); // boolean — the new `active` value directly
});

const canvas = document.querySelector("#scene")!;
lock.observe(canvas);              // subscribe to document pointerlockchange, self-filtering on `canvas`
await lock.requestPointerLock(canvas); // must be called from within a user gesture
console.log(lock.active, lock.error);

// later, when done:
lock.exitPointerLock();  // synchronous
lock.dispose();          // detach the document listener
```

## License

MIT
