# @wcstack/tilt

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

`@wcstack/tilt` is a headless Device Orientation component for the wcstack ecosystem.

It is not a visual UI widget.
It is an **async primitive node** that turns device tilt (`deviceorientation`) into reactive state.

With `@wcstack/state`, `<wcs-tilt>` can be bound directly through path contracts:

- **input surface**: none
- **output state surface**: `alpha`, `beta`, `gamma`, `absolute`, `permissionState`, `error`, `errorInfo`

## Why this exists — the iOS gesture-gate absorption sibling to `@wcstack/idle`

iOS 13+ Safari requires an explicit, gesture-gated `DeviceOrientationEvent.requestPermission()` before `deviceorientation` fires at all. Every other platform (Android Chrome, desktop) has no such gate. `<wcs-tilt>` absorbs this difference: `requestPermission()` resolves immediately to `"granted"` on ungated platforms, so callers can write **one** `requestPermission()` → `start()` flow that works everywhere.

> **`permissionState` is a 3-value vocabulary** (`"granted"` / `"denied"` / `"unknown"`) — deliberately distinct from the 4-value Permissions API state, since there is no `navigator.permissions.query()` entry for this feature. It is tracked locally, unlike `@wcstack/idle` (which composes with `@wcstack/permission`).

> **Does not auto-start on connect** — same reasoning as `@wcstack/idle`: attempting to subscribe before permission is granted silently receives nothing on iOS.

> **Requires a secure context** (HTTPS or localhost).

## Install

```bash
npm install @wcstack/tilt
```

## Quick Start

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/tilt/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      tiltBeta: null,
      tiltGamma: null,
      async enableTilt() {
        const el = document.querySelector("wcs-tilt");
        const result = await el.requestPermission();
        if (result === "granted") el.start();
      },
      get tiltTransform() {
        return `rotate(${this.tiltBeta ?? 0}deg)`;
      },
    };
  </script>
</wcs-state>

<wcs-tilt data-wcs="beta: tiltBeta; gamma: tiltGamma"></wcs-tilt>
<button data-wcs="onclick: enableTilt">Enable tilt</button>
<div data-wcs="style.transform: tiltTransform"></div>
```

Every path referenced by `data-wcs` (`tiltBeta`, `tiltGamma`, `tiltTransform`, `enableTilt`) must be declared on the state object — an undeclared top-level path throws during bind initialization. `tiltTransform` is a plain path getter (computed property, see `@wcstack/state`'s README) — `@wcstack/state` has no string-templating filter, so build the CSS string in a getter instead. It recomputes whenever `tiltBeta` changes.

## Observable Properties (outputs)

| Property          | Event                      | Description |
| ----------------- | --------------------------- | ------------ |
| `alpha`           | `wcs-tilt:change`           | Z-axis rotation, or `null` before `start()`. |
| `beta`            | `wcs-tilt:change`           | X-axis rotation. |
| `gamma`           | `wcs-tilt:change`           | Y-axis rotation. |
| `absolute`        | `wcs-tilt:change`           | Whether the reading is relative to the Earth's frame. Reliability varies by browser — verify on your target devices. |
| `permissionState` | `wcs-tilt:permission-changed` | `"granted"` \| `"denied"` \| `"unknown"`. |
| `error`           | `wcs-tilt:error`            | The last `requestPermission()` failure (e.g. a gesture-context rejection), or `null`. never-throw: failures never reject/throw, they land here instead. |
| `errorInfo`       | `wcs-tilt:error-info-changed` | Serializable failure taxonomy (`WcsIoErrorInfo`: stable `code` / `phase` / `recoverable`) derived from `error`, or `null`. Additive — the `error` shape is unchanged. |

## Commands

| Command            | Async | Description |
| ------------------- | ----- | ------------ |
| `requestPermission` | yes   | On iOS, calls the gesture-gated static method (**must be invoked from within a real user gesture handler**). On every other platform, resolves to `"granted"` immediately. |
| `start`             | no    | Subscribe to `deviceorientation`. Idempotent. |
| `stop`              | no    | Unsubscribe. Safe to call when not started. |

## Attributes / Inputs

**None.**

## CSS styling with `:state()`

`<wcs-tilt>` reflects one boolean output state onto its
[`ElementInternals` `CustomStateSet`](https://developer.mozilla.org/en-US/docs/Web/API/CustomStateSet),
so you can style it directly from CSS with the `:state()` pseudo-class — no
`data-wcs` binding or extra class toggling required. `alpha` / `beta` /
`gamma` / `permissionState` are not reflected: they are continuous-valued or
enum outputs with no matching derived boolean getter (guidelines §4.2), so
`error` is the only reflected state. `absolute` is likewise excluded — it can
only be derived from the continuous `wcs-tilt:change` stream, not from a
dedicated boolean event.

| State | On when |
|-------|---------|
| `error` | `wcs-tilt:error` fires with a non-`null` detail (cleared on `null`) |

```css
form:has(wcs-tilt:state(error)) .banner { display: block; }
```

Unlike attributes or classes, `:state()` cannot be written from outside the
element, so there is no risk of confusing this output state with an input.

**Browser support** (`:state(x)` syntax): Chrome/Edge 125+, Safari 17.4+,
Firefox 126+. In older browsers the states are simply never set — `:state()`
selectors never match, but `<wcs-tilt>` itself keeps working normally
(graceful degradation, never-throw).

**SSR**: `:state()` cannot be serialized into HTML, so server-rendered markup
never carries these states on first paint (`@wcstack/server` is unaffected).
If you need to style the pre-hydration gap, pair your rule with
`wcs-tilt:not(:defined)` instead.

### Debugging

Custom states are invisible in DevTools' Elements panel and `attachInternals()`
cannot be called twice, so there is no console way to inspect them directly.
Two debug-only aids are provided for that:

- `el.debugStates` — a **snapshot** array of the currently-on state names
  (e.g. `["error"]`). It is not part of `wc-bindable` (not a bind target)
  and its shape is not a guaranteed contract — use it for debugging only.
- The `debug-states` attribute (opt-in, default off) mirrors state changes
  onto a `data-wcs-state-error` attribute on the element, so the Elements
  panel highlights it as it toggles:

  ```html
  <wcs-tilt debug-states></wcs-tilt>
  ```

**Write your CSS against `:state()`, not `data-wcs-state-*`.** The mirrored
attribute exists purely to make state changes visible while debugging with
DevTools open; it is not a supported styling hook.

## Notes & limitations

- **Does not auto-start on connect.**
- **Does not compose with `@wcstack/permission`** (no matching Permissions API entry exists) — `permissionState` is tracked locally.
- **`errorInfo` taxonomy (additive).** Alongside `error`, `<wcs-tilt>` publishes a serializable `errorInfo` (`wcs-tilt:error-info-changed`) that classifies the *same* failure into a stable `WcsIoErrorInfo` (`code` / `phase` / `recoverable`), without changing the `error` shape. Only `requestPermission()` can fail here, classified by the rejection reason's `Error.name`: a `NotAllowedError` (iOS Device Orientation permission denied) → `not-allowed` (phase `start`); anything else (a rejection outside a user-gesture context, a non-`Error` reason) → `tilt-error` (phase `execute`). Both are `recoverable: false`. There is **no** `capability-missing` code: on gate-less platforms an unsupported environment resolves to `"granted"` rather than erroring, so that branch is unreachable. `errorInfo` transitions exactly when `error` does (cleared to `null` on recovery); the shared `WcsIoErrorInfo` type and the `WCS_TILT_ERROR_CODE` constants are exported.
- No `_gen` generation guard: subscribing is fully synchronous.
- **On a non-secure origin (plain HTTP), `deviceorientation` never fires** — the browser suppresses it natively and `<wcs-tilt>` adds no guard of its own, so tilt values stay `null`, `wcs-tilt:change` never dispatches, and `permissionState` stays `"unknown"` (until you call `requestPermission()`). Calling `requestPermission()` cannot detect this either: on gate-less platforms its fallback resolves `"granted"` without probing anything. If nothing seems to happen, check your origin first.
- **Permissions-Policy gate.** The `deviceorientation` event is only dispatched when the `accelerometer` and `gyroscope` Permissions-Policy directives are allowed (default allowlist: `self`, per the Device Orientation Events spec §4). Using `<wcs-tilt>` inside a cross-origin `<iframe>` requires `allow="accelerometer; gyroscope"` on that `<iframe>` element — otherwise the event silently never fires, the same failure mode as the non-secure-origin case above.
- **High-frequency stream.** `deviceorientation` can fire tens of times per second on many devices. `@wcstack/state` has no built-in debounce/throttle filter — if you need a coarser rate, relay through `@wcstack/debounce`'s value surface: `<wcs-tilt data-wcs="beta: tiltBeta">` then `<wcs-throttle wait="100" data-wcs="source: tiltBeta; value: throttledBeta"></wcs-throttle>` (see `@wcstack/debounce`'s README).

## Headless usage (`TiltCore`)

```typescript
import { TiltCore } from "@wcstack/tilt";

const core = new TiltCore();
core.addEventListener("wcs-tilt:change", (e) => {
  console.log((e as CustomEvent).detail); // { alpha, beta, gamma, absolute }
});

await core.requestPermission();
core.start();
// later:
core.dispose();
```

## License

MIT
