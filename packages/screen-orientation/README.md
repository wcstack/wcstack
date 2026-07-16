# @wcstack/screen-orientation

`@wcstack/screen-orientation` is a headless Screen Orientation component for the wcstack ecosystem.

It is not a visual UI widget.
It is an **async primitive node** that turns `screen.orientation` into reactive state, and exposes `lock()`/`unlock()` as declarative commands.

With `@wcstack/state`, `<wcs-screen-orientation>` can be bound directly through path contracts:

- **input surface**: none — `screen.orientation` is a single global with nothing to configure
- **output state surface**: `type`, `angle`, `portrait`, `landscape`, `error`, `errorInfo`

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
| `errorInfo` | `wcs-orientation:error-info-changed` | Serializable failure taxonomy (`WcsIoErrorInfo`: stable `code` / `phase` / `recoverable`) derived from `error`, or `null`. Additive — the `error` shape is unchanged. |

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
- **`errorInfo` taxonomy (additive).** Alongside `error`, `<wcs-screen-orientation>` publishes a serializable `errorInfo` (`wcs-orientation:error-info-changed` — note the `wcs-orientation:` namespace, not the tag name) that classifies the *same* `lock()`/`unlock()` failure into a stable `WcsIoErrorInfo` (`code` / `phase` / `recoverable`), without changing the `error` shape. A missing `screen.orientation` / method (synthetic "unsupported") → `capability-missing` (phase `probe`); the plain-tab lock rejections `NotAllowedError` / `NotSupportedError` / `SecurityError` all fold to a single `not-allowed` (phase `execute`, `recoverable: false` — matching the "don't branch on the name" model above); an `AbortError` (superseded by a newer `lock()`) → `aborted` (phase `execute`, `recoverable: true` — a fresh `lock()` may still succeed); anything else (e.g. `InvalidStateError`, a raw throw, a missing `.name`) → `orientation-error` (phase `execute`). `errorInfo` transitions exactly when `error` does (cleared to `null` on recovery); the shared `WcsIoErrorInfo` type and the `WCS_SCREEN_ORIENTATION_ERROR_CODE` constants are exported.
- **SSR (`@wcstack/server`).** Declares `static hasConnectedCallbackPromise = true`; since monitoring is synchronous, `connectedCallbackPromise` always settles immediately.

## CSS styling with `:state()`

`<wcs-screen-orientation>` reflects boolean output states onto its
[`ElementInternals` `CustomStateSet`](https://developer.mozilla.org/en-US/docs/Web/API/CustomStateSet),
so you can style it directly from CSS with the `:state()` pseudo-class — no
`data-wcs` binding or extra class toggling required.

| State | On when |
|-------|---------|
| `portrait` | `wcs-orientation:change` fires with a `type` that starts with `"portrait"` |
| `landscape` | `wcs-orientation:change` fires with a `type` that starts with `"landscape"` |
| `error` | `wcs-orientation:error` fires with a non-`null` detail (cleared on `null`) |

`portrait` and `landscape` are mutually exclusive and both fall off when `type`
is `null` (unsupported environment). Note the event namespace is
`wcs-orientation:`, not the tag name `wcs-screen-orientation`; `angle` is not
reflected (continuous value, excluded by design — see
`docs/custom-state-reflection-design.md` §3.2).

```css
wcs-screen-orientation:state(portrait) ~ .portrait-hint  { display: block; }
wcs-screen-orientation:state(landscape) ~ .landscape-hint { display: block; }

form:has(wcs-screen-orientation:state(error)) .banner { display: block; }
```

Unlike attributes or classes, `:state()` cannot be written from outside the
element, so there is no risk of confusing this output state with an input.

**Browser support** (`:state(x)` syntax): Chrome/Edge 125+, Safari 17.4+,
Firefox 126+. In older browsers the states are simply never set — `:state()`
selectors never match, but `<wcs-screen-orientation>` itself keeps working
normally (graceful degradation, never-throw).

**SSR**: `:state()` cannot be serialized into HTML, so server-rendered markup
never carries these states on first paint (`@wcstack/server` is unaffected).
If you need to style the pre-hydration gap, pair your rule with
`wcs-screen-orientation:not(:defined)` instead.

### Debugging

Custom states are invisible in DevTools' Elements panel and `attachInternals()`
cannot be called twice, so there is no console way to inspect them directly.
Two debug-only aids are provided for that:

- `el.debugStates` — a **snapshot** array of the currently-on state names
  (e.g. `["portrait"]`). It is not part of `wc-bindable` (not a bind target)
  and its shape is not a guaranteed contract — use it for debugging only.
- The `debug-states` attribute (opt-in, default off) mirrors state changes
  onto `data-wcs-state-portrait` / `data-wcs-state-landscape` /
  `data-wcs-state-error` attributes on the element, so the Elements panel
  highlights them as they toggle:

  ```html
  <wcs-screen-orientation debug-states></wcs-screen-orientation>
  ```

**Write your CSS against `:state()`, not `data-wcs-state-*`.** The mirrored
attributes exist purely to make state changes visible while debugging with
DevTools open; they are not a supported styling hook.

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
