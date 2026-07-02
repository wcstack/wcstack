# @wcstack/screen-orientation

`@wcstack/screen-orientation` is a headless Screen Orientation component for the wcstack ecosystem.

It is not a visual UI widget.
It is an **async primitive node** that turns `screen.orientation` into reactive state, and exposes `lock()`/`unlock()` as declarative commands.

With `@wcstack/state`, `<wcs-screen-orientation>` can be bound directly through path contracts:

- **input surface**: none — `screen.orientation` is a single global with nothing to configure
- **output state surface**: `type`, `angle`, `portrait`, `landscape`, `error`

## Why this exists — a monitor/command asymmetry unique in this batch

Unlike `@wcstack/network` (a pure monitor), this node is **bidirectional**: it monitors orientation *and* exposes `lock()`/`unlock()` commands. This produces a notable internal asymmetry:

- **Monitoring needs no `_gen` generation guard.** Subscribing to `screen.orientation`'s `change` event is fully synchronous — there is no asynchronous probe whose stale resolution could race a `dispose()` (same reasoning as `@wcstack/network`).
- **`lock()` does need one.** It is asynchronous and in-flight; a stale `lock()` resolving after a newer `lock()`/`unlock()` call must not clobber the state that call already established. This guard is entirely independent of the monitoring path.

> **`lock()` is best-effort.** Many desktop browsers reject with `NotSupportedError` outside a mobile / fullscreen context. Never-throw: failures land in `error`, not as a rejected promise from the caller's perspective.

## Install

```bash
npm install @wcstack/screen-orientation
```

## Quick Start

### 1. Read live orientation

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/screen-orientation/auto"></script>

<wcs-state>
  <script type="module">
    export default { portrait: true };
  </script>
</wcs-state>

<wcs-screen-orientation data-wcs="portrait: portrait"></wcs-screen-orientation>
<template data-wcs="if: !portrait">
  <p>Please rotate your device to portrait.</p>
</template>
```

### 2. Lock orientation on command

```html
<wcs-screen-orientation data-wcs="command.lock: $command.lockLandscape; error: lockError"></wcs-screen-orientation>
<button data-wcs="onclick: lockLandscape">Lock to landscape</button>
```

```js
export default {
  lockError: null,
  lockLandscape() {
    this.$command.lock.emit("landscape");
  },
};
```

## Observable Properties (outputs)

| Property    | Event                 | Description |
| ----------- | ---------------------- | ------------ |
| `type`      | `wcs-orientation:change` | `screen.orientation.type` (e.g. `"portrait-primary"`), or `null` when unsupported. |
| `angle`     | `wcs-orientation:change` | `screen.orientation.angle`, or `null` when unsupported. |
| `portrait`  | `wcs-orientation:change` | `true` when `type` starts with `"portrait"`. |
| `landscape` | `wcs-orientation:change` | `true` when `type` starts with `"landscape"`. |
| `error`     | `wcs-orientation:error`  | The last `lock()`/`unlock()` failure, or `null`. |

`type`/`angle`/`portrait`/`landscape` all derive from the single `wcs-orientation:change` event.

## Commands

| Command  | Async | Description |
| -------- | ----- | ------------ |
| `lock`   | yes   | Request a specific orientation lock (e.g. `"landscape"`, `"portrait-primary"`). Value passed through verbatim — never-throw; an unrecognized string or unsupported environment surfaces via `error`. |
| `unlock` | no    | Release a previously requested lock. Synchronous, mirroring the platform API. |

## Attributes / Inputs

**None.** `screen.orientation` is a single global; there is nothing per-instance to configure.

## Notes & limitations

- **No secure-context requirement** for monitoring (unlike `@wcstack/geolocation`/`@wcstack/permission`).
- **`lock()` support varies widely** — many desktop browsers reject outside mobile/fullscreen contexts. Design any UI around it being best-effort.
- **SSR (`@wcstack/server`).** Declares `static hasConnectedCallbackPromise = true`; since monitoring is synchronous, `connectedCallbackPromise` always settles immediately.

## Headless usage (`ScreenOrientationCore`)

```typescript
import { ScreenOrientationCore } from "@wcstack/screen-orientation";

const core = new ScreenOrientationCore();
core.addEventListener("wcs-orientation:change", (e) => {
  console.log((e as CustomEvent).detail); // { type, angle }
});

core.observe();
await core.lock("landscape");
console.log(core.error);

// later:
core.dispose();
```

## License

MIT
