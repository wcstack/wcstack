# @wcstack/tilt

`@wcstack/tilt` is a headless Device Orientation component for the wcstack ecosystem.

It is not a visual UI widget.
It is an **async primitive node** that turns device tilt (`deviceorientation`) into reactive state.

With `@wcstack/state`, `<wcs-tilt>` can be bound directly through path contracts:

- **input surface**: none
- **output state surface**: `alpha`, `beta`, `gamma`, `absolute`, `permissionState`, `error`

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

## Commands

| Command            | Async | Description |
| ------------------- | ----- | ------------ |
| `requestPermission` | yes   | On iOS, calls the gesture-gated static method (**must be invoked from within a real user gesture handler**). On every other platform, resolves to `"granted"` immediately. |
| `start`             | no    | Subscribe to `deviceorientation`. Idempotent. |
| `stop`              | no    | Unsubscribe. Safe to call when not started. |

## Attributes / Inputs

**None.**

## Notes & limitations

- **Does not auto-start on connect.**
- **Does not compose with `@wcstack/permission`** (no matching Permissions API entry exists) — `permissionState` is tracked locally.
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
