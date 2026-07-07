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

> **`lock()` is best-effort.** This is not a desktop-vs-mobile split: most current browsers, desktop and mobile alike, reject a plain-tab `lock()` call unless the document is fullscreen or running as an installed PWA (Safari does not support `lock()` at all, in any context). The rejection's error name varies by browser and cause — `NotAllowedError` (current spec, fullscreen pre-lock condition unmet), `NotSupportedError` (locking to that orientation unsupported), or `SecurityError` (older implementations) — so do not branch on a specific name. Never-throw: failures land in `error`, not as a rejected promise from the caller's perspective.

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
    export default {
      portrait: true,
      // The initial snapshot fires before bindings attach — pull it once (see Notes).
      async $connectedCallback() {
        await customElements.whenDefined("wcs-screen-orientation");
        this.portrait = document.querySelector("wcs-screen-orientation").portrait;
      },
    };
  </script>
</wcs-state>

<wcs-screen-orientation data-wcs="portrait: portrait"></wcs-screen-orientation>
<template data-wcs="if: portrait|not">
  <p>Please rotate your device to portrait.</p>
</template>
```

One timing rule applies to this example: `<wcs-screen-orientation>` publishes its snapshot through `wcs-orientation:change` events, and the *first* snapshot fires synchronously at connect — before `@wcstack/state` has attached its binding listeners — so bound paths only start updating from the *next* orientation change. The `$connectedCallback` block pulls that initial snapshot once; without it, this page would not react when the device is already in landscape at load time (see Notes & limitations).

### 2. Lock orientation on command

```html
<wcs-screen-orientation data-wcs="command.lock: $command.lockLandscape; error: lockError"></wcs-screen-orientation>
<button data-wcs="onclick: lockLandscape">Lock to landscape</button>
```

```js
export default {
  lockError: null,
  $commandTokens: ["lockLandscape"],
  lockLandscape() {
    this.$command.lockLandscape.emit("landscape");
  },
};
```

In a plain tab like this, clicking the button will not actually lock anything: current browsers reject `lock()` (surfacing in `lockError`) unless the document is fullscreen or running as an installed PWA. To see the lock take hold, pair this with a fullscreen trigger — e.g. `<wcs-fullscreen>` — and call `lock()` after entering fullscreen (see Notes & limitations).

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
- **`lock()` needs a fullscreen or installed-PWA context — not a desktop-vs-mobile split.** A plain-tab call typically rejects on both desktop and mobile (as `NotAllowedError` / `NotSupportedError` / `SecurityError` depending on browser and cause — do not branch on the name); Safari does not implement `lock()` at all. Design any UI around it being best-effort, and pair it with an explicit fullscreen entry point (e.g. `@wcstack/fullscreen`) when the lock actually needs to take hold.
- **The initial snapshot does not reach bindings.** The first `wcs-orientation:change` fires synchronously during `connectedCallback` — before `@wcstack/state` attaches its binding listeners (binding setup is deferred to a later microtask; see `docs/timing-and-firing-contract.md` §4.1) — and events are not replayed to late subscribers, so bound paths update only from the *next* orientation change. If the initial value matters (it does for `portrait`/`landscape`/`type`/`angle`), pull it once in `$connectedCallback` as the Quick Start example does. This is a property of the wc-bindable event contract shared by all monitor nodes, not a quirk of this package. See `docs/timing-and-firing-contract.md` §7 for the full firing/generation contract (initial snapshot, `lock()` generation ordering, `error` dedup).
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
